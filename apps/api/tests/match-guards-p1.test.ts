import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { currentPushDispatcher } from '../src/notifications/push.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Audit pré-lancement, lot 3 (27/09/2026, GO d'Aymen — règles core) :
   BUG-4 (a) un match ne se pose pas sur une réservation téléphonique que le centre n'a pas confirmée ;
   BUG-4 (b) ni sur un créneau passé ou à moins de 2 h (verrou des inscriptions) ;
   BUG-4 (c) plafond de déclarations téléphoniques non confirmées par joueur + horizon de réservation (API, joueur seulement) ;
   BUG-5 un inscrit retiré par l'organisateur est prévenu (PLAYER_REMOVED, push). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
let hamid = '', nadia = '';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  // Les valeurs de PRODUCTION (défauts du code), posées explicitement : LOOSE_LIMITS desserre l'horizon pour les autres suites.
  stack = await setupTestStack({ envOverrides: { bookingHorizonDays: 60, phoneDeclarationsMaxLive: 2 } });
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION
});
afterAll(async () => { await stack.teardown(); });

async function book(token: string, payload: Record<string, unknown>) {
  return stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(token), payload: { fieldId: seed.fields.t1, durationMin: 60, ...payload } });
}
async function createMatch(token: string, bookingId: string, title = 'Match test') {
  return stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(token), payload: { bookingId, title } });
}
async function insertBooking(startMs: number, fieldId: string, format: string): Promise<string> {
  const b = await stack.db.insertInto('bookings').values({
    field_id: fieldId, time_range: toPgRange({ start: startMs, end: startMs + 60 * MIN_MS }), source: 'MOUBARAT', verified_by_center: true,
    by_user_id: seed.users.sofiane, reservation_name: 'Sofiane B.', reference: `GRD-${Math.floor(Math.random() * 1e6)}`, price_total_da: 3000,
    format: format as never,
  }).returning('id').executeTakeFirstOrThrow();
  return b.id;
}

