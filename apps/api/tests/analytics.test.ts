/* Tranche « CRM Analytics + Caisse » — module Analytics : CA (par source/
   terrain/période), occupation, origine, tendances. Le core (crm.ts/ops.ts)
   calcule tout — cashReport, occupancyRate/occupancyByField,
   bookingOriginShare — l'API ne fait qu'agréger et regrouper les mêmes
   réservations avant de les lui passer. Vrai Postgres 16 éphémère. */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, withBookingStarted, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', sofiane = '';

const nextNonFriday = makeSafeDayPicker();
let dayCursor = 20;
function freshDay(): string {
  const d = nextNonFriday(dayCursor);
  dayCursor += 10; // > fenêtre de recherche de nextNonFriday (7j) : jamais de chevauchement
  return d;
}

/** Comme `freshDay`, mais évite aussi mardi (2) et dimanche (0) — les deux
    abonnements posés par le seed (FC Kahwa T1, Ooredoo T2) tombent sur ces
    jours et occupent réellement ces terrains (chantier Abonnements, 06/09/2026,
    décision d'Aymen : un abonné compte dans le remplissage) — un test qui
    veut vérifier un remplissage SANS aucun abonnement actif doit les éviter,
    sous peine de flakiness selon la date réelle d'exécution. */
function nextDayWithoutSeedSubscriptions(minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 9; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    const wd = weekdayOfDayStart(dayStartMs(date));
    if (wd !== 5 && wd !== 2 && wd !== 0) return date;
  }
  throw new Error('unreachable');
}
function freshDayNoSubscriptions(): string {
  const d = nextDayWithoutSeedSubscriptions(dayCursor);
  dayCursor += 10;
  return d;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas VIEW_ANALYTICS
  sofiane = await loginAs(stack, seed.phones.sofiane); // pas staff du centre
});
afterAll(async () => { await stack.teardown(); });
// Règle 25 : un no-show pose une absence ; ces tests en marquent plusieurs sur la même cliente de démo — sans remise à zéro, la 2e la restreindrait et ses réservations suivantes seraient refusées.
afterEach(async () => { await stack.db.deleteFrom('player_restrictions').execute(); await stack.db.deleteFrom('absences').execute(); });

interface CreatedBooking { id: string; totalDa: number; }

async function createBooking(
  byToken: string, fieldId: string, date: string, startMin: number, durationMin: number, source: string,
): Promise<CreatedBooking> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(byToken),
    payload: {
      fieldId, date, startMin, durationMin, source,
      // T3 (padel) a deux formats — le format est alors obligatoire.
      ...(fieldId === seed.fields.t3 ? { format: 'DOUBLE' } : {}),
      // requis côté API uniquement pour WALK_IN (CRM Auth V1) — un compte
      // plateforme n'a pas de req.auth.name à défaut, contrairement au joueur.
      ...(source === 'WALK_IN' ? { reservationName: 'Client comptoir' } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: CreatedBooking }).booking;
}

async function setStatus(byToken: string, id: string, status: string, reason?: 'STAFF_ERROR' | 'CLIENT'): Promise<void> {
  // P1-3 : pas de no-show avant le début du créneau — la ligne est reculée le temps de l'appel, puis remise en place.
  const call = () => stack.app.inject({
    method: 'POST', url: `/bookings/${id}/status`, headers: bearer(byToken),
    payload: { status, ...(reason ? { reason } : {}) },
  });
  const res = status === 'NO_SHOW' ? await withBookingStarted(stack.db, id, call) : await call();
  expect(res.statusCode, res.body).toBe(200);
}

describe('permissions', () => {
  it('RECEPTION et non-membre refusés (VIEW_ANALYTICS = Manager+)', async () => {
    const day = freshDay();
    const asReception = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(nadia),
    });
    expect(asReception.statusCode).toBe(403);
    // sofiane est un jeton Player, pas un compte plateforme — 401, pas 403.
    const asOutsider = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(sofiane),
    });
    expect(asOutsider.statusCode).toBe(401);
    const asManager = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(yacine),
    });
    expect(asManager.statusCode).toBe(200);
  });

  it('période invalide refusée (format, ordre, amplitude)', async () => {
    const bad1 = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=nimportequoi&to=2026-01-01`, headers: bearer(hamid),
    });
    expect(bad1.statusCode).toBe(400);
    const day = freshDay();
    const bad2 = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=2020-01-01`, headers: bearer(hamid),
    });
    expect(bad2.statusCode).toBe(400);
  });
});

