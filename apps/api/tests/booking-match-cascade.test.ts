import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, insertTestField, withBookingStarted, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { currentPushDispatcher } from '../src/notifications/push.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* BUG-1 de l'audit pré-lancement (26/09/2026, P0) — cascade réservation ↔ match, dans les DEUX sens.

   Avant : annuler une réservation (joueur ou centre) laissait son match OPEN, dans le fil, rejoignable, sans aucune
   notification, et le créneau libéré était revendu — deux groupes pour un même terrain. Annuler un match laissait la
   réservation RESERVED et verrouillée à vie (MATCH_LOCKED sur `match_id` posé), invisible du CRM.

   Décisions d'Aymen (26/09/2026) : D1 nouveau type MATCH_CANCELLED_BY_CENTER (le libellé ne dit jamais « l'organisateur a
   annulé » quand c'est le centre) ; D2 l'organisateur CHOISIT d'annuler aussi sa réservation (`cancelBooking`) ; D3 le
   réservant sans match est prévenu (BOOKING_CANCELLED_BY_CENTER). Vrai Postgres, verrous réels, concurrence réelle. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', fouad = '';
let yacine = '', nadia = '', hamid = '';

const MIN_MS = 60_000;

/** Jamais un vendredi (T1 ouvre à 14:00 ce jour-là). Valeurs espacées de 2 au moins entre groupes de tests : sauter le
    vendredi décale d'un jour et deux valeurs consécutives retomberaient sur le même jour. */
const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  fouad = await loginAs(stack, seed.phones.fouad);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER — CANCEL_BOOKING
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — cash, MODIFY_BOOKING
});
afterAll(async () => { await stack.teardown(); });

/* --- Aides ------------------------------------------------------------------ */

async function book(token: string, fieldId: string, date: string, startMin: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(token),
    payload: { fieldId, date, startMin, durationMin: 60, ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string } }).booking.id;
}

async function createMatch(token: string, bookingId: string, title: string): Promise<string> {
  const res = await stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(token), payload: { bookingId, title } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { match: { id: string } }).match.id;
}

async function join(token: string, matchId: string) {
  return stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(token) });
}

