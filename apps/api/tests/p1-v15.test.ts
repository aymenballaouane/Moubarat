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

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: Record<string, unknown>) =>
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

describe('P1-11 — « Payée » et la caisse dans le même geste', () => {
  /** Un créneau plus tard dans le jour d'exploitation en cours (« Payée » s'y ouvre déjà, P0-1). */
  async function laterTodayBooking(): Promise<{ id: string; reference: string }> {
    const { operatingDayWindow, dayStartMs } = await import('../src/lib/algiers.js');
    const end = operatingDayWindow(dayStartMs(operatingDateOf(Date.now()))).end;
    const start = Math.min(Date.now() + 10 * MIN, end - 2 * MIN);
    const id = await booking(start, 'RESERVED');
    const r = await stack.db.selectFrom('bookings').select('reference').where('id', '=', id).executeTakeFirstOrThrow();
    return { id, reference: r.reference! };
  }
  const movementsFor = (ref: string) => stack.db.selectFrom('cash_movements').select(['kind', 'amount_da', 'ref', 'note']).where('ref', '=', ref).execute();
  let sessionId = '';

  beforeAll(async () => {
    await stack.db.updateTable('venues').set({ cash_module_enabled: true }).where('id', '=', seed.venueId).execute();
    const open = await call('POST', `/venues/${seed.venueId}/cash/sessions`, nadia, { openingFloatDa: 5000 });
    expect(open.statusCode, open.body).toBeLessThan(300);
    sessionId = (open.json() as { session: { id: string } }).session.id;
  });

  it('caisse ouverte, case cochée : la réservation passe « Payée » ET l’encaissement est écrit (même montant, sa référence), tracé', async () => {
    const b = await laterTodayBooking();
    const res = await call('POST', `/bookings/${b.id}/status`, nadia, { status: 'PAID', recordCash: true });
    expect([res.statusCode, (res.json() as { cashRecorded: boolean }).cashRecorded], res.body).toEqual([200, true]);
    expect(await movementsFor(b.reference)).toEqual([{ kind: 'COLLECTION', amount_da: 3000, ref: b.reference, note: 'Réservation payée' }]);
    const logs = (await stack.db.selectFrom('audit_log').select(['action', 'summary']).where('venue_id', '=', seed.venueId)
      .where('summary', 'like', `%${b.reference}%`).execute()).map((l) => `${l.action}:${l.summary}`);
    expect(logs).toContain(`CASH_MOVEMENT:a encaissé 3000 DA en caisse — réservation ${b.reference} payée`);
    expect(logs.some((l) => l.startsWith('BOOKING_CASH_STATUS:') && l.endsWith('— encaissé en caisse'))).toBe(true);
    const current = await call('GET', `/venues/${seed.venueId}/cash/sessions/current`, nadia);
    expect((current.json() as { expectedDa: number }).expectedDa).toBeGreaterThanOrEqual(8000);
  });

  it('case décochée (paiement par virement…) : « Payée » seulement, rien en caisse', async () => {
    const b = await laterTodayBooking();
    const res = await call('POST', `/bookings/${b.id}/status`, nadia, { status: 'PAID', recordCash: false });
    expect([res.statusCode, (res.json() as { cashRecorded: boolean }).cashRecorded]).toEqual([200, false]);
    expect(await movementsFor(b.reference)).toEqual([]);
  });

  it('recordCash ignoré pour un autre statut, refusé s’il n’est pas un booléen', async () => {
    const b = await laterTodayBooking();
    expect((await call('POST', `/bookings/${b.id}/status`, nadia, { status: 'PAID', recordCash: 'oui' })).statusCode).toBe(400);
    const cancel = await call('POST', `/bookings/${b.id}/status`, nadia, { status: 'CANCELLED', reason: 'CLIENT', recordCash: true });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await movementsFor(b.reference)).toEqual([]);
  });

  it('caisse fermée : la réservation passe quand même « Payée », sans encaissement, et la réponse le dit', async () => {
    const close = await call('POST', `/venues/${seed.venueId}/cash/sessions/${sessionId}/close`, nadia, { declaredClosingDa: 8000 });
    expect(close.statusCode, close.body).toBeLessThan(300);
    const b = await laterTodayBooking();
    const res = await call('POST', `/bookings/${b.id}/status`, nadia, { status: 'PAID', recordCash: true });
    expect([res.statusCode, (res.json() as { cashRecorded: boolean }).cashRecorded]).toEqual([200, false]);
    expect((await stack.db.selectFrom('bookings').select('status').where('id', '=', b.id).executeTakeFirstOrThrow()).status).toBe('PAID');
    expect(await movementsFor(b.reference)).toEqual([]);
  });
});

