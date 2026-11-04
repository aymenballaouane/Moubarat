/* A6 — chargement en lot de la disponibilité (cadrage multi-centre/scalabilité, 22/09/2026, F4) :
   loadDayContext devient un cas particulier de loadFieldContextsBatch ; next-availability charge
   désormais TOUS les terrains ET TOUS les jours recherchés en une seule fois. Cette suite vérifie
   que le résultat reste identique à l'ancien chemin (terrain × jour), en particulier l'isolation
   des blocages entre terrains — le risque réel d'un chargement en lot mal fait. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { loadDayContext, loadFieldContextsBatch, dayContextFor } from '../src/modules/bookings/service.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // OWNER
});
afterAll(async () => { await stack.teardown(); });

/** Compare deux DayContext en ignorant l'ordre au sein de chaque collection — la seule garantie
    d'ORDER BY porte sur `priority` (pricing_rules) : deux règles de même priorité mais de formats
    différents (seed T3 : DOUBLE/SIMPLE) n'ont aucun ordre relatif garanti, sans que ça n'affecte
    jamais un calcul réel (quoteRange filtre par format avant de regarder quoi que ce soit d'autre,
    packages/core/src/rules/availability.ts:119). Comparer l'ordre brut aurait testé un détail
    d'implémentation sans rapport avec la disponibilité recalculée en lot (le vrai risque ici). */
function sortedKeys<T>(arr: readonly T[]): string[] {
  return arr.map((x) => JSON.stringify(x)).sort();
}
function expectSameContext(a: ReturnType<typeof dayContextFor>, b: ReturnType<typeof dayContextFor>) {
  expect(a.field).toEqual(b.field);
  expect(a.venue).toEqual(b.venue);
  expect(a.dayStartMs).toBe(b.dayStartMs);
  expect(a.weekday).toBe(b.weekday);
  expect(sortedKeys(a.hours)).toEqual(sortedKeys(b.hours));
  expect(sortedKeys(a.rules)).toEqual(sortedKeys(b.rules));
  expect(sortedKeys(a.existing)).toEqual(sortedKeys(b.existing));
  expect(sortedKeys(a.recurring)).toEqual(sortedKeys(b.recurring));
  expect(sortedKeys(a.closures)).toEqual(sortedKeys(b.closures));
}

describe('loadFieldContextsBatch — même résultat que loadDayContext, en une requête pour N terrains', () => {
  it('T1/T2/T3 en lot == chacun chargé individuellement (champs statiques, existing, closures)', async () => {
    const date = nextNonFriday(3);
    const dayStart = dayStartMs(date);
    const [t1Alone, t2Alone, t3Alone] = await Promise.all([
      loadDayContext(stack.db, seed.fields.t1, dayStart),
      loadDayContext(stack.db, seed.fields.t2, dayStart),
      loadDayContext(stack.db, seed.fields.t3, dayStart),
    ]);

    const batch = await loadFieldContextsBatch(stack.db, [seed.fields.t1, seed.fields.t2, seed.fields.t3], dayStart, dayStart + 2 * 86_400_000);
    expectSameContext(dayContextFor(batch.get(seed.fields.t1)!, dayStart), t1Alone);
    expectSameContext(dayContextFor(batch.get(seed.fields.t2)!, dayStart), t2Alone);
    expectSameContext(dayContextFor(batch.get(seed.fields.t3)!, dayStart), t3Alone);
  });

  it('terrain inconnu : simplement absent de la Map, jamais une erreur', async () => {
    const dayStart = dayStartMs(nextNonFriday(3));
    const batch = await loadFieldContextsBatch(stack.db, ['00000000-0000-4000-8000-000000000000'], dayStart, dayStart + 2 * 86_400_000);
    expect(batch.size).toBe(0);
  });
});

describe('GET /venues/:id/next-availability — deux terrains FOOTBALL (T1, T2), isolation des blocages', () => {
  async function bookField(fieldId: string, date: string, startMin: number) {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(hamid),
      payload: { fieldId, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Test Disponibilite' },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  it('T1 entièrement réservé sur le premier créneau du jour : la recherche bascule sur T2, pas sur un autre jour', async () => {
    const date = nextNonFriday(4);
    await bookField(seed.fields.t1, date, 480); // 08:00, ouverture — le tout premier départ possible

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=FOOTBALL&duration=60&from=${date}`, headers: bearer(hamid),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { found: boolean; date: string; fieldId: string; startMin: number };
    expect(body.found).toBe(true);
    expect(body.date).toBe(date); // toujours le même jour — T2 est libre à la même heure
    expect(body.fieldId).toBe(seed.fields.t2); // jamais T1 : son premier créneau vient d'être pris
    expect(body.startMin).toBe(480);
  });

  it('un blocage sur T1 ne fuit jamais vers T2 (isolation des existants par terrain dans le lot)', async () => {
    const date = nextNonFriday(5);
    await bookField(seed.fields.t1, date, 540); // 09:00 sur T1 seulement

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/next-availability?sport=FOOTBALL&duration=60&from=${date}`, headers: bearer(hamid),
    });
    const body = res.json() as { found: boolean; fieldId: string; startMin: number };
    // Le tout premier créneau (08:00) reste libre sur T2 (et sur T1, qui n'est bloqué qu'à 09:00) —
    // la recherche retient donc 08:00, sur l'un des deux terrains, jamais un décalage causé par le
    // blocage de l'autre terrain.
    expect(body.found).toBe(true);
    expect(body.startMin).toBe(480);
  });
});
