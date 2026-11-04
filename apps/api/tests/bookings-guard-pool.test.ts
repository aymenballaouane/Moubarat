/* Audit 07/09/2026 (T3) — la garde centre de POST /bookings/:id/verify et
   /status s'évaluait À L'INTÉRIEUR de la transaction (après le FOR UPDATE),
   sur le pool racine : chaque requête détenait une connexion (la transaction)
   et en demandait une deuxième (la garde). Avec N requêtes simultanées pour
   un pool de N, plus personne n'avançait — interblocage applicatif de toute
   l'API. Ce fichier rend la famine observable de façon DÉTERMINISTE avec un
   pool de 1 connexion : avant le correctif, même une seule requête ne se
   termine jamais (la transaction tient l'unique connexion, la garde en attend
   une autre — timeout vitest) ; après, la garde s'évalue avant la transaction
   et tout aboutit, y compris deux requêtes lancées ensemble (sérialisées par
   le pool, jamais bloquées). Vrai Postgres 16 éphémère, comme partout. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '';   // OWNER — CANCEL_BOOKING et SET_CASH_STATUS
let sofiane = ''; // joueur

beforeAll(async () => {
  stack = await setupTestStack({ poolMax: 1 });
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(() => stack.teardown());

function nextWeekday(target: number, minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 8; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
  }
  throw new Error('unreachable');
}

async function bookAsPlayer(fieldId: string, date: string, startMin: number): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId, date, startMin, durationMin: 60 },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string } }).booking.id;
}

describe('garde centre hors transaction (audit T3)', () => {
  it('un changement de statut aboutit avec un pool d’UNE connexion, et deux lancés ensemble aussi (avant : interblocage dès le premier)', async () => {
    const day = nextWeekday(3, 35); // un mercredi, loin des abonnements du seed (mardi T1, dimanche T2)
    const a = await bookAsPlayer(seed.fields.t1, day, 900);
    const b = await bookAsPlayer(seed.fields.t2, day, 900);

    const setHonored = (id: string) => stack.app.inject({
      method: 'POST', url: `/bookings/${id}/status`, headers: bearer(hamid), payload: { status: 'HONORED' },
    });
    const [ra, rb] = await Promise.all([setHonored(a), setHonored(b)]);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(rb.statusCode, rb.body).toBe(200);

    const rows = await stack.db.selectFrom('bookings').select(['id', 'status']).where('id', 'in', [a, b]).execute();
    expect(rows.map((r) => r.status)).toEqual(['HONORED', 'HONORED']);
  }, 8_000);

  it('isolation : un compte du centre A ne change pas le statut (ni ne confirme) une réservation du centre B — 403, avant toute écriture', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test garde)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: otherVenue.id, name: 'TX', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    });
    const player = await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow();
    const start = dayStartMs(nextWeekday(3, 42)) + 900 * 60_000;
    const foreign = await stack.db.insertInto('bookings').values({
      field_id: otherField.id, time_range: toPgRange({ start, end: start + 3_600_000 }),
      status: 'RESERVED', source: 'PHONE', verified_by_center: false, by_user_id: player.id,
      price_total_da: 2000, discount_da: 0,
    }).returning('id').executeTakeFirstOrThrow();

    const status = await stack.app.inject({
      method: 'POST', url: `/bookings/${foreign.id}/status`, headers: bearer(hamid), payload: { status: 'HONORED' },
    });
    expect(status.statusCode).toBe(403);
    const verify = await stack.app.inject({ method: 'POST', url: `/bookings/${foreign.id}/verify`, headers: bearer(hamid) });
    expect(verify.statusCode).toBe(403);

    const untouched = await stack.db.selectFrom('bookings').select(['status', 'verified_by_center'])
      .where('id', '=', foreign.id).executeTakeFirstOrThrow();
    expect(untouched).toEqual({ status: 'RESERVED', verified_by_center: false });
  });
});
