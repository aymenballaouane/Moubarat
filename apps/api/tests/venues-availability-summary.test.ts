/* A8 (cadrage multi-centre/scalabilité, 24/09/2026) — GET /venues/availability-summary : le résumé de
   disponibilité d'AUJOURD'HUI par centre, pour les cartes de l'Explorer. Il doit dire exactement ce que dirait
   GET /fields/:id/availability (la vérité déjà consommée par la réservation) — jamais un second calcul qui
   diverge : chaque assertion compare donc le résumé à l'union des départs de la route par terrain.

   Sensible à l'heure (comme toute lecture « aujourd'hui ») : hors des heures d'ouverture, il n'y a plus aucun
   départ à venir — les cas qui ont besoin d'un départ se retirent alors explicitement plutôt que d'échouer. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, insertTestField, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf } from '../src/lib/algiers.js';

interface Summary { date: string; durationMin: number; venues: { venueId: string; freeStarts: number; nextStartMin: number | null; eveningStarts: number }[] }

let stack: TestStack;
let seed: SeedResult;
let hamid = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
});
afterAll(async () => { await stack.teardown(); });

async function summary(): Promise<Summary> {
  const res = await stack.app.inject({ method: 'GET', url: '/venues/availability-summary' }); // sans jeton : route publique
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Summary;
}

/** Union des départs libres aujourd'hui (90 min) des trois terrains, lus par la route de RÉFÉRENCE. */
async function referenceStarts(): Promise<number[]> {
  const date = algiersDateOf(Date.now());
  const all = new Set<number>();
  for (const fieldId of [seed.fields.t1, seed.fields.t2, seed.fields.t3]) {
    const res = await stack.app.inject({ method: 'GET', url: `/fields/${fieldId}/availability?date=${date}&duration=90&step=30` });
    expect(res.statusCode, res.body).toBe(200);
    for (const s of (res.json() as { starts: { startMin: number }[] }).starts) all.add(s.startMin);
  }
  return [...all].sort((a, b) => a - b);
}

function mine(s: Summary) {
  return s.venues.find((v) => v.venueId === seed.venueId)!;
}

describe('GET /venues/availability-summary', () => {
  it('route publique : dit exactement ce que disent les disponibilités par terrain (union, un départ compte une fois)', async () => {
    const [s, ref] = await Promise.all([summary(), referenceStarts()]);
    expect(s.durationMin).toBe(90);
    expect(s.date).toBe(algiersDateOf(Date.now()));
    const v = mine(s);
    expect(v.freeStarts).toBe(ref.length);
    expect(v.nextStartMin).toBe(ref[0] ?? null);
    expect(v.eveningStarts).toBe(ref.filter((m) => m >= 18 * 60).length);
  });

  it('réserver UN terrain à un départ le laisse compté (un autre terrain est libre) ; les réserver tous le retire', async () => {
    const before = await referenceStarts();
    if (before.length === 0) return; // hors des heures d'ouverture : aucun départ à venir à réserver
    const start = before[Math.floor(before.length / 2)]!;
    const date = algiersDateOf(Date.now());
    const book = async (fieldId: string) => {
      // Un terrain à plusieurs formats exige d'en préciser un (FORMAT_REQUIRED) : le premier configuré.
      const format = (await stack.db.selectFrom('field_format_prices').select('format').where('field_id', '=', fieldId).orderBy('format').executeTakeFirstOrThrow()).format;
      const res = await stack.app.inject({
        method: 'POST', url: '/bookings', headers: bearer(hamid),
        payload: { fieldId, date, startMin: start, durationMin: 90, source: 'WALK_IN', reservationName: 'Test Resume Explorer', format },
      });
      expect(res.statusCode, res.body).toBe(201);
    };

    await book(seed.fields.t1);
    const afterOne = await referenceStarts();
    expect(afterOne).toContain(start); // T2 (ou T3) libre à la même heure : le départ existe encore
    expect(mine(await summary()).freeStarts).toBe(afterOne.length);

    await book(seed.fields.t2);
    await book(seed.fields.t3);
    const afterAll = await referenceStarts();
    expect(afterAll).not.toContain(start);
    const v = mine(await summary());
    expect(v.freeStarts).toBe(afterAll.length);
    expect(v.nextStartMin).toBe(afterAll[0] ?? null);
  });

  it('un centre actif sans terrain est listé à zéro ; un centre non actif n\'apparaît jamais', async () => {
    const empty = await stack.db.insertInto('venues').values({
      name: 'Centre sans terrain (test A8)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const pending = await stack.db.insertInto('venues').values({
      name: 'Centre en attente (test A8)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'PENDING',
    }).returning('id').executeTakeFirstOrThrow();
    await insertTestField(stack.db, { venue_id: pending.id, name: 'P1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE' });

    const s = await summary();
    expect(s.venues.find((v) => v.venueId === empty.id)).toEqual({ venueId: empty.id, freeStarts: 0, nextStartMin: null, eveningStarts: 0 });
    expect(s.venues.find((v) => v.venueId === pending.id)).toBeUndefined();
  });
});

describe('GET /venues/availability-summary — cache court', () => {
  it('avec un TTL, une seconde lecture rapprochée ressert le même résumé (jamais recalculé à chaque ouverture)', async () => {
    const cached = await setupTestStack({ envOverrides: { availabilitySummaryCacheMs: 60_000 } });
    try {
      const s = await seedDemo(cached.db);
      const first = await cached.app.inject({ method: 'GET', url: '/venues/availability-summary' });
      // Un centre créé APRÈS la première lecture : invisible tant que le résumé est en cache.
      await cached.db.insertInto('venues').values({
        name: 'Centre tardif (test cache)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
      }).execute();
      const second = await cached.app.inject({ method: 'GET', url: '/venues/availability-summary' });
      expect(second.body).toBe(first.body);
      expect((second.json() as Summary).venues.some((v) => v.venueId === s.venueId)).toBe(true);
    } finally {
      await cached.teardown();
    }
  });
});