describe('CA par source et par terrain', () => {
  it('collecté / engagé / perdu (annulé, no-show), réparti correctement', async () => {
    const day = freshDay();
    const paid = await createBooking(sofiane, seed.fields.t1, day, 540, 90, 'MOUBARAT');
    await setStatus(nadia, paid.id, 'HONORED');
    await setStatus(nadia, paid.id, 'PAID');

    const engaged = await createBooking(sofiane, seed.fields.t1, day, 660, 90, 'PHONE');

    const cancelled = await createBooking(nadia, seed.fields.t2, day, 540, 90, 'WALK_IN');
    await setStatus(yacine, cancelled.id, 'CANCELLED', 'CLIENT');

    const noShow = await createBooking(sofiane, seed.fields.t2, day, 660, 90, 'MOUBARAT');
    await setStatus(nadia, noShow.id, 'NO_SHOW');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      overall: { collected: number; engaged: number; lostCancelled: number; lostNoShow: number };
      bySource: Record<string, { collected: number; engaged: number }>;
      byField: Record<string, { collected: number; engaged: number; lostCancelled: number; lostNoShow: number }>;
    };
    expect(body.overall.collected).toBe(paid.totalDa);
    expect(body.overall.engaged).toBe(engaged.totalDa);
    expect(body.overall.lostCancelled).toBe(cancelled.totalDa);
    expect(body.overall.lostNoShow).toBe(noShow.totalDa);

    expect(body.bySource.MOUBARAT!.collected).toBe(paid.totalDa);
    expect(body.bySource.PHONE!.engaged).toBe(engaged.totalDa);
    expect(body.bySource.WALK_IN!.collected).toBe(0);

    expect(body.byField[seed.fields.t1]!.collected).toBe(paid.totalDa);
    expect(body.byField[seed.fields.t1]!.engaged).toBe(engaged.totalDa);
    expect(body.byField[seed.fields.t2]!.lostCancelled).toBe(cancelled.totalDa);
    expect(body.byField[seed.fields.t2]!.lostNoShow).toBe(noShow.totalDa);
  });

  it('motif d’annulation (15/09/2026) : une annulation STAFF_ERROR n’ajoute RIEN au CA perdu ; CLIENT compte normalement', async () => {
    const day = freshDay();
    const staffError = await createBooking(nadia, seed.fields.t1, day, 540, 90, 'WALK_IN');
    await setStatus(yacine, staffError.id, 'CANCELLED', 'STAFF_ERROR');
    const client = await createBooking(nadia, seed.fields.t1, day, 660, 90, 'WALK_IN');
    await setStatus(yacine, client.id, 'CANCELLED', 'CLIENT');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    const body = res.json() as {
      overall: { lostCancelled: number };
      byField: Record<string, { lostCancelled: number }>;
      counts: { overall: { cancelled: number } };
    };
    // Seule la résa CLIENT compte dans le CA perdu — jamais la somme des deux.
    expect(body.overall.lostCancelled).toBe(client.totalDa);
    expect(body.byField[seed.fields.t1]!.lostCancelled).toBe(client.totalDa);
    // bookingCounts, lui, compte TOUTE annulation (décision confirmée) : les
    // deux apparaissent dans le compteur brut, jamais un côté invisible.
    expect(body.counts.overall.cancelled).toBe(2);
  });

  it('décompte par statut (honored/paid/noShow/cancelled) — RESERVED exclu de tous les compartiments', async () => {
    const day = freshDay();
    const honoredOnly = await createBooking(sofiane, seed.fields.t1, day, 540, 60, 'MOUBARAT');
    await setStatus(nadia, honoredOnly.id, 'HONORED');

    const paid = await createBooking(sofiane, seed.fields.t1, day, 660, 60, 'MOUBARAT');
    await setStatus(nadia, paid.id, 'HONORED');
    await setStatus(nadia, paid.id, 'PAID');

    const noShow = await createBooking(sofiane, seed.fields.t1, day, 780, 60, 'MOUBARAT');
    await setStatus(nadia, noShow.id, 'NO_SHOW');

    const cancelled = await createBooking(sofiane, seed.fields.t1, day, 900, 60, 'MOUBARAT');
    await setStatus(yacine, cancelled.id, 'CANCELLED', 'CLIENT'); // CANCEL_BOOKING = Réception+ depuis CRM-4 (27/09/2026) ; yacine (MANAGER) l'a déjà, sans rapport avec ce test

    // Reste RESERVED — ne doit apparaître dans AUCUN des quatre compartiments
    // (une résa encore en attente n'est ni un succès ni un échec).
    await createBooking(sofiane, seed.fields.t1, day, 1020, 60, 'MOUBARAT');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      counts: { overall: { honored: number; paid: number; noShow: number; cancelled: number } };
    };
    expect(body.counts.overall).toEqual({ honored: 1, paid: 1, noShow: 1, cancelled: 1 });
  });

  it('fieldId filtre la période à un seul terrain', async () => {
    const day = freshDay();
    await createBooking(sofiane, seed.fields.t1, day, 540, 60, 'MOUBARAT');
    await createBooking(sofiane, seed.fields.t2, day, 540, 60, 'MOUBARAT');
    const res = await stack.app.inject({
      method: 'GET',
      url: `/venues/${seed.venueId}/analytics/revenue?from=${day}&to=${day}&fieldId=${seed.fields.t1}`,
      headers: bearer(hamid),
    });
    const body = res.json() as { byField: Record<string, unknown> };
    expect(Object.keys(body.byField)).toEqual([seed.fields.t1]);
  });
});