async function centerCancel(token: string, bookingId: string, reason: 'CLIENT' | 'STAFF_ERROR' = 'CLIENT') {
  return stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/status`, headers: bearer(token), payload: { status: 'CANCELLED', reason } });
}

async function matchStatus(id: string): Promise<string> {
  return (await stack.db.selectFrom('matches').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;
}

async function bookingRow(id: string) {
  return stack.db.selectFrom('bookings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/** Les seules notifications d'ANNULATION reçues par `userId` pour cette référence — jamais les PLAYER_JOINED que
    l'organisateur reçoit quand un inscrit arrive (hors sujet ici). */
async function notifs(userId: string, refId: string) {
  return stack.db.selectFrom('notifications').select(['type', 'ref_id'])
    .where('user_id', '=', userId).where('ref_id', '=', refId)
    .where('type', 'in', ['MATCH_CANCELLED', 'MATCH_CANCELLED_BY_CENTER', 'BOOKING_CANCELLED_BY_CENTER'])
    .orderBy('created_at', 'asc').execute();
}

async function inFeed(matchId: string): Promise<boolean> {
  const res = await stack.app.inject({ method: 'GET', url: '/matches?limit=100' });
  return (res.json() as { matches: { id: string }[] }).matches.some((m) => m.id === matchId);
}

async function freeStarts(fieldId: string, date: string): Promise<number[]> {
  const res = await stack.app.inject({ method: 'GET', url: `/fields/${fieldId}/availability?date=${date}&duration=60` });
  expect(res.statusCode).toBe(200);
  return (res.json() as { starts: { startMin: number }[] }).starts.map((s) => s.startMin);
}

/** Réservation + match insérés DIRECTEMENT (hors horaires, à une heure choisie — la fenêtre H-2 seule compte) ; le lien
    est `bookings.match_id` seul quand `withBookingId` est faux, comme les matchs des scripts de démo. */
async function insertLinkedPair(opts: { fieldId: string; sport: 'FOOTBALL' | 'PADEL'; format: string; startMs: number; withBookingId: boolean; link?: boolean }) {
  const range = toPgRange({ start: opts.startMs, end: opts.startMs + 60 * MIN_MS });
  const b = await stack.db.insertInto('bookings').values({
    field_id: opts.fieldId, time_range: range, source: 'MOUBARAT', verified_by_center: true,
    by_user_id: seed.users.sofiane, reservation_name: 'Sofiane B.', reference: `CAS-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000,
  }).returning('id').executeTakeFirstOrThrow();
  const m = await stack.db.insertInto('matches').values({
    sport: opts.sport, format: opts.format as never, level: 'LOISIR', title: 'Match direct',
    venue_id: seed.venueId, field_id: opts.fieldId, time_range: range, capacity: 10, price_per_player_da: 300,
    organizer_id: seed.users.sofiane, status: 'OPEN', ...(opts.withBookingId ? { booking_id: b.id } : {}),
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values({ match_id: m.id, user_id: seed.users.sofiane, status: 'JOINED' }).execute();
  if (opts.link !== false) await stack.db.updateTable('bookings').set({ match_id: m.id }).where('id', '=', b.id).execute();
  return { bookingId: b.id, matchId: m.id };
}

/* --- Sens 1 : la réservation est annulée par le CENTRE ------------------------- */

describe('sens 1 — le centre annule une réservation qui porte un match', () => {
  const D1 = nextNonFriday(3);
  const KARIM_DEVICE = 'a'.repeat(64);

  it('match vivant à 3 inscrits : annulé, hors du fil, fermé aux nouveaux ; les 3 inscrits prévenus (organisateur compris) ; journal ; créneau libre ; push', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D1, 600);
    const matchId = await createMatch(sofiane, bookingId, 'Cascade centre');
    expect((await join(karim, matchId)).statusCode).toBe(200);
    expect((await join(walid, matchId)).statusCode).toBe(200);
    expect(await inFeed(matchId)).toBe(true);
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(karim), payload: { token: KARIM_DEVICE, platform: 'ios' } });
    stack.push.sent.length = 0;

    const res = await centerCancel(yacine, bookingId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'CANCELLED', matchCancelled: true, matchTitle: 'Cascade centre', notifiedPlayers: 3 });

    expect(await matchStatus(matchId)).toBe('CANCELLED');
    expect(await inFeed(matchId)).toBe(false);
    const late = await join(fouad, matchId);
    expect(late.statusCode).toBe(400);
    expect((late.json() as { error: string }).error).toBe('MATCH_CANCELLED');

    // Chaque inscrit, l'organisateur compris, reçoit UNE notification qui dit LE CENTRE — jamais « l'organisateur a annulé ».
    for (const uid of [seed.users.sofiane, seed.users.karim, seed.users.walid]) {
      expect(await notifs(uid, matchId)).toEqual([{ type: 'MATCH_CANCELLED_BY_CENTER', ref_id: matchId }]);
    }
    expect(await notifs(seed.users.fouad, matchId)).toEqual([]);

    const audit = await stack.db.selectFrom('audit_log').select('summary')
      .where('object_id', '=', bookingId).where('action', '=', 'BOOKING_CANCELLED').executeTakeFirstOrThrow();
    expect(audit.summary).toContain('match « Cascade centre » annulé');
    expect(audit.summary).toContain('3 inscrits prévenus');

    // Le créneau redevient réellement libre : c'est le sens même de l'annulation — mais plus jamais avec un match vivant dessus.
    expect(await freeStarts(seed.fields.t1, D1)).toContain(600);

    await currentPushDispatcher()?.idle();
    const push = stack.push.sent.find((s) => s.devices.some((d) => d.token === KARIM_DEVICE));
    expect(push?.message.title).toBe('Match annulé par le centre');
    expect(push?.message.body).not.toContain('organisateur');
  });

  it('motif STAFF_ERROR : même cascade (le créneau disparaît aussi pour les joueurs)', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D1, 720);
    const matchId = await createMatch(sofiane, bookingId, 'Cascade erreur');
    expect((await join(karim, matchId)).statusCode).toBe(200);

    const res = await centerCancel(yacine, bookingId, 'STAFF_ERROR');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ matchCancelled: true, notifiedPlayers: 2 });
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    expect(await notifs(seed.users.karim, matchId)).toEqual([{ type: 'MATCH_CANCELLED_BY_CENTER', ref_id: matchId }]);
    expect(await notifs(seed.users.sofiane, matchId)).toEqual([{ type: 'MATCH_CANCELLED_BY_CENTER', ref_id: matchId }]);
  });

  it('sans match : le réservant (compte joueur) est prévenu — BOOKING_CANCELLED_BY_CENTER ; une résa Comptoir ne prévient personne et ne plante pas', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D1, 840);
    const res = await centerCancel(yacine, bookingId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ matchCancelled: false, matchTitle: null, notifiedPlayers: 1 });
    expect(await notifs(seed.users.sofiane, bookingId)).toEqual([{ type: 'BOOKING_CANCELLED_BY_CENTER', ref_id: bookingId }]);
    const audit = await stack.db.selectFrom('audit_log').select('summary')
      .where('object_id', '=', bookingId).where('action', '=', 'BOOKING_CANCELLED').executeTakeFirstOrThrow();
    expect(audit.summary).toContain('réservant prévenu dans l’app');

    // Comptoir : by_user_id est un compte PLATEFORME (pas dans users) — notifications.user_id référence users(id) : on
    // ne tente jamais l'écriture (sinon 500 sur la FK).
    const walkIn = await book(nadia, seed.fields.t1, D1, 900, { source: 'WALK_IN', reservationName: 'Client comptoir' });
    const res2 = await centerCancel(yacine, walkIn);
    expect(res2.statusCode, res2.body).toBe(200);
    expect(res2.json()).toMatchObject({ matchCancelled: false, notifiedPlayers: 0 });
    const any = await stack.db.selectFrom('notifications').select('type').where('ref_id', '=', walkIn).execute();
    expect(any).toEqual([]);
  });

  it('le contrat du CRM : GET /venues/:id/bookings sert match.status (OPEN sur un match vivant)', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D1, 960);
    const matchId = await createMatch(sofiane, bookingId, 'Statut servi');
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${D1}`, headers: bearer(hamid) });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { bookings: { id: string; matchId: string | null; match?: { status: string; title: string } }[] }).bookings.find((b) => b.id === bookingId);
    expect(row?.matchId).toBe(matchId);
    expect(row?.match).toMatchObject({ status: 'OPEN', title: 'Statut servi' });
  });
});

describe('sens 1 — ce qui ne déclenche PAS la cascade', () => {
  const D2 = nextNonFriday(5);

  it('HONORED puis PAID, ou NO_SHOW : le match n’est jamais touché', async () => {
    const b1 = await book(sofiane, seed.fields.t1, D2, 600);
    const m1 = await createMatch(sofiane, b1, 'Cash cycle');
    for (const status of ['HONORED', 'PAID']) {
      const res = await stack.app.inject({ method: 'POST', url: `/bookings/${b1}/status`, headers: bearer(nadia), payload: { status } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).not.toHaveProperty('matchCancelled');
      expect(await matchStatus(m1)).toBe('OPEN');
    }
    const b2 = await book(sofiane, seed.fields.t1, D2, 720);
    const m2 = await createMatch(sofiane, b2, 'No-show');
    // P1-3 : pas de no-show avant le début du créneau — la ligne est reculée le temps de l'appel, puis remise en place.
    const res = await withBookingStarted(stack.db, b2, () => stack.app.inject({ method: 'POST', url: `/bookings/${b2}/status`, headers: bearer(nadia), payload: { status: 'NO_SHOW' } }));
    expect(res.statusCode, res.body).toBe(200);
    expect(await matchStatus(m2)).toBe('OPEN');
    expect(await stack.db.selectFrom('notifications').select('type').where('ref_id', 'in', [m1, m2]).execute()).toEqual([]);
  });

  it('match déjà annulé par son organisateur : le centre annule ensuite la résa — aucun inscrit prévenu deux fois, le réservant l’est', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D2, 840);
    const matchId = await createMatch(sofiane, bookingId, 'Déjà annulé');
    expect((await join(karim, matchId)).statusCode).toBe(200);
    const cancelMatch = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: {} });
    expect(cancelMatch.statusCode, cancelMatch.body).toBe(200);
    expect(await notifs(seed.users.karim, matchId)).toEqual([{ type: 'MATCH_CANCELLED', ref_id: matchId }]);

    const res = await centerCancel(yacine, bookingId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ matchCancelled: false, notifiedPlayers: 1 });
    expect(await notifs(seed.users.karim, matchId)).toHaveLength(1); // toujours une seule
    expect(await notifs(seed.users.sofiane, bookingId)).toEqual([{ type: 'BOOKING_CANCELLED_BY_CENTER', ref_id: bookingId }]);
  });
});

/* --- Sens 1 : la réservation est annulée par le JOUEUR ---------------------------- */

describe('sens 1 — le joueur annule sa réservation', () => {
  const D3 = nextNonFriday(7);

  it('le match s’annule avec elle : les inscrits sont prévenus (MATCH_CANCELLED), jamais l’annuleur ; message explicite', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D3, 600);
    const matchId = await createMatch(sofiane, bookingId, 'Cascade joueur');
    expect((await join(karim, matchId)).statusCode).toBe(200);
    expect((await join(walid, matchId)).statusCode).toBe(200);

    const res = await stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/cancel`, headers: bearer(sofiane) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: boolean; matchCancelled: boolean; message: string };
    expect(body.matchCancelled).toBe(true);
    expect(body.message).toContain('« Cascade joueur » est annulé');
    expect(body.message).toContain('2 inscrits prévenus');

    expect(await matchStatus(matchId)).toBe('CANCELLED');
    expect(await inFeed(matchId)).toBe(false);
    expect(await notifs(seed.users.karim, matchId)).toEqual([{ type: 'MATCH_CANCELLED', ref_id: matchId }]);
    expect(await notifs(seed.users.walid, matchId)).toEqual([{ type: 'MATCH_CANCELLED', ref_id: matchId }]);
    expect(await notifs(seed.users.sofiane, matchId)).toEqual([]);
    const mine = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(karim) });
    expect((mine.json() as { matches: { id: string; status: string }[] }).matches.find((m) => m.id === matchId)?.status).toBe('CANCELLED');
  });

  it('sans match : message inchangé, matchCancelled: false', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D3, 720);
    const res = await stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/cancel`, headers: bearer(sofiane) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, matchCancelled: false, message: 'Annulée sans frais. Le créneau est libéré.' });
  });

  it('sous H-2 (§18/§19, 25/10/2026) : acceptée quand même, compte comme une demi-absence — le match cascade avec elle', async () => {
    const { bookingId, matchId } = await insertLinkedPair({ fieldId: seed.fields.t3, sport: 'PADEL', format: 'SIMPLE', startMs: Date.now() + 60 * MIN_MS, withBookingId: true });
    const res = await stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/cancel`, headers: bearer(sofiane) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: boolean; matchCancelled: boolean; message: string };
    expect(body.matchCancelled).toBe(true);
    expect(body.message).toContain('demi-absence');
    expect((await bookingRow(bookingId)).status).toBe('CANCELLED');
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    // Seul inscrit = l'annuleur lui-même (insertLinkedPair) — RECIPIENTS.matchCancelled l'exclut, personne à prévenir.
    expect(await stack.db.selectFrom('notifications').select('type').where('ref_id', '=', matchId).execute()).toEqual([]);
  });
});