/* P1-12 (choix d'Aymen : prix par séance, « couche séances ») : les séances d'un abonnement ont un prix et un statut posé comme
   une réservation ; elles entrent dans le chiffre d'affaires, la caisse et les séances non clôturées. */
describe('P1-12 — abonnés payants : prix et statut par séance', () => {
  let yacine = '';      // MANAGER
  let subId = '';
  let fieldId = '';
  const { algiersDateOf: civil, dayStartMs: dsm } = { algiersDateOf: (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10), dayStartMs: (d: string) => Date.parse(`${d}T00:00:00+01:00`) };
  const lastWeek = civil(Date.now() - 7 * DAY);
  const twoWeeksAgo = civil(Date.now() - 14 * DAY);
  const nextWeek = civil(Date.now() + 7 * DAY);
  const weekday = new Date(dsm(lastWeek) + 3_600_000).getUTCDay();
  const day = async (date: string) => (await call('GET', `/venues/${seed.venueId}/bookings?date=${date}`, nadia)).json() as {
    subscriptions: { recurringBookingId: string; date: string; status: string; priceDa: number | null; recorded: boolean }[];
  };
  const mine = async (date: string) => (await day(date)).subscriptions.find((x) => x.recurringBookingId === subId);
  const sessionStatus = (date: string, token: string, body: Record<string, unknown>) =>
    call('POST', `/venues/${seed.venueId}/recurring-bookings/${subId}/sessions/${date}/status`, token, body);

  beforeAll(async () => {
    yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
    fieldId = (await insertTestField(stack.db, { venue_id: seed.venueId, name: 'V15-abonnés', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000 })).id;
    const created = await call('POST', `/venues/${seed.venueId}/recurring-bookings`, yacine, {
      fieldId, weekday, startMin: 600, durationMin: 60, holderName: 'Équipe Mardi', activeFrom: civil(Date.now() - 21 * DAY), pricePerSessionDa: 2500,
    });
    expect(created.statusCode, created.body).toBe(201);
    subId = (created.json() as { subscription: { id: string; pricePerSessionDa: number } }).subscription.id;
  });

  it('chaque séance porte son jour, son statut (« réservée » tant que rien n’est posé) et son prix', async () => {
    expect(await mine(lastWeek)).toMatchObject({ date: lastWeek, status: 'RESERVED', priceDa: 2500, recorded: false });
  });

  it('« Payée » sur une séance passée : statut enregistré au prix figé, compté dans le chiffre encaissé (source comptoir)', async () => {
    const before = (await call('GET', `/venues/${seed.venueId}/analytics/revenue?from=${lastWeek}&to=${lastWeek}&fieldId=${fieldId}`, yacine)).json() as { overall: { collected: number } };
    expect(before.overall.collected).toBe(0);
    const res = await sessionStatus(lastWeek, nadia, { status: 'PAID' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await mine(lastWeek)).toMatchObject({ status: 'PAID', priceDa: 2500, recorded: true });
    // Le prix change ensuite : la séance payée garde 2 500 DA.
    expect((await call('PATCH', `/venues/${seed.venueId}/recurring-bookings/${subId}`, yacine, { pricePerSessionDa: 2800 })).statusCode).toBe(200);
    const rev = (await call('GET', `/venues/${seed.venueId}/analytics/revenue?from=${lastWeek}&to=${lastWeek}&fieldId=${fieldId}`, yacine)).json() as { overall: { collected: number }; bySource: { WALK_IN: { collected: number } } };
    expect(rev.overall.collected).toBe(2500);
    expect(rev.bySource.WALK_IN.collected).toBe(2500);
    expect(await mine(nextWeek)).toMatchObject({ status: 'RESERVED', priceDa: 2800 });
  });

  it('« No-show » sur une autre séance passée : chiffre perdu ; une séance future ne s’honore pas ; un jour sans séance : 404', async () => {
    expect((await sessionStatus(twoWeeksAgo, nadia, { status: 'NO_SHOW' })).statusCode).toBe(200);
    const rev = (await call('GET', `/venues/${seed.venueId}/analytics/revenue?from=${twoWeeksAgo}&to=${twoWeeksAgo}&fieldId=${fieldId}`, yacine)).json() as { overall: { lostNoShow: number } };
    expect(rev.overall.lostNoShow).toBe(2800);
    const early = await sessionStatus(nextWeek, nadia, { status: 'HONORED' });
    expect([early.statusCode, (early.json() as { error: string }).error]).toEqual([400, 'BOOKING_NOT_STARTED']);
    expect((await sessionStatus(civil(Date.now() - 8 * DAY), nadia, { status: 'PAID' })).statusCode).toBe(404);
    expect((await sessionStatus(lastWeek, nadia, { status: 'HONORED' })).statusCode).toBe(409);   // Payée → Honorée : transition refusée par le core
  });

  it('corriger : Manager seulement, la séance redevient réservée ; tracé au Journal', async () => {
    expect((await call('POST', `/venues/${seed.venueId}/recurring-bookings/${subId}/sessions/${twoWeeksAgo}/revert`, nadia)).statusCode).toBe(403);
    expect((await call('POST', `/venues/${seed.venueId}/recurring-bookings/${subId}/sessions/${twoWeeksAgo}/revert`, yacine)).statusCode).toBe(200);
    expect(await mine(twoWeeksAgo)).toMatchObject({ status: 'RESERVED', recorded: false });
    const log = await stack.db.selectFrom('audit_log').select(['action', 'summary']).where('object_id', '=', `${subId}:${twoWeeksAgo}`).execute();
    expect(log.map((l) => l.action).sort()).toEqual(['BOOKING_CASH_STATUS', 'BOOKING_STATUS_CORRECTED']);
  });

  it('séances passées sans statut : comptées dans les non clôturées du Dashboard', async () => {
    const body = (await call('GET', `/venues/${seed.venueId}/bookings/unclosed`, nadia)).json() as { sessionsReserved: number; sessions: { recurringBookingId: string; date: string }[] };
    expect(body.sessions.filter((x) => x.recurringBookingId === subId).map((x) => x.date)).toContain(twoWeeksAgo);
    expect(body.sessionsReserved).toBeGreaterThanOrEqual(1);
  });

  it('abonnement sans prix : statut refusé (409 NO_PRICE) tant que le prix n’est pas fixé ; résilié, ses séances payées comptent encore', async () => {
    const f2 = (await insertTestField(stack.db, { venue_id: seed.venueId, name: 'V15-sans-prix', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000 })).id;
    const noPrice = await call('POST', `/venues/${seed.venueId}/recurring-bookings`, yacine, {
      fieldId: f2, weekday, startMin: 600, durationMin: 60, holderName: 'Sans Prix', activeFrom: civil(Date.now() - 21 * DAY),
    });
    const id2 = (noPrice.json() as { subscription: { id: string; pricePerSessionDa: number | null } }).subscription;
    expect(id2.pricePerSessionDa).toBeNull();
    const refused = await call('POST', `/venues/${seed.venueId}/recurring-bookings/${id2.id}/sessions/${lastWeek}/status`, nadia, { status: 'PAID' });
    expect([refused.statusCode, (refused.json() as { error: string }).error]).toEqual([409, 'NO_PRICE']);

    expect((await call('POST', `/venues/${seed.venueId}/recurring-bookings/${subId}/end`, yacine)).statusCode).toBe(200);
    const rev = (await call('GET', `/venues/${seed.venueId}/analytics/revenue?from=${lastWeek}&to=${lastWeek}&fieldId=${fieldId}`, yacine)).json() as { overall: { collected: number } };
    expect(rev.overall.collected).toBe(2500);
  });
});