describe('occupation', () => {
  it('calcul exact : minutes réservées (statuts vivants seulement) ÷ minutes ouvertes', async () => {
    // Jour SANS aucun abonnement actif (évite aussi mardi/dimanche, jours des
    // deux abonnements du seed) : ce test vérifie le remplissage à partir des
    // seules résas réelles — non-régression du chantier Analytics d'origine,
    // toujours vraie même après l'ajout des abonnements au calcul (06/09/2026).
    const day = freshDayNoSubscriptions();
    // T1 : deux réservations "vivantes" de 90 min (RESERVED + PAID comptent) ;
    // T2 : une annulée (ne compte pas) ; T3 : rien.
    const a = await createBooking(sofiane, seed.fields.t1, day, 540, 90, 'MOUBARAT');
    await setStatus(nadia, a.id, 'HONORED');
    await setStatus(nadia, a.id, 'PAID');
    await createBooking(sofiane, seed.fields.t1, day, 660, 90, 'PHONE'); // reste RESERVED
    const cancelled = await createBooking(nadia, seed.fields.t2, day, 540, 90, 'WALK_IN');
    await setStatus(yacine, cancelled.id, 'CANCELLED', 'CLIENT');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/occupancy?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { overall: number; byField: Record<string, number>; openMinutesPerField: number };

    const openMinutes = 1500 - 480; // horaires seed, jour non-vendredi : 08:00 → 01:00(+1)
    expect(body.openMinutesPerField).toBe(openMinutes);
    expect(body.byField[seed.fields.t1]).toBeCloseTo(180 / openMinutes, 10);
    expect(body.byField[seed.fields.t2]).toBeCloseTo(0, 10);
    expect(body.byField[seed.fields.t3]).toBeCloseTo(0, 10);
    expect(body.overall).toBeCloseTo(180 / (openMinutes * 3), 10);
  });

  it('un abonnement actif fait monter le remplissage — décision d’Aymen (06/09) : un abonné occupe réellement le terrain', async () => {
    const day = freshDayNoSubscriptions();
    const weekday = weekdayOfDayStart(dayStartMs(day));
    const sub = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: {
        fieldId: seed.fields.t3, weekday, startMin: 540, durationMin: 90,
        holderName: 'Abonné Test Occupation', activeFrom: algiersDateOf(Date.now() - 86_400_000),
      },
    });
    expect(sub.statusCode, sub.body).toBe(201);

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/occupancy?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { overall: number; byField: Record<string, number>; openMinutesPerField: number };
    const openMinutes = body.openMinutesPerField;
    // T3 n'a AUCUNE résa réelle ce jour-là — tout son remplissage vient de
    // l'abonnement, jamais d'une résa fictive : la preuve qu'il est bien
    // compté, pas une coïncidence avec une autre donnée.
    expect(body.byField[seed.fields.t3]).toBeCloseTo(90 / openMinutes, 10);
    expect(body.overall).toBeGreaterThan(0);
  });

  it('un terrain archivé après coup n’gonfle pas l’occupation globale (bookings passés exclus, comme byField)', async () => {
    // Audit 09/09/2026 : oubli du chantier Abonnements (0a9258d) — ce test
    // utilisait encore freshDay() (n'évite que le vendredi), alors que T1
    // et T2 portent chacun un abonnement actif du seed (FC Kahwa/mardi,
    // Ooredoo/dimanche). Un jour tombant sur l'un des deux gonflait `overall`
    // via CES terrains, sans rapport avec T3 (le seul sujet réel du test) —
    // flake daté, pas un défaut du code produit. Voir freshDayNoSubscriptions
    // ci-dessus, déjà utilisée par le test voisin pour la même raison.
    const day = freshDayNoSubscriptions();
    // T3 : réservation vivante, puis le terrain est archivé APRÈS coup — son
    // historique reste réel, mais ne doit compter ni dans overall ni dans
    // byField (les deux excluent déjà les terrains archivés).
    await createBooking(sofiane, seed.fields.t3, day, 540, 60, 'MOUBARAT');
    await stack.db.updateTable('fields').set({ status: 'ARCHIVED' }).where('id', '=', seed.fields.t3).execute();

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/occupancy?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { overall: number; byField: Record<string, number> };
    expect(body.byField[seed.fields.t3]).toBeUndefined();
    expect(body.overall).toBe(0); // sinon les minutes réservées sur T3 gonfleraient overall sans dénominateur en face
  });
});

