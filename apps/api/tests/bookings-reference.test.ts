/* Audit 07/09/2026 (S1) — la référence de réservation dérivait d'un COUNT(*)
   hors transaction rattrapé par cinq essais : six créations simultanées sur un
   centre donnaient un 500 REFERENCE_EXHAUSTED sur un créneau libre. Désormais
   une séquence par centre (`venues.booking_seq`, migration 0013), incrémentée
   sous verrou de ligne dans la transaction de l'INSERT.

   22/09/2026 (audit multi-centre, décision Aymen, migration 0021) : le
   préfixe est désormais un CODE FIXE (`venues.booking_prefix`), attribué UNE
   FOIS à la création — deux centres ne peuvent PLUS jamais partager le même
   préfixe (contrainte UNIQUE en base), le scénario « collision entre deux
   centres » de ce fichier n'existe plus par construction (remplacé par un
   test qui le prouve). Numéro élargi à 6 chiffres. Vrai Postgres 16 éphémère.
   Deux garanties vérifiées ici : continuité de la numérotation après
   migration, huit créations concurrentes toutes acceptées avec des numéros
   distincts et consécutifs. Le test de collision de PRÉFIXE côté création de
   centre vit dans `venue-booking-prefix.test.ts`. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingReference, weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '';
let bookingPrefix = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  bookingPrefix = (await stack.db.selectFrom('venues').select('booking_prefix').where('id', '=', seed.venueId).executeTakeFirstOrThrow()).booking_prefix;
});
afterAll(() => stack.teardown());

function nextWeekday(target: number, minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 8; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
  }
  throw new Error('unreachable');
}

async function countBookings(venueId: string): Promise<number> {
  const r = await stack.db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
    .select((eb) => eb.fn.countAll<string>().as('n')).where('fields.venue_id', '=', venueId).executeTakeFirstOrThrow();
  return Number(r.n);
}

async function seqOf(venueId: string): Promise<number> {
  return (await stack.db.selectFrom('venues').select('booking_seq').where('id', '=', venueId).executeTakeFirstOrThrow()).booking_seq;
}

function refNumber(reference: string): number {
  return Number(reference.split('-')[1]);
}

function book(fieldId: string, date: string, startMin: number) {
  return stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId, date, startMin, durationMin: 60 },
  });
}

describe('référence de réservation — séquence par centre (audit S1), préfixe fixe (22/09/2026)', () => {
  it('continuité : la séquence repart du nombre de réservations existantes, la première nouvelle référence est n+1', async () => {
    const before = await countBookings(seed.venueId);
    expect(await seqOf(seed.venueId)).toBe(before); // migration 0013 : initialisée au count, jamais à zéro

    const res = await book(seed.fields.t1, nextWeekday(1, 40), 600); // un lundi, hors abonnements du seed
    expect(res.statusCode, res.body).toBe(201);
    const { reference } = (res.json() as { booking: { reference: string } }).booking;
    expect(reference).toBe(bookingReference(bookingPrefix, before + 1));
    expect(reference).toMatch(/^[A-Z]{3}-\d{6}$/); // format élargi (6 chiffres, au lieu de 4)
    expect(await seqOf(seed.venueId)).toBe(before + 1);
  });

  it('huit créations simultanées sur le même centre : huit 201, références distinctes et consécutives (avant : 500 dès la sixième)', async () => {
    const start = await seqOf(seed.venueId);
    const day = nextWeekday(1, 47);
    // Créneaux disjoints dans le temps (aucun conflit d'agenda pour le joueur), sur deux terrains.
    const slots: [string, number][] = [
      [seed.fields.t1, 600], [seed.fields.t2, 660], [seed.fields.t1, 720], [seed.fields.t2, 780],
      [seed.fields.t1, 840], [seed.fields.t2, 900], [seed.fields.t1, 960], [seed.fields.t2, 1020],
    ];
    const results = await Promise.all(slots.map(([fieldId, startMin]) => book(fieldId, day, startMin)));
    for (const r of results) expect(r.statusCode, r.body).toBe(201);

    const numbers = results.map((r) => refNumber((r.json() as { booking: { reference: string } }).booking.reference)).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => start + 1 + i));
    expect(await seqOf(seed.venueId)).toBe(start + 8);
  });

  it('rebouclage de la séquence après 1 000 000 (un seul centre) : le SAVEPOINT saute le numéro déjà pris, jamais un 500', async () => {
    // Une référence déjà prise au numéro k. On règle la séquence juste avant, en la faisant DÉPASSER
    // 1 000 000 pour vérifier que le modulo (bookingReference) reboucle exactement sur k — le SAVEPOINT
    // absorbe cette collision en sautant au numéro suivant, sans jamais empoisonner la transaction.
    const taken = await stack.db.selectFrom('bookings').select('reference').innerJoin('fields', 'fields.id', 'bookings.field_id')
      .where('fields.venue_id', '=', seed.venueId).where('reference', 'is not', null)
      .orderBy('reference', 'desc').executeTakeFirstOrThrow();
    const k = refNumber(taken.reference!);
    await stack.db.updateTable('venues').set({ booking_seq: 1_000_000 + k - 1 }).where('id', '=', seed.venueId).execute();

    const res = await book(seed.fields.t1, nextWeekday(2, 60), 600);
    expect(res.statusCode, res.body).toBe(201);
    const { reference } = (res.json() as { booking: { reference: string } }).booking;
    expect(reference).not.toBe(taken.reference);
    expect(reference).toBe(bookingReference(bookingPrefix, 1_000_000 + k));
    expect(await seqOf(seed.venueId)).toBe(1_000_000 + k);
  });
});
