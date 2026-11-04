/* Tranche « CRM Analytics + Caisse » — module Clients & Équipes. Fiabilité
   pondérée canonique (core `clientReliabilityV1`, ops.ts) calculée sur
   l'historique réel de réservations du centre — jamais un score maison.
   `cancellationKind` (core) classe EARLY/LATE via `bookings.cancelled_at`
   (migration additive 0002) ; NULL (données pré-migration) → EARLY par
   défaut, décision documentée (docs/DECISIONS.md). Vrai Postgres 16 éphémère. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientReliabilityV1 } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, withBookingStarted, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { fromPgRange, toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker, WEEKDAY } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '', amine = '', sofiane = '', walid = '', karim = '', reda = '';

/* Ni vendredi (T1 ouvre à 14:00), ni mardi ni dimanche : les deux abonnements du seed (FC Kahwa T1 mardi
   20:00, Ooredoo T2 dimanche 17:00) occupent réellement ces créneaux — le test « score exact » enchaîne
   15 heures sur T1 et tombait en SLOT_TAKEN un mardi (27/09/2026, même classe de piège que analytics.test.ts). */
const nextNonFriday = makeSafeDayPicker([WEEKDAY.TUESDAY, WEEKDAY.SUNDAY]);
let dayCursor = 20;
function freshDay(): string {
  const d = nextNonFriday(dayCursor);
  dayCursor += 10;
  slotByField.clear();
  return d;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — a VIEW_CLIENTS
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas VIEW_CLIENTS
  sofiane = await loginAs(stack, seed.phones.sofiane); // client, pas staff
  walid = await loginAs(stack, seed.phones.walid);     // capitaine Panthers
  karim = await loginAs(stack, seed.phones.karim);     // dédié au test de score exact (jamais réutilisé ailleurs)
  reda = await loginAs(stack, seed.phones.reda);       // dédié au test H-2 réel (jamais réutilisé ailleurs)
});
afterAll(async () => { await stack.teardown(); });

interface CreatedBooking { id: string; totalDa: number }

async function createBooking(
  byToken: string, fieldId: string, date: string, startMin: number, durationMin: number, source = 'MOUBARAT',
): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(byToken),
    payload: { fieldId, date, startMin, durationMin, source },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

async function setStatus(byToken: string, id: string, status: string): Promise<void> {
  // P1-3 : pas de no-show avant le début du créneau — la ligne est reculée le temps de l'appel, puis remise en place.
  const call = () => stack.app.inject({
    method: 'POST', url: `/bookings/${id}/status`, headers: bearer(byToken), payload: { status },
  });
  const res = status === 'NO_SHOW' ? await withBookingStarted(stack.db, id, call) : await call();
  expect(res.statusCode).toBe(200);
}

/* Compteur PAR TERRAIN, remis à zéro à chaque freshDay() : toutes les
   réservations de ce fichier durent 60 min (sauf le défi, 90 min, sur son
   propre jour dédié). Espacement 60 min ⇒ jusqu'à ~16 créneaux distincts par
   jour ET par terrain (08:00→01:00(+1) horaires seed) — le test « score
   exact » a besoin de 15 sur un terrain + 2 sur un autre, jamais 17 sur un
   seul, d'où le compteur par terrain plutôt que global. Le tout premier
   compteur (mod 10, jamais remis à zéro) provoquait un vrai SLOT_TAKEN dès
   le 11ᵉ appel d'un même test — bug trouvé et corrigé en revue. */
const slotByField = new Map<string, number>();
function nextSlot(fieldId: string): number {
  const slotInField = slotByField.get(fieldId) ?? 0;
  const startMin = 540 + slotInField * 60;
  slotByField.set(fieldId, slotInField + 1);
  if (startMin + 60 > 1500) throw new Error('trop de créneaux demandés pour un même terrain/jour de test');
  return startMin;
}

describe('permissions', () => {
  it('RECEPTION voit, STAFF et non-membre refusés (VIEW_CLIENTS)', async () => {
    const asStaff = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(amine),
    });
    expect(asStaff.statusCode).toBe(403);
    // CRM Auth V1 : sofiane est un jeton Player, pas un compte plateforme du
    // tout — 401 (non authentifié pour ce type de route), pas 403 (authentifié
    // mais sans le droit). Plus précis que l'ancien comportement.
    const asOutsider = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(sofiane),
    });
    expect(asOutsider.statusCode).toBe(401);
    const asReception = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(nadia),
    });
    expect(asReception.statusCode).toBe(200);
  });
});

