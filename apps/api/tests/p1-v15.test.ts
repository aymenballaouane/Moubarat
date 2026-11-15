import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, insertTestField, loginAsPlatform, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { operatingDateOf } from '../src/lib/algiers.js';

/* P1 de la V1.5 de l'audit stratégique du CRM (15/11/2026, GO d'Aymen « go pour les P1 de la V1.5 »). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '';   // RECEPTION du centre de démo
let amine = '';   // STAFF
let n = 0;
const MIN = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);
});
afterAll(async () => { await stack.teardown(); });

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: Record<string, unknown>) =>
  stack.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

/** Une réservation sur un terrain neuf (aucun chevauchement possible), au statut voulu. */
async function booking(start: number, status: 'RESERVED' | 'HONORED' | 'PAID' | 'NO_SHOW' | 'CANCELLED', over: { source?: 'WALK_IN' | 'CENTER'; venueId?: string } = {}): Promise<string> {
  n += 1;
  const fieldId = (await insertTestField(stack.db, { venue_id: over.venueId ?? seed.venueId, name: `V15-${n}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000 })).id;
  const row = await stack.db.insertInto('bookings').values({
    field_id: fieldId, time_range: toPgRange({ start, end: start + 60 * MIN }), source: over.source ?? 'WALK_IN', verified_by_center: true, status,
    ...(status === 'CANCELLED' ? { cancelled_at: new Date(start - DAY), cancel_reason: 'CLIENT' as const } : {}),
    by_user_id: seed.crmStaff.nadia, reservation_name: `Client V15 ${n}`, reference: `V15-${n}-${Math.floor(Math.random() * 1e6)}`,
    price_total_da: 3000, format: '5v5' as never,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

describe('P1-8 — réservations passées non clôturées (Dashboard)', () => {
  let oldest = '';
  let honored = '';
  beforeAll(async () => {
    oldest = await booking(Date.now() - 20 * DAY, 'RESERVED');
    await booking(Date.now() - 3 * DAY, 'RESERVED');
    honored = await booking(Date.now() - 2 * DAY, 'HONORED');
    // Ne comptent pas : déjà clôturées, à venir, en cours, trop anciennes, blocage, autre centre.
    await booking(Date.now() - 4 * DAY, 'PAID');
    await booking(Date.now() - 4 * DAY, 'NO_SHOW');
    await booking(Date.now() - 4 * DAY, 'CANCELLED');
    await booking(Date.now() + 2 * DAY, 'RESERVED');
    await booking(Date.now() - 30 * MIN, 'RESERVED');
    await booking(Date.now() - 40 * DAY, 'RESERVED');
    await booking(Date.now() - 5 * DAY, 'RESERVED', { source: 'CENTER' });
    await booking(Date.now() - 5 * DAY, 'RESERVED', { venueId: seed.alwaysOpen.venueId });
  });

  it('compte les « Réservée » et « Honorée » dont le créneau est fini, sur 30 jours ; les plus anciennes de chaque statut d’abord, avec leur jour', async () => {
    const res = await call('GET', `/venues/${seed.venueId}/bookings/unclosed`, nadia);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { lookbackDays: number; reserved: number; honoredUnpaid: number; bookings: { id: string; status: string; date: string; start: number }[] };
    expect(body.lookbackDays).toBe(30);
    // Le seed du centre de démo peut lui-même laisser des réservations passées ouvertes : on compare à son propre état.
    const mine = body.bookings.filter((b) => [oldest, honored].includes(b.id));
    expect(mine.map((b) => b.id)).toEqual([oldest, honored]);
    // Les plus anciennes d'abord, PAR STATUT (une liste unique pouvait ne contenir que des « Honorée »).
    for (const st of ['RESERVED', 'HONORED']) {
      const starts = body.bookings.filter((b) => b.status === st).map((b) => b.start);
      expect(starts, st).toEqual([...starts].sort((x, y) => x - y));
      expect(starts.length, st).toBeGreaterThan(0);
    }
    const first = body.bookings.find((b) => b.id === oldest)!;
    expect(first.date).toBe(operatingDateOf(first.start));
    expect(body.reserved).toBeGreaterThanOrEqual(2);
    expect(body.honoredUnpaid).toBeGreaterThanOrEqual(1);
  });

  it('exactement ce qu’ajoutent nos réservations : 2 « Réservée » et 1 « Honorée » de plus qu’un centre sans elles', async () => {
    const res = await call('GET', `/venues/${seed.alwaysOpen.venueId}/bookings/unclosed`, await loginAsPlatform(stack, seed.alwaysOpen.staffEmail, seed.crmStaffPassword));
    const body = res.json() as { reserved: number; honoredUnpaid: number };
    expect(body).toMatchObject({ reserved: 1, honoredUnpaid: 0 });   // la seule de l'autre centre (5 jours)
  });

  it('même permission que la journée : le Staff (VIEW_PLANNING) lit ; sans compte, 401', async () => {
    expect((await call('GET', `/venues/${seed.venueId}/bookings/unclosed`, amine)).statusCode).toBe(200);
    expect((await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings/unclosed` })).statusCode).toBe(401);
  });
});
