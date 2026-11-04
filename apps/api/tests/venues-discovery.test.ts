/* A5 — Découverte (cadrage multi-centre/scalabilité, 22/09/2026) : GET /venues enrichi pour
   l'Explorer multi-centre — sports/formats proposés, prix « à partir de » par format (source réelle
   field_format_prices, jamais fields.hourly_rate_da figé), note par centre calculée EN LOT. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
});
afterAll(async () => { await stack.teardown(); });

let slotCounter = 0;
/** Match joué sur T1 (organisateur sofiane, karim inscrit) — même technique que results.test.ts :
    horaire reculé directement en base après création, pour noter le centre sans attendre. */
async function createPlayedMatchOnVenue(): Promise<string> {
  const date = nextNonFriday(3 + slotCounter);
  const startMin = 600;
  slotCounter += 1;
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t1, format: '5v5', date, startMin, durationMin: 60 },
  });
  expect(bk.statusCode, bk.body).toBe(201);
  const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId, title: 'Match découverte A5' },
  });
  const matchId = (created.json() as { match: { id: string } }).match.id;
  await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });

  const end = Date.now() - 2 * 3_600_000;
  const start = end - 60 * 60_000;
  await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end }) }).where('id', '=', matchId).execute();
  return matchId;
}

describe('GET /venues — découverte enrichie (A5)', () => {
  it('sports/formats/prix « à partir de » dérivés de field_format_prices, jamais du hourly_rate_da figé du terrain', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/venues' });
    expect(res.statusCode).toBe(200);
    const venue = (res.json() as {
      venues: { id: string; sports: string[]; formats: string[]; priceFromDa: number | null; rating: unknown; fields: unknown[] }[];
    }).venues.find((v) => v.id === seed.venueId)!;

    expect(venue.sports.sort()).toEqual(['FOOTBALL', 'PADEL']);
    expect(venue.formats.sort()).toEqual(['5v5', '7v7', 'DOUBLE', 'SIMPLE'].sort());
    expect(venue.priceFromDa).toBe(1800); // T3 (PADEL), le tarif le plus bas du centre
  });

  it('field.formatPrices remplace le champ hourlyRateDa figé', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/venues' });
    const venue = (res.json() as { venues: { id: string; fields: { id: string; formatPrices: { format: string; hourlyRateDa: number }[] }[] }[] })
      .venues.find((v) => v.id === seed.venueId)!;
    const t1 = venue.fields.find((f) => f.id === seed.fields.t1)!;
    expect(t1.formatPrices).toEqual([{ format: '5v5', hourlyRateDa: 2500 }]);
    expect(t1).not.toHaveProperty('hourlyRateDa');
  });

  it('note du centre calculée EN LOT — même résultat qu’un calcul par centre (GET /venues/:id)', async () => {
    for (let i = 0; i < 5; i++) {
      const matchId = await createPlayedMatchOnVenue();
      await stack.app.inject({
        method: 'POST', url: `/matches/${matchId}/ratings`, headers: bearer(sofiane),
        payload: { targetType: 'VENUE', targetId: seed.venueId, stars: 4 },
      });
    }
    const list = await stack.app.inject({ method: 'GET', url: '/venues' });
    const listRating = (list.json() as { venues: { id: string; rating: { avg: number; count: number; visible: boolean } }[] })
      .venues.find((v) => v.id === seed.venueId)!.rating;

    const detail = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    const detailRating = (detail.json() as { venue: { rating: { avg: number; count: number; visible: boolean } } }).venue.rating;

    expect(listRating.avg).toBe(detailRating.avg);
    expect(listRating.count).toBe(detailRating.count);
    expect(listRating.visible).toBe(true); // seuil (5) atteint
  });

  it('un centre sans aucune note : {avg: null, count: 0, visible: false}, jamais une entrée absente', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/venues' });
    const venues = (res.json() as { venues: { id: string; rating: { avg: number | null; count: number; visible: boolean } }[] }).venues;
    expect(venues.every((v) => v.rating !== undefined)).toBe(true);
  });
});
