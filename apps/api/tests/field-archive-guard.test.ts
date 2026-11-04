import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, insertTestField, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Audit produit 21/09/2026 (CE9) — un terrain n'est archivable que sans engagement à venir : réservation
   vivante dont la fin est dans le futur, ou abonnement actif. MAINTENANCE reste libre. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', amine = '', sofiane = '';
let fieldSeq = 0;

function nextWeekday(target: number, minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 8; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
  }
  throw new Error('unreachable');
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas EDIT_FIELDS
  sofiane = await loginAs(stack, seed.phones.sofiane);
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
});
afterAll(() => stack.teardown());

/** Un terrain neuf par test : aucun engagement hérité d'un autre test. */
async function freshField(): Promise<string> {
  fieldSeq += 1;
  const f = await insertTestField(stack.db, {
    venue_id: seed.venueId, name: `A${fieldSeq}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 6000,
  });
  return f.id;
}
async function book(fieldId: string, date: string, startMin: number): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane), payload: { fieldId, date, startMin, durationMin: 90 },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string } }).booking.id;
}
async function setStatus(fieldId: string, status: string, token = hamid) {
  return stack.app.inject({
    method: 'PATCH', url: `/venues/${seed.venueId}/fields/${fieldId}`, headers: bearer(token), payload: { status },
  });
}
async function statusOf(fieldId: string): Promise<string | null> {
  return (await stack.db.selectFrom('fields').select('status').where('id', '=', fieldId).executeTakeFirstOrThrow()).status;
}

describe('archivage d’un terrain — engagements à venir', () => {
  it('terrain sans engagement : archivé (200)', async () => {
    const f = await freshField();
    const res = await setStatus(f, 'ARCHIVED');
    expect(res.statusCode, res.body).toBe(200);
    expect(await statusOf(f)).toBe('ARCHIVED');
  });

  it('réservation à venir : refus 409 FIELD_HAS_FUTURE_BOOKINGS, message accordé, liste exacte, statut INCHANGÉ', async () => {
    const f = await freshField();
    await book(f, nextWeekday(3, 4), 900);
    const res = await setStatus(f, 'ARCHIVED');
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; message: string; details: { conflicts: { kind: string; label: string }[]; bookings: number; subscriptions: number } };
    expect(body.error).toBe('FIELD_HAS_FUTURE_BOOKINGS');
    expect(body.message).toBe('Ce terrain a 1 réservation à venir — à déplacer ou annuler avant de l’archiver.');
    expect(body.details.bookings).toBe(1);
    expect(body.details.subscriptions).toBe(0);
    expect(body.details.conflicts).toHaveLength(1);
    expect(body.details.conflicts[0]!.kind).toBe('BOOKING');
    expect(body.details.conflicts[0]!.label).toMatch(/^[A-Z]{3}-\d{6} · .+ — \d{2}\/\d{2} 15:00$/);
    expect(await statusOf(f)).toBe('ACTIVE');
  });

  it('une fois la réservation annulée, l’archivage passe', async () => {
    const f = await freshField();
    const id = await book(f, nextWeekday(3, 4), 900);
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(409);
    await stack.db.updateTable('bookings').set({ status: 'CANCELLED' }).where('id', '=', id).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(200);
  });

  it('une réservation TERMINÉE ne bloque pas ; une réservation EN COURS bloque', async () => {
    const f = await freshField();
    const id = await book(f, nextWeekday(3, 4), 900);
    const range = (startOffsetMin: number, endOffsetMin: number) => toPgRange({
      start: Date.now() + startOffsetMin * 60_000, end: Date.now() + endOffsetMin * 60_000,
    });
    await stack.db.updateTable('bookings').set({ time_range: range(-30, 60) }).where('id', '=', id).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(409); // en cours : le terrain n'est pas libre
    await stack.db.updateTable('bookings').set({ time_range: range(-3 * 24 * 60, -3 * 24 * 60 + 90) }).where('id', '=', id).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(200);  // terminée depuis 3 jours
  });

  it('abonnement actif : refus (kind SUBSCRIPTION) ; abonnement terminé ou échu : ne bloque pas', async () => {
    const f = await freshField();
    const create = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: { fieldId: f, weekday: 3, startMin: 1140, durationMin: 90, holderName: 'Club Mercredi', activeFrom: algiersDateOf(Date.now() - 86_400_000) },
    });
    expect(create.statusCode, create.body).toBe(201);
    const refused = await setStatus(f, 'ARCHIVED');
    expect(refused.statusCode).toBe(409);
    const body = refused.json() as { message: string; details: { conflicts: { kind: string; label: string }[]; subscriptions: number } };
    expect(body.message).toBe('Ce terrain a 1 abonnement actif — à déplacer ou annuler avant de l’archiver.');
    expect(body.details.conflicts[0]).toEqual({ kind: 'SUBSCRIPTION', label: 'Club Mercredi · chaque mercredi 19:00' });

    await stack.db.updateTable('recurring_bookings').set({ active_until: new Date(Date.now() - 2 * 86_400_000) }).where('field_id', '=', f).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(200); // échu
    await stack.db.updateTable('fields').set({ status: 'ACTIVE' }).where('id', '=', f).execute();
    await stack.db.updateTable('recurring_bookings').set({ active_until: null, status: 'ENDED' }).where('field_id', '=', f).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(200); // résilié
  });

  it('pluriels accordés, jamais « (s) » : 2 réservations et 1 abonnement', async () => {
    const f = await freshField();
    await book(f, nextWeekday(3, 4), 900);
    await book(f, nextWeekday(3, 4), 1080);
    await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: { fieldId: f, weekday: 1, startMin: 600, durationMin: 90, holderName: 'Club Lundi', activeFrom: algiersDateOf(Date.now() - 86_400_000) },
    });
    const res = await setStatus(f, 'ARCHIVED');
    const { message } = res.json() as { message: string };
    expect(message).toBe('Ce terrain a 2 réservations à venir et 1 abonnement actif — à déplacer ou annuler avant de l’archiver.');
    expect(message).not.toContain('(s)');
  });

  it('plus de 20 engagements : 20 lignes renvoyées (les plus proches d’abord), le compte exact reste juste', async () => {
    const f = await freshField();
    const base = Date.now() + 5 * 86_400_000;
    await stack.db.insertInto('bookings').values(Array.from({ length: 25 }, (_, i) => ({
      field_id: f, by_user_id: seed.users.sofiane, price_total_da: 6000, reservation_name: `Client ${i}`,
      time_range: toPgRange({ start: base + i * 3 * 3_600_000, end: base + i * 3 * 3_600_000 + 5_400_000 }),
    }))).execute();
    const res = await setStatus(f, 'ARCHIVED');
    const body = res.json() as { message: string; details: { conflicts: { label: string }[]; bookings: number } };
    expect(body.details.bookings).toBe(25);
    expect(body.details.conflicts).toHaveLength(20);
    expect(body.details.conflicts[0]!.label).toContain('Client 0');
    expect(body.message).toContain('25 réservations à venir');
  });

  it('MAINTENANCE n’est pas concerné ; un terrain DÉJÀ archivé se re-archive sans erreur ; le désarchivage reste libre', async () => {
    const f = await freshField();
    await book(f, nextWeekday(3, 4), 900);
    expect((await setStatus(f, 'MAINTENANCE')).statusCode).toBe(200);
    await stack.db.updateTable('fields').set({ status: 'ARCHIVED' }).where('id', '=', f).execute();
    expect((await setStatus(f, 'ARCHIVED')).statusCode).toBe(200); // pas de transition : aucun contrôle
    expect((await setStatus(f, 'ACTIVE')).statusCode).toBe(200);   // désarchiver
  });

  it('permission inchangée : STAFF (pas EDIT_FIELDS) reste refusé (403), le terrain n’est pas touché', async () => {
    const f = await freshField();
    expect((await setStatus(f, 'ARCHIVED', amine)).statusCode).toBe(403);
    expect(await statusOf(f)).toBe('ACTIVE');
  });
});
