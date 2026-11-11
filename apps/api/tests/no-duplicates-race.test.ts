import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Chasse aux doublons (11/11/2026, demande d'Aymen avant l'ouverture au public) : le « double clic », le réseau qui rejoue,
   deux appareils du même joueur. Pour chaque cas, N requêtes STRICTEMENT simultanées sur un vrai Postgres, puis on compte les lignes en
   base : jamais plus d'une, et jamais une erreur 500 (un refus propre 4xx est le bon comportement pour les perdantes). */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', yacine = '';

const nextNonFriday = makeSafeDayPicker();
const N = 6;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
});
afterAll(async () => { await stack.teardown(); });

function noServerError(results: { statusCode: number; body: string }[]) {
  for (const r of results) expect(r.statusCode, r.body).toBeLessThan(500);
}

async function book(token: string, fieldId: string, date: string, startMin: number) {
  return stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(token), payload: { fieldId, date, startMin, durationMin: 60 } });
}

describe('doublons — le double clic et les requêtes rejouées', () => {
  it('même joueur, même créneau, 6 clics simultanés : UNE seule réservation, jamais de 500', async () => {
    const day = nextNonFriday(11);
    const res = await Promise.all(Array.from({ length: N }, () => book(sofiane, seed.fields.t1, day, 630)));
    noServerError(res);
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const rows = await stack.db.selectFrom('bookings').select('id').where('field_id', '=', seed.fields.t1)
      .where('by_user_id', '=', seed.users.sofiane).where('status', '=', 'RESERVED')
      .where('reservation_name', 'is not', null).execute();
    // une seule réservation vivante sur CE créneau (les autres du même joueur sur d'autres jours ne comptent pas ici)
    const sameSlot = res.filter((r) => r.statusCode === 201).map((r) => (r.json() as { booking: { id: string } }).booking.id);
    expect(sameSlot).toHaveLength(1);
    expect(rows.some((r) => r.id === sameSlot[0])).toBe(true);
  });

  it('même réservation, 6 créations de match simultanées : UN seul match vivant', async () => {
    const day = nextNonFriday(13);
    const b = await book(karim, seed.fields.t1, day, 690);
    expect(b.statusCode, b.body).toBe(201);
    const bookingId = (b.json() as { booking: { id: string } }).booking.id;
    const res = await Promise.all(Array.from({ length: N }, (_, i) =>
      stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(karim), payload: { bookingId, title: `Match ${i}` } })));
    noServerError(res);
    const live = await stack.db.selectFrom('matches').select('id').where('booking_id', '=', bookingId)
      .where('status', 'not in', ['CANCELLED']).execute();
    expect(live, JSON.stringify(res.map((r) => r.statusCode))).toHaveLength(1);
  });

  it('même joueur, même match, 6 « rejoindre » simultanés : une seule inscription', async () => {
    const day = nextNonFriday(15);
    const b = await book(sofiane, seed.fields.t1, day, 750);
    expect(b.statusCode, b.body).toBe(201);
    const bookingId = (b.json() as { booking: { id: string } }).booking.id;
    const m = await stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Rejoindre x6' } });
    expect(m.statusCode, m.body).toBe(201);
    const matchId = (m.json() as { match: { id: string } }).match.id;

    const res = await Promise.all(Array.from({ length: N }, () =>
      stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(walid) })));
    noServerError(res);
    const rows = await stack.db.selectFrom('match_players').select('user_id').where('match_id', '=', matchId)
      .where('user_id', '=', seed.users.walid).execute();
    expect(rows).toHaveLength(1);
    const joined = await stack.db.selectFrom('notifications').select('id').where('ref_id', '=', matchId)
      .where('type', '=', 'PLAYER_JOINED').where('user_id', '=', seed.users.sofiane).execute();
    expect(joined.length).toBeLessThanOrEqual(1); // l'organisateur n'est prévenu qu'une fois de cette arrivée
  });

  it('annulation du centre rejouée 6 fois : réservation annulée une fois, joueur prévenu une seule fois', async () => {
    const day = nextNonFriday(17);
    const b = await book(karim, seed.fields.t2, day, 810);
    expect(b.statusCode, b.body).toBe(201);
    const bookingId = (b.json() as { booking: { id: string } }).booking.id;

    const res = await Promise.all(Array.from({ length: N }, () =>
      stack.app.inject({ method: 'POST', url: `/bookings/${bookingId}/status`, headers: bearer(yacine), payload: { status: 'CANCELLED', reason: 'CLIENT' } })));
    noServerError(res);
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const notifs = await stack.db.selectFrom('notifications').select('id').where('user_id', '=', seed.users.karim)
      .where('ref_id', '=', bookingId).where('type', 'in', ['BOOKING_CANCELLED_BY_CENTER', 'MATCH_CANCELLED_BY_CENTER']).execute();
    expect(notifs).toHaveLength(1);
    const audits = await stack.db.selectFrom('audit_log').select('id').where('object_id', '=', bookingId).where('action', '=', 'BOOKING_CANCELLED').execute();
    expect(audits).toHaveLength(1);
  });

  it('un même appareil enregistré 6 fois pour les notifications : une seule ligne', async () => {
    const token = 'd'.repeat(64);
    const res = await Promise.all(Array.from({ length: N }, () =>
      stack.app.inject({ method: 'PUT', url: '/me/push-devices', headers: bearer(karim), payload: { token, platform: 'ios' } })));
    noServerError(res);
    const rows = await stack.db.selectFrom('push_devices').select('token').where('token', '=', token).execute();
    expect(rows).toHaveLength(1);
  });
});