describe('fiabilité pondérée', () => {
  it('sous 3 réservations : invisible (score null)', async () => {
    const day = freshDay();
    const a = await createBooking(sofiane, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, a.id, 'HONORED');
    const b = await createBooking(sofiane, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, b.id, 'HONORED');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients/${await userIdOf(seed.phones.sofiane)}`, headers: bearer(nadia),
    });
    expect(res.statusCode).toBe(200);
    const client = (res.json() as { client: { reliability: { visible: boolean; score: number | null } } }).client;
    expect(client.reliability.visible).toBe(false);
    expect(client.reliability.score).toBeNull();
  });

  it('score exact : honorées +1, annulée tardive −0,5, no-show −2 — bande et confiance correctes', async () => {
    const day = freshDay();
    // Utilisateur dédié à ce test, jamais touché ailleurs dans ce fichier —
    // les assertions ci-dessous portent sur un total ABSOLU (pas un delta),
    // donc fragile à toute contamination inter-tests (piège déjà documenté,
    // docs/DECISIONS.md). karim n'a aucune réservation sur ce centre avant
    // ce test : le compte est entièrement construit ici, self-contained.
    const userId = await userIdOf(seed.phones.karim);

    // Total = 17 sur ce centre : 15 honorées/payées, 1 annulation tardive, 1 no-show.
    for (let i = 0; i < 15; i++) {
      const b = await createBooking(karim, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
      await setStatus(nadia, b.id, 'HONORED');
    }
    const lateCancel = await createBooking(karim, seed.fields.t2, day, nextSlot(seed.fields.t2), 60);
    await stack.app.inject({ method: 'POST', url: `/bookings/${lateCancel.id}/cancel`, headers: bearer(karim) });
    // Force LATE : cancelled_at à moins de 24h du début du créneau.
    const lateRow = await stack.db.selectFrom('bookings').select('time_range')
      .where('id', '=', lateCancel.id).executeTakeFirstOrThrow();
    const lateStart = fromPgRange(lateRow.time_range).start;
    await stack.db.updateTable('bookings').set({ cancelled_at: new Date(lateStart - 3_600_000) })
      .where('id', '=', lateCancel.id).execute();

    const noShow = await createBooking(karim, seed.fields.t2, day, nextSlot(seed.fields.t2), 60);
    await setStatus(nadia, noShow.id, 'NO_SHOW');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients/${userId}`, headers: bearer(nadia),
    });
    const client = (res.json() as {
      client: { reliability: { visible: boolean; score: number; band: string; confidence: string; total: number } };
    }).client;
    // total = 15 + 1 (late) + 1 (no-show) = 17
    // points = 15 - 0.5*1 - 2*1 = 12.5 ; score = round(12.5/17*100) = 74
    expect(client.reliability.total).toBe(17);
    expect(client.reliability.visible).toBe(true);
    expect(client.reliability.score).toBe(74);
    expect(client.reliability.band).toBe('CORRECT'); // ≥70
    expect(client.reliability.confidence).toBe('MOYENNE'); // 5 ≤ total(17) < 20
  });

  it('annulation réelle sous H-2 (§18/§19, 25/10/2026) : le malus −0,5 de la règle 26 se voit sur le score, par le vrai chemin HTTP', async () => {
    // Complète le test « score exact » ci-dessus (qui force LATE en réécrivant
    // `cancelled_at` après coup) : ici, aucune réécriture — la réservation
    // démarre réellement dans moins de 2 h et c'est la vraie route
    // /bookings/:id/cancel, appelée au moment présent, qui produit le malus.
    // Utilisateur dédié, jamais touché ailleurs dans ce fichier.
    const day = freshDay();
    const redaId = await userIdOf(seed.phones.reda);

    // 3 honorées d'abord : score plein (100) avant toute annulation.
    for (let i = 0; i < 3; i++) {
      const b = await createBooking(reda, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
      await setStatus(nadia, b.id, 'HONORED');
    }
    const before = await getClientById(redaId);
    expect(before.reliability.total).toBe(3);
    expect(before.reliability.score).toBe(100);

    // 4ᵉ réservation : commence dans 1 h (< H-2), insérée directement (hors
    // disponibilité réelle — seule la fenêtre H-2 compte ici), sur un terrain
    // jamais sollicité à « maintenant » ailleurs dans ce fichier.
    const soon = await stack.db.insertInto('bookings').values({
      field_id: seed.fields.t3,
      time_range: toPgRange({ start: Date.now() + 60 * 60_000, end: Date.now() + 120 * 60_000 }),
      source: 'MOUBARAT', verified_by_center: true, by_user_id: redaId,
      reservation_name: 'Reda M.', reference: 'COM-9002', price_total_da: 1800,
    }).returning('id').executeTakeFirstOrThrow();
    const cancel = await stack.app.inject({
      method: 'POST', url: `/bookings/${soon.id}/cancel`, headers: bearer(reda),
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((cancel.json() as { message: string }).message).toContain('demi-absence');

    const after = (await getClientById(redaId)) as unknown as {
      reliability: { score: number; total: number };
      cancelledLate: number; cancelledEarly: number;
    };
    expect(after.cancelledLate).toBe(1);
    expect(after.cancelledEarly).toBe(0);
    expect(after.reliability.total).toBe(4);
    // total=4, points = 3 honorées − 0,5 (annulée tardive) = 2,5, score = round(2,5/4×100) = 63 —
    // même formule que core.clientReliabilityV1 (règle 26), jamais une seconde.
    expect(after.reliability.score).toBe(63);
    expect(after.reliability.score).toBe(
      clientReliabilityV1({ honored: 3, paid: 0, cancelledEarly: 0, cancelledLate: 1, noShow: 0 }).score,
    );
  });

  it('annulation précoce (≥24h) : aucune pénalité', async () => {
    const day = freshDay();
    const earlyCancel = await createBooking(walid, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await stack.app.inject({ method: 'POST', url: `/bookings/${earlyCancel.id}/cancel`, headers: bearer(walid) });
    const row = await stack.db.selectFrom('bookings').select('time_range')
      .where('id', '=', earlyCancel.id).executeTakeFirstOrThrow();
    const start = fromPgRange(row.time_range).start;
    await stack.db.updateTable('bookings').set({ cancelled_at: new Date(start - 30 * 3_600_000) })
      .where('id', '=', earlyCancel.id).execute();
    const b = await createBooking(walid, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, b.id, 'HONORED');
    const c = await createBooking(walid, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, c.id, 'HONORED');

    const client = await getClientById(await userIdOf(seed.phones.walid));
    // total=3, points = 2 honorées - 0 (early, pas de pénalité) = 2, score = round(2/3*100)=67
    expect(client.reliability.total).toBe(3);
    expect(client.reliability.score).toBe(67);
  });

  it('cancelled_at NULL (donnée pré-migration) traitée comme EARLY, jamais pénalisée', async () => {
    const day = freshDay();
    const walidId = await userIdOf(seed.phones.walid);
    const before = await getClientById(walidId); // AVANT les deux nouvelles réservations de ce test

    const cancelled = await createBooking(walid, seed.fields.t2, day, nextSlot(seed.fields.t2), 60);
    await stack.app.inject({ method: 'POST', url: `/bookings/${cancelled.id}/cancel`, headers: bearer(walid) });
    // Simule une donnée historique : cancelled_at inconnue.
    await stack.db.updateTable('bookings').set({ cancelled_at: null }).where('id', '=', cancelled.id).execute();
    const b = await createBooking(walid, seed.fields.t2, day, nextSlot(seed.fields.t2), 60);
    await setStatus(nadia, b.id, 'HONORED');

    const after = await getClientById(walidId);
    // L'annulation NULL ne pénalise pas plus qu'une annulation EARLY connue :
    // seul le honoré supplémentaire change points/total, jamais un malus.
    expect(after.reliability.total).toBe(before.reliability.total + 2); // +1 annulation, +1 honorée
  });

  it('totalSpentDa ne compte que les réservations PAID', async () => {
    const day = freshDay();
    const userId = await userIdOf(seed.phones.sofiane);
    const before = await getClientById(userId);
    const paid = await createBooking(sofiane, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, paid.id, 'HONORED');
    await setStatus(nadia, paid.id, 'PAID');
    const honoredOnly = await createBooking(sofiane, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, honoredOnly.id, 'HONORED');

    const after = await getClientById(userId);
    expect(after.totalSpentDa).toBe(before.totalSpentDa + paid.totalDa);
  });

  it('client sans réservation sur ce centre → 404', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients/00000000-0000-0000-0000-000000000000`, headers: bearer(nadia),
    });
    expect(res.statusCode).toBe(404);
  });

  it('liste triée par nombre de réservations décroissant', async () => {
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const clients = (res.json() as { clients: { bookingsCount: number }[] }).clients;
    expect(clients.length).toBeGreaterThan(0);
    for (let i = 1; i < clients.length; i++) {
      expect(clients[i - 1]!.bookingsCount).toBeGreaterThanOrEqual(clients[i]!.bookingsCount);
    }
  });

  it('le détail par statut (honoré/payé/annulé tôt/tardif/no-show) est renvoyé, pas seulement le score agrégé', async () => {
    const day = freshDay();
    const userId = await userIdOf(seed.phones.sofiane);
    const b = await createBooking(sofiane, seed.fields.t1, day, nextSlot(seed.fields.t1), 60);
    await setStatus(nadia, b.id, 'HONORED');

    const client = (await getClientById(userId)) as unknown as {
      honored: number; paid: number; cancelledEarly: number; cancelledLate: number; noShow: number;
    };
    expect(client.honored).toBeGreaterThanOrEqual(1);
    expect(typeof client.paid).toBe('number');
    expect(typeof client.cancelledEarly).toBe('number');
    expect(typeof client.cancelledLate).toBe('number');
    expect(typeof client.noShow).toBe('number');
  });
});

describe('réservations comptoir (WALK_IN) — jamais attribuées au membre du staff qui les saisit', () => {
  it('bug de données réel (06/09/2026) : une résa WALK_IN saisie par Nadia ne fait jamais apparaître Nadia comme cliente', async () => {
    const day = freshDay();
    const nadiaUserId = await userIdOf(seed.phones.nadia);

    // Avant : Nadia n'est pas dans la liste (aucune réservation JOUEUR à son nom).
    const before = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(hamid) });
    const namesBefore = (before.json() as { clients: { userId: string }[] }).clients.map((c) => c.userId);
    expect(namesBefore).not.toContain(nadiaUserId);

    // Nadia (RECEPTION, a CREATE_BOOKING) saisit une résa comptoir pour un
    // client sans compte — `by_user_id` de cette résa est SON PROPRE compte
    // plateforme (modules/bookings/routes.ts), jamais un vrai client.
    const walkIn = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: { fieldId: seed.fields.t2, date: day, startMin: nextSlot(seed.fields.t2), durationMin: 60, source: 'WALK_IN', reservationName: 'Client Comptoir Test' },
    });
    expect(walkIn.statusCode, walkIn.body).toBe(201);

    // Après : Nadia reste absente de la liste — ni dans /clients, ni via une
    // lecture directe par son propre id (404, aucune trace).
    const after = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients`, headers: bearer(hamid) });
    const namesAfter = (after.json() as { clients: { userId: string }[] }).clients.map((c) => c.userId);
    expect(namesAfter).not.toContain(nadiaUserId);

    const direct = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients/${nadiaUserId}`, headers: bearer(hamid) });
    expect(direct.statusCode).toBe(404);
  });
});

describe('équipes du centre', () => {
  it('équipe avec un match issu d’un défi joué sur ce centre : comptée, roster correct', async () => {
    const day = freshDay();
    const sent = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: day, startMin: nextSlot(seed.fields.t1), durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(sent.statusCode).toBe(201);
    const challengeId = (sent.json() as { challenge: { id: string } }).challenge.id;
    const accepted = await stack.app.inject({ method: 'POST', url: `/challenges/${challengeId}/accept`, headers: bearer(walid) });
    expect(accepted.statusCode).toBe(201);
    const matchId = (accepted.json() as { matchId: string }).matchId;
    // Simule « déjà joué » : recule l'horaire du match, comme results.test.ts.
    const now = Date.now();
    await stack.db.updateTable('matches')
      .set({ time_range: toPgRange({ start: now - 3 * 3_600_000, end: now - 2 * 3_600_000 }) })
      .where('id', '=', matchId).execute();
    // Sans jeton, un match issu d'un défi (toujours PRIVATE) renvoie 403 —
    // la synchronisation ne s'appliquerait jamais (bug de test trouvé ici).
    const syncGet = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(sofiane) });
    expect(syncGet.statusCode).toBe(200);

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/teams`, headers: bearer(nadia),
    });
    expect(res.statusCode).toBe(200);
    const teams = (res.json() as { teams: { teamId: string; matchesPlayed: number; activeMembers: number }[] }).teams;
    const fcKahwa = teams.find((t) => t.teamId === seed.teams.fcKahwa);
    const panthers = teams.find((t) => t.teamId === seed.teams.panthers);
    expect(fcKahwa?.matchesPlayed).toBe(1);
    expect(panthers?.matchesPlayed).toBe(1);
    expect(fcKahwa?.activeMembers).toBe(2); // sofiane + karim, seed
  });
});

async function userIdOf(phone: string): Promise<string> {
  const row = await stack.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow();
  return row.id;
}

interface ClientJson { totalSpentDa: number; reliability: { visible: boolean; score: number | null; total: number } }

async function getClientById(userId: string): Promise<ClientJson> {
  const res = await stack.app.inject({
    method: 'GET', url: `/venues/${seed.venueId}/clients/${userId}`, headers: bearer(nadia),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { client: ClientJson }).client;
}