/* --- Sens 2 : le match est annulé par son organisateur ---------------------------- */

describe('sens 2 — l’organisateur annule son match', () => {
  const D4 = nextNonFriday(9);

  it('sans cancelBooking : la réservation reste RESERVED, le CRM voit match.status = CANCELLED, et elle redevient modifiable', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D4, 600);
    const matchId = await createMatch(sofiane, bookingId, 'Match seul');

    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'CANCELLED', bookingCancelled: false, bookingIds: [bookingId] });
    const row = await bookingRow(bookingId);
    expect(row.status).toBe('RESERVED');
    expect(row.match_id).toBe(matchId); // le lien reste (historique) — c'est le STATUT qui dit la vérité

    const crm = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${D4}`, headers: bearer(hamid) });
    const served = (crm.json() as { bookings: { id: string; status: string; match?: { status: string } }[] }).bookings.find((b) => b.id === bookingId);
    expect(served).toMatchObject({ status: 'RESERVED', match: { status: 'CANCELLED' } });

    // Plus de MATCH_LOCKED : preview ET commit d'un déplacement passent (avant ce lot : 409 à vie).
    const preview = await stack.app.inject({
      method: 'GET', url: `/bookings/${bookingId}/reschedule/preview?fieldId=${seed.fields.t1}&date=${D4}&startMin=660&durationMin=60`, headers: bearer(nadia),
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const commit = await stack.app.inject({
      method: 'POST', url: `/bookings/${bookingId}/reschedule`, headers: bearer(nadia),
      payload: { fieldId: seed.fields.t1, date: D4, startMin: 660, durationMin: 60 },
    });
    expect(commit.statusCode, commit.body).toBe(200);
  });

  it('match annulé seul, puis déplacement vers un AUTRE terrain : accepté, le lien vers le match mort est détaché des deux côtés (invariant 0029)', async () => {
    const other = await insertTestField(stack.db, { venue_id: seed.venueId, name: 'T5 cascade', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, status: 'ACTIVE' });
    const bookingId = await book(sofiane, seed.fields.t1, D4, 1020);
    const matchId = await createMatch(sofiane, bookingId, 'Match mort puis déplacé');
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: {} })).statusCode).toBe(200);

    // Sans détachement, `bookings_venue_guard` (migration 0029) refuserait le changement de terrain : 500 venue_isolation_violation.
    const commit = await stack.app.inject({
      method: 'POST', url: `/bookings/${bookingId}/reschedule`, headers: bearer(nadia),
      payload: { fieldId: other.id, date: D4, startMin: 1020, durationMin: 60 },
    });
    expect(commit.statusCode, commit.body).toBe(200);
    const row = await bookingRow(bookingId);
    expect(row.field_id).toBe(other.id);
    expect(row.match_id).toBeNull();
    const match = await stack.db.selectFrom('matches').select(['status', 'booking_id']).where('id', '=', matchId).executeTakeFirstOrThrow();
    expect(match).toEqual({ status: 'CANCELLED', booking_id: null });
  });

  it('cancelBooking: true : match ET réservation annulés (CLIENT, horodatée), inscrits prévenus, créneau libre', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D4, 780);
    const matchId = await createMatch(sofiane, bookingId, 'Tout annuler');
    expect((await join(karim, matchId)).statusCode).toBe(200);

    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: { cancelBooking: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'CANCELLED', bookingCancelled: true, bookingIds: [bookingId] });
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    const row = await bookingRow(bookingId);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancel_reason).toBe('CLIENT');
    expect(row.cancelled_at).not.toBeNull();
    expect(await notifs(seed.users.karim, matchId)).toEqual([{ type: 'MATCH_CANCELLED', ref_id: matchId }]);
    expect(await notifs(seed.users.sofiane, matchId)).toEqual([]);
    expect(await freeStarts(seed.fields.t1, D4)).toContain(780);
  });

  it('cancelBooking: true sous H-2 (§18/§19, 25/10/2026) : acceptée quand même — match ET résa annulés, demi-absence', async () => {
    const { bookingId, matchId } = await insertLinkedPair({ fieldId: seed.fields.t2, sport: 'FOOTBALL', format: '7v7', startMs: Date.now() + 60 * MIN_MS, withBookingId: true });
    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: { cancelBooking: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'CANCELLED', bookingCancelled: true, bookingIds: [bookingId] });
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    const row = await bookingRow(bookingId);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancel_reason).toBe('CLIENT');
    expect(row.cancelled_at).not.toBeNull();
  });

  it('cancelBooking: true sur une résa déjà close (ex. HONORED) : 409 INVALID_TRANSITION — rien n’est annulé à moitié', async () => {
    // +7 j (pas +5 j comme le test suivant, même terrain t2) : jamais le même créneau.
    const { bookingId, matchId } = await insertLinkedPair({ fieldId: seed.fields.t2, sport: 'FOOTBALL', format: '7v7', startMs: Date.now() + 7 * 86_400_000, withBookingId: true });
    await stack.db.updateTable('bookings').set({ status: 'HONORED' }).where('id', '=', bookingId).execute();
    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: { cancelBooking: true } });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('INVALID_TRANSITION');
    expect(await matchStatus(matchId)).toBe('OPEN'); // même la synchronisation LOCKED de la transaction est annulée
    expect((await bookingRow(bookingId)).status).toBe('HONORED');
  });

  it('cancelBooking: true sur un match sans réservation vivante : 409 INVALID_TRANSITION, le match reste OPEN', async () => {
    const { matchId } = await insertLinkedPair({ fieldId: seed.fields.t2, sport: 'FOOTBALL', format: '7v7', startMs: Date.now() + 5 * 86_400_000 + 30 * MIN_MS, withBookingId: false, link: false });
    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: { cancelBooking: true } });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string; message: string }).error).toBe('INVALID_TRANSITION');
    expect((res.json() as { message: string }).message).toContain('Aucune réservation vivante');
    expect(await matchStatus(matchId)).toBe('OPEN');
  });

  it('un non-organisateur, même avec cancelBooking : NOT_ORGANIZER, rien ne bouge', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D4, 900);
    const matchId = await createMatch(sofiane, bookingId, 'Pas à toi');
    const res = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(karim), payload: { cancelBooking: true } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('NOT_ORGANIZER');
    expect(await matchStatus(matchId)).toBe('OPEN');
    expect((await bookingRow(bookingId)).status).toBe('RESERVED');
  });
});

/* --- Matchs des scripts de démo : matches.booking_id NULL, seul bookings.match_id posé ---- */

describe('lien par bookings.match_id seul (matchs des scripts de démo)', () => {
  it('cascade dans les deux sens sans matches.booking_id', async () => {
    const base = Date.now() + 6 * 86_400_000;
    const a = await insertLinkedPair({ fieldId: seed.fields.t2, sport: 'FOOTBALL', format: '7v7', startMs: base + 10 * 60 * MIN_MS, withBookingId: false });
    expect((await join(karim, a.matchId)).statusCode).toBe(200);
    const res = await centerCancel(yacine, a.bookingId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ matchCancelled: true, notifiedPlayers: 2 });
    expect(await matchStatus(a.matchId)).toBe('CANCELLED');
    expect(await notifs(seed.users.karim, a.matchId)).toEqual([{ type: 'MATCH_CANCELLED_BY_CENTER', ref_id: a.matchId }]);

    const b = await insertLinkedPair({ fieldId: seed.fields.t2, sport: 'FOOTBALL', format: '7v7', startMs: base + 12 * 60 * MIN_MS, withBookingId: false });
    const res2 = await stack.app.inject({ method: 'POST', url: `/matches/${b.matchId}/cancel`, headers: bearer(sofiane), payload: { cancelBooking: true } });
    expect(res2.statusCode, res2.body).toBe(200);
    expect(res2.json()).toMatchObject({ bookingCancelled: true, bookingIds: [b.bookingId] });
    expect((await bookingRow(b.bookingId)).status).toBe('CANCELLED');
  });
});

/* --- Concurrence réelle ------------------------------------------------------------ */

describe('concurrence réelle (verrous Postgres, ordre réservation → match des deux côtés)', () => {
  const D6 = nextNonFriday(11);

  it('annulation par le centre ∥ rejoint d’un tiers : jamais de 500 ; le tiers est soit refusé, soit prévenu', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D6, 600);
    const matchId = await createMatch(sofiane, bookingId, 'Course rejoint');
    const [cancel, late] = await Promise.all([centerCancel(yacine, bookingId), join(fouad, matchId)]);
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect([200, 400]).toContain(late.statusCode);
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    const fouadNotifs = await notifs(seed.users.fouad, matchId);
    if (late.statusCode === 200) {
      expect(fouadNotifs).toEqual([{ type: 'MATCH_CANCELLED_BY_CENTER', ref_id: matchId }]); // inscrit juste avant : prévenu
      expect((cancel.json() as { notifiedPlayers: number }).notifiedPlayers).toBe(2);
    } else {
      expect((late.json() as { error: string }).error).toBe('MATCH_CANCELLED');
      expect(fouadNotifs).toEqual([]);
    }
  });

  it('annulation par le centre ∥ annulation du match par l’organisateur : jamais de 500 ni d’interblocage ; une seule notification par inscrit', async () => {
    const bookingId = await book(sofiane, seed.fields.t1, D6, 720);
    const matchId = await createMatch(sofiane, bookingId, 'Course croisée');
    expect((await join(karim, matchId)).statusCode).toBe(200);
    const [byCenter, byOrganizer] = await Promise.all([
      centerCancel(yacine, bookingId),
      stack.app.inject({ method: 'POST', url: `/matches/${matchId}/cancel`, headers: bearer(sofiane), payload: {} }),
    ]);
    expect(byCenter.statusCode, byCenter.body).toBe(200);
    expect([200, 409]).toContain(byOrganizer.statusCode); // 409 INVALID_TRANSITION si le centre a déjà annulé le match
    if (byOrganizer.statusCode === 409) expect((byOrganizer.json() as { error: string }).error).toBe('INVALID_TRANSITION');
    expect((await bookingRow(bookingId)).status).toBe('CANCELLED');
    expect(await matchStatus(matchId)).toBe('CANCELLED');
    const karimNotifs = await notifs(seed.users.karim, matchId);
    expect(karimNotifs).toHaveLength(1);
    expect(['MATCH_CANCELLED', 'MATCH_CANCELLED_BY_CENTER']).toContain(karimNotifs[0]!.type);
  });
});
