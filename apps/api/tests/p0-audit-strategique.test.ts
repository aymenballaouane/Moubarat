import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, insertTestField, loginAsPlatform, markUserReady, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { newSessionToken, sha256 } from '../src/lib/crypto.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { dayStartMs, operatingDateOf, operatingDayWindow } from '../src/lib/algiers.js';

/* P0-1 (audit stratégique CRM, 15/11/2026, GO d'Aymen — « le jour même ») : « Payée » se pose directement depuis « Réservée », dès le
   début du jour d'exploitation du créneau (06:00 heure d'Alger) — le client qui paie en arrivant, avant de jouer. Jamais la veille ou
   plus tôt. « Honorée » et « No-show » restent refusées avant le début du créneau. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '';   // RECEPTION du centre de démo
let yacine = '';  // MANAGER
let n = 0;
const MIN = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
});
afterAll(async () => { await stack.teardown(); });

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
  stack.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

async function booking(start: number, over: { byUserId?: string; claimedUserId?: string; phone?: string } = {}): Promise<string> {
  const ref = `P01-${++n}-${Math.floor(Math.random() * 1e6)}`;
  // Un terrain neuf par réservation : aucune autre (seed ou test voisin) ne peut chevaucher ce créneau.
  const fieldId = (await insertTestField(stack.db, { venue_id: seed.venueId, name: `P0-1 ${n}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000 })).id;
  const row = await stack.db.insertInto('bookings').values({
    field_id: fieldId, time_range: toPgRange({ start, end: start + 60 * MIN }), source: 'WALK_IN', verified_by_center: true,
    by_user_id: over.byUserId ?? seed.crmStaff.nadia, reservation_name: 'Client P0-1', reference: ref, price_total_da: 3000, format: '5v5' as never,
    ...(over.phone ? { customer_phone: over.phone } : {}),
    ...(over.claimedUserId ? { claimed_user_id: over.claimedUserId, claim_status: 'PENDING' as const } : {}),
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}
const statusOf = async (id: string) => (await stack.db.selectFrom('bookings').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

/** Un créneau qui commence plus tard dans le jour d'exploitation EN COURS (dans 10 minutes). Entre 05:50 et 06:00, heure d'Alger,
    « dans 10 minutes » tombe déjà sur le jour suivant : le créneau est alors posé juste avant la fin du jour en cours. */
function laterToday(): number {
  const now = Date.now();
  const dayEnd = operatingDayWindow(dayStartMs(operatingDateOf(now))).end;
  return Math.min(now + 10 * MIN, dayEnd - 2 * MIN);
}

describe('P0-1 — « Payée » le jour même', () => {
  it('le jour du créneau, avant son début : la Réception passe « Réservée » → « Payée » en un geste, tracé au Journal', async () => {
    const id = await booking(laterToday());
    const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await statusOf(id)).toBe('PAID');
    const log = await stack.db.selectFrom('audit_log').select(['summary', 'before_val', 'after_val', 'actor_role'])
      .where('object_id', '=', id).where('action', '=', 'BOOKING_CASH_STATUS').execute();
    expect(log.map((l) => `${l.before_val}>${l.after_val}:${l.actor_role}`)).toEqual(['RESERVED>PAID:RECEPTION']);
    expect(log[0]!.summary).toContain('en « Payée »');
  });

  it('le même jour, « Honorée » et « No-show » restent refusées avant le début du créneau', async () => {
    const id = await booking(laterToday());
    for (const status of ['HONORED', 'NO_SHOW']) {
      const res = await call('POST', `/bookings/${id}/status`, nadia, { status });
      expect([res.statusCode, errorOf(res)], status).toEqual([400, 'BOOKING_NOT_STARTED']);
    }
    expect(await statusOf(id)).toBe('RESERVED');
  });

  it('la veille ou plus tôt : « Payée » refusée (400 PAYMENT_NOT_OPEN), la réservation ne bouge pas', async () => {
    const tomorrow = operatingDayWindow(dayStartMs(operatingDateOf(Date.now()))).end + 14 * 60 * MIN;   // demain 20:00
    for (const start of [tomorrow, Date.now() + 10 * DAY]) {
      const id = await booking(start);
      const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
      expect([res.statusCode, errorOf(res)]).toEqual([400, 'PAYMENT_NOT_OPEN']);
      expect(await statusOf(id)).toBe('RESERVED');
    }
  });

  it('une fois le créneau commencé, « Payée » directe reste possible (sans passer par « Honorée »)', async () => {
    const id = await booking(Date.now() - 20 * MIN);
    const res = await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('une « Payée » posée avant le début, corrigée par un Manager, redevient « Réservée » — jamais « Honorée » avant l’heure', async () => {
    const id = await booking(laterToday());
    expect((await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' })).statusCode).toBe(200);
    const res = await call('POST', `/bookings/${id}/revert-cash-status`, yacine);
    expect([res.statusCode, (res.json() as { status: string }).status], res.body).toEqual([200, 'RESERVED']);
    const log = await stack.db.selectFrom('audit_log').select('summary')
      .where('object_id', '=', id).where('action', '=', 'BOOKING_STATUS_CORRECTED').executeTakeFirstOrThrow();
    expect(log.summary).toContain('Payée → Réservée');
  });

  it('règle 21 : payée le jour même, une réservation rattachée « C’est bien toi ? » reste visible et le joueur peut encore répondre', async () => {
    const phone = '+213555990011';
    const u = await stack.db.insertInto('users').values({ phone, name: 'p01_claim' }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('profiles').values({
      user_id: u.id, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], phone_visible: true,
    }).execute();
    const token = newSessionToken();
    await stack.db.insertInto('sessions').values({ user_id: u.id, token_hash: sha256(token) }).execute();
    await markUserReady(stack.db, u.id);

    const id = await booking(laterToday(), { claimedUserId: u.id, phone });
    expect((await call('POST', `/bookings/${id}/status`, nadia, { status: 'PAID' })).statusCode).toBe(200);
    const list = await call('GET', '/me/claims', token);
    expect((list.json() as { claims: Array<{ bookingId: string }> }).claims.map((c) => c.bookingId)).toContain(id);
    const confirm = await call('POST', `/me/claims/${id}/confirm`, token);
    expect(confirm.statusCode, confirm.body).toBe(200);
    const row = await stack.db.selectFrom('bookings').select(['by_user_id', 'claim_status', 'status']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toEqual({ by_user_id: u.id, claim_status: 'CONFIRMED', status: 'PAID' });
  });
});