describe('origine des réservations', () => {
  it('parts Moubarat / téléphone / comptoir — annulées exclues, no-show comptées', async () => {
    const day = freshDay();
    const a = await createBooking(sofiane, seed.fields.t1, day, 540, 60, 'MOUBARAT');
    await setStatus(nadia, a.id, 'NO_SHOW'); // compte quand même dans l'origine
    await createBooking(sofiane, seed.fields.t1, day, 660, 60, 'PHONE');
    const cancelled = await createBooking(nadia, seed.fields.t2, day, 540, 60, 'WALK_IN');
    await setStatus(yacine, cancelled.id, 'CANCELLED', 'CLIENT'); // exclue de l'origine

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/origin?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    const body = res.json() as { total: number; moubarat: number; phone: number; walkIn: number };
    expect(body.total).toBe(2);
    expect(body.moubarat).toBe(1);
    expect(body.phone).toBe(1);
    expect(body.walkIn).toBe(0);
  });
});

describe('tendances', () => {
  it('compare la période à la période précédente de même durée', async () => {
    const day = freshDay();
    const prevDate = new Date(dayStartMs(day) - 86_400_000);
    const priorDay = algiersDateOf(prevDate.getTime());

    // 900 (15:00) : dans la fenêtre d'ouverture que priorDay soit un vendredi
    // (ouvre 14:00) ou non (ouvre 08:00) — day est non-vendredi (nextNonFriday)
    // mais day-1 ne l'est pas garanti.
    const prior = await createBooking(sofiane, seed.fields.t1, priorDay, 900, 60, 'MOUBARAT');
    await setStatus(nadia, prior.id, 'HONORED');
    await setStatus(nadia, prior.id, 'PAID');

    const current = await createBooking(sofiane, seed.fields.t1, day, 900, 60, 'MOUBARAT');
    await setStatus(nadia, current.id, 'HONORED');
    await setStatus(nadia, current.id, 'PAID');

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/analytics/trends?from=${day}&to=${day}`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      priorPeriod: { fromDay: string; toDay: string };
      revenue: { current: { collected: number }; previous: { collected: number }; collectedChangePct: number | null };
    };
    expect(body.priorPeriod.fromDay).toBe(priorDay);
    expect(body.priorPeriod.toDay).toBe(priorDay);
    expect(body.revenue.current.collected).toBe(current.totalDa);
    expect(body.revenue.previous.collected).toBe(prior.totalDa);
    const expectedPct = Math.round(((current.totalDa - prior.totalDa) / prior.totalDa) * 1000) / 10;
    expect(body.revenue.collectedChangePct).toBe(expectedPct);
  });
});
