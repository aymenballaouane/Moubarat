import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot « Match libre », phase 9v9 (GO d'Aymen du 16/11/2026 : « règles, base, CRM, aucun prix par défaut »), vrai Postgres — migration
   0048. Le gérant ajoute le 9v9 à un terrain en saisissant LUI-MÊME son prix (jamais de prix par défaut) ; le joueur le réserve ; le
   match ouvert dessus compte 18 places. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', sofiane = '';
const nextNonFriday = makeSafeDayPicker();
const addFormat = (body: Record<string, unknown>) => stack.app.inject({
  method: 'POST', url: `/venues/${seed.venueId}/fields/${seed.fields.t1}/formats`, headers: bearer(hamid), payload: body,
});

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(() => stack.teardown());

describe('9v9 — du CRM à la réservation', () => {
  it('aucun prix par défaut : sans prix saisi, le format n’est pas ajouté ; un format inconnu reste refusé', async () => {
    const none = await addFormat({ format: '9v9' });
    expect(none.statusCode, none.body).toBe(400);
    expect((await addFormat({ format: '10v10', hourlyRateDa: 9000 })).statusCode).toBe(400);
    const row = await stack.db.selectFrom('fields').select('formats').where('id', '=', seed.fields.t1).executeTakeFirstOrThrow();
    expect(row.formats).not.toContain('9v9');
  });

  it('le gérant l’ajoute avec SON prix, sans bande copiée : le terrain le propose, le joueur le réserve, le match a 18 places', async () => {
    const added = await addFormat({ format: '9v9', hourlyRateDa: 9000 });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json()).toMatchObject({ formatPrice: { format: '9v9', hourlyRateDa: 9000 }, pricingRules: [] });
    const row = await stack.db.selectFrom('fields').select('formats').where('id', '=', seed.fields.t1).executeTakeFirstOrThrow();
    expect(row.formats).toContain('9v9');

    const date = nextNonFriday(4);
    const avail = await stack.app.inject({ method: 'GET', url: `/fields/${seed.fields.t1}/availability?date=${date}&duration=90&step=60` });
    expect(avail.statusCode, avail.body).toBe(200);
    const starts = (avail.json() as { starts: { startMin: number; byFormat: { format: string; totalDa: number }[] }[] }).starts;
    const start = starts.find((s) => s.byFormat.some((f) => f.format === '9v9'));
    expect(start, 'un départ libre en 9v9').toBeDefined();
    expect(start!.byFormat.find((f) => f.format === '9v9')!.totalDa).toBe(13_500);   // 9 000 DA/h × 1 h 30, aucune bande

    const booked = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date, startMin: start!.startMin, durationMin: 90, format: '9v9' },
    });
    expect(booked.statusCode, booked.body).toBe(201);
    const bookingId = (booked.json() as { booking: { id: string } }).booking.id;
    const match = await stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Grand match' } });
    expect(match.statusCode, match.body).toBe(201);
    expect((match.json() as { match: Record<string, unknown> }).match).toMatchObject({ format: '9v9', capacity: 18, pricePerPlayerDa: 750 });
  });
});