describe('BUG-4 (a) — pas de match sur une réservation téléphonique que le centre n’a pas confirmée', () => {
  it('déclaration → 409 BOOKING_NOT_VERIFIED ; confirmée par le centre → 201', async () => {
    const D = nextNonFriday(3);
    const declared = await book(sofiane, { date: D, startMin: 600, source: 'PHONE', reservationName: 'Sofiane B.' });
    expect(declared.statusCode, declared.body).toBe(201);
    const bookingId = (declared.json() as { booking: { id: string } }).booking.id;

    const refused = await createMatch(sofiane, bookingId);
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: string; message: string }).error).toBe('BOOKING_NOT_VERIFIED');
    expect((refused.json() as { message: string }).message).toContain('confirmer');

    const verify = await stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/verify`, headers: bearer(hamid) });
    expect(verify.statusCode, verify.body).toBe(200);
    const ok = await createMatch(sofiane, bookingId);
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe('BUG-4 (b) — ni sur un créneau passé, ni sous le verrou H-2', () => {
  it('début dans 1 h → 400 MATCH_LOCKED ; début passé → 400 SLOT_IN_PAST ; aucun match créé', async () => {
    const soon = await insertBooking(Date.now() + 60 * MIN_MS, seed.fields.t3, 'SIMPLE');
    const locked = await createMatch(sofiane, soon);
    expect(locked.statusCode).toBe(400);
    expect((locked.json() as { error: string }).error).toBe('MATCH_LOCKED');

    const past = await insertBooking(Date.now() - 3 * 60 * MIN_MS, seed.fields.t3, 'SIMPLE');
    const gone = await createMatch(sofiane, past);
    expect(gone.statusCode).toBe(400);
    expect((gone.json() as { error: string }).error).toBe('SLOT_IN_PAST');

    const rows = await stack.db.selectFrom('bookings').select('match_id').where('id', 'in', [soon, past]).execute();
    expect(rows.map((r) => r.match_id)).toEqual([null, null]);
  });
});

describe('BUG-4 (c) — plafond de déclarations téléphoniques non confirmées, horizon de réservation (joueur seulement)', () => {
  it('au plus 2 déclarations non confirmées à venir par joueur ; une annulation libère une place', async () => {
    const D = nextNonFriday(5);
    const first = await book(walid, { date: D, startMin: 600, source: 'PHONE', reservationName: 'Walid' });
    expect(first.statusCode, first.body).toBe(201);
    const second = await book(walid, { date: D, startMin: 720, source: 'PHONE', reservationName: 'Walid' });
    expect(second.statusCode, second.body).toBe(201);
    const third = await book(walid, { date: D, startMin: 840, source: 'PHONE', reservationName: 'Walid' });
    expect(third.statusCode).toBe(409);
    expect((third.json() as { error: string }).error).toBe('PHONE_DECLARATIONS_LIMIT');

    // Une réservation App n'est pas comptée : elle passe.
    const app = await book(walid, { date: D, startMin: 960 });
    expect(app.statusCode, app.body).toBe(201);

    const firstId = (first.json() as { booking: { id: string } }).booking.id;
    const cancel = await stack.app.inject({ method: 'POST', url: `/bookings/${firstId}/cancel`, headers: bearer(walid) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const again = await book(walid, { date: D, startMin: 840, source: 'PHONE', reservationName: 'Walid' });
    expect(again.statusCode, again.body).toBe(201);
  });

  it('horizon : +61 jours refusé (400 BOOKING_TOO_FAR), +30 jours accepté ; le comptoir n’est pas limité', async () => {
    const tooFar = await book(karim, { date: algiersDateOf(Date.now() + 61 * DAY_MS), startMin: 900 });
    expect(tooFar.statusCode).toBe(400);
    expect((tooFar.json() as { error: string; message: string }).error).toBe('BOOKING_TOO_FAR');
    expect((tooFar.json() as { message: string }).message).toContain('60 jours');

    const fine = await book(karim, { date: algiersDateOf(Date.now() + 30 * DAY_MS), startMin: 900 });
    expect(fine.statusCode, fine.body).toBe(201);

    const counter = await book(nadia, { date: algiersDateOf(Date.now() + 90 * DAY_MS), startMin: 900, source: 'WALK_IN', reservationName: 'Client comptoir' });
    expect(counter.statusCode, counter.body).toBe(201);
  });
});

describe('BUG-5 — un inscrit retiré par l’organisateur est prévenu', () => {
  it('PLAYER_REMOVED écrit pour le joueur retiré (et lui seul), poussé vers son appareil ; il ne peut pas revenir', async () => {
    const D = nextNonFriday(7);
    const created = await book(sofiane, { date: D, startMin: 600 });
    expect(created.statusCode, created.body).toBe(201);
    const bookingId = (created.json() as { booking: { id: string } }).booking.id;
    const match = await createMatch(sofiane, bookingId, 'Retrait');
    expect(match.statusCode, match.body).toBe(201);
    const matchId = (match.json() as { match: { id: string } }).match.id;
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) })).statusCode).toBe(200);
    const DEVICE = 'b'.repeat(64);
    await stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(karim), payload: { token: DEVICE, platform: 'ios' } });
    stack.push.sent.length = 0;

    const removed = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/players/${seed.users.karim}/remove`, headers: bearer(sofiane) });
    expect(removed.statusCode, removed.body).toBe(200);

    const notifs = await stack.db.selectFrom('notifications').select(['user_id', 'type'])
      .where('ref_id', '=', matchId).where('type', '=', 'PLAYER_REMOVED').execute();
    expect(notifs).toEqual([{ user_id: seed.users.karim, type: 'PLAYER_REMOVED' }]);

    await currentPushDispatcher()?.idle();
    const push = stack.push.sent.find((s) => s.devices.some((d) => d.token === DEVICE));
    expect(push?.message.title).toBe('Tu as été retiré d’un match');

    const back = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(back.statusCode).toBe(403);
  });
});
