/* 04/09/2026 — `fields.formats` est un tableau d'ENUM Postgres (`match_format[]`).
   Sans parseur dédié (db/client.ts), le driver renvoyait la chaîne brute
   « {5v5} » : l'API servait un faux tableau et la garde FORMAT_NOT_AVAILABLE
   du core (`field.formats.includes(format)`) ne tenait que par accident
   (`String.prototype.includes`). Cette suite verrouille les deux faces :
   la forme servie ET la garde d'intégrité des matchs. Vrai Postgres 16 éphémère. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(async () => { await stack.teardown(); });

/** Réservation sur T1 (football, formats réels du seed : ['5v5']) — premier
    départ libre parmi quelques candidats, pour ne pas dépendre des
    réservations de démo déjà posées sur ce terrain. */
async function bookT1(): Promise<string> {
  const date = nextNonFriday(4);
  for (const startMin of [600, 690, 780, 870, 960]) {
    const res = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date, startMin, durationMin: 60 },
    });
    if (res.statusCode === 201) return (res.json() as { booking: { id: string } }).booking.id;
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  }
  throw new Error('aucun départ libre sur T1 pour ce test');
}

describe('formats de terrain — tableau réel et garde d’intégrité des matchs', () => {
  it('GET /venues/:id sert `formats` comme un vrai tableau, pour chaque terrain', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect(res.statusCode).toBe(200);
    const fields = (res.json() as { venue: { fields: { id: string; formats: unknown }[] } }).venue.fields;
    for (const f of fields) expect(Array.isArray(f.formats), `formats de ${f.id}`).toBe(true);
    expect(fields.find((f) => f.id === seed.fields.t1)!.formats).toEqual(['5v5']);
    const t3 = fields.find((f) => f.id === seed.fields.t3)!.formats as string[];
    expect(t3).toHaveLength(2);
    expect(t3).toEqual(expect.arrayContaining(['SIMPLE', 'DOUBLE']));
  });

  it('GET /venues (liste) sert aussi de vrais tableaux', async () => {
    // La liste ne montre que les centres validés (SUPERADMIN V1) : le centre
    // seedé naît PENDING dans une base de test, on le valide ici en base.
    await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
    const res = await stack.app.inject({ method: 'GET', url: '/venues' });
    const venue = (res.json() as { venues: { id: string; fields: { formats: unknown }[] }[] }).venues
      .find((v) => v.id === seed.venueId)!;
    for (const f of venue.fields) expect(Array.isArray(f.formats)).toBe(true);
  });

  /* 16/09/2026 — le format d'un match HÉRITE de celui fixé sur la réservation ;
     le corps de la requête n'est plus lu (jamais un choix libre de l'organisateur). */
  it('POST /matches hérite du format stocké sur la réservation — un format envoyé dans le corps est ignoré', async () => {
    const bookingId = await bookT1();
    const stored = await stack.db.selectFrom('bookings').select('format').where('id', '=', bookingId).executeTakeFirstOrThrow();
    expect(stored.format).toBe('5v5'); // terrain mono-format : déduit et stocké à la création
    const res = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Format hérité', format: '7v7' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { match: { format: string } }).match.format).toBe('5v5');
  });

  /* Confirmation n°1 d'Aymen (16/09/2026) : un terrain qui n'a TOUJOURS qu'un
     seul format, avec une résa historique à format NULL, crée son match
     normalement (format déduit de l'unique ligne de field_format_prices). */
  it('résa historique à format NULL sur un terrain à UN seul format : le match se crée, format déduit', async () => {
    const bookingId = await bookT1();
    await stack.db.updateTable('bookings').set({ format: null }).where('id', '=', bookingId).execute();
    const res = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Historique mono-format' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { match: { format: string } }).match.format).toBe('5v5');
  });

  it('le refus (FORMAT_REQUIRED) ne s’applique QUE si le terrain a réellement plusieurs formats ET aucun format fixé sur la résa', async () => {
    const date = nextNonFriday(6);
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date, startMin: 1000, durationMin: 60 },
    });
    expect(bk.statusCode, bk.body).toBe(201);
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    await stack.db.updateTable('bookings').set({ format: null }).where('id', '=', bookingId).execute();
    const refused = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Multi-format sans format fixé' },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect((refused.json() as { error: string }).error).toBe('FORMAT_REQUIRED');

    // Même résa, format fixé : le match hérite (et sa capacité vient du format).
    await stack.db.updateTable('bookings').set({ format: 'SIMPLE' }).where('id', '=', bookingId).execute();
    const ok = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Multi-format fixé' },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const match = (ok.json() as { match: { format: string; capacity: number } }).match;
    expect(match.format).toBe('SIMPLE');
    expect(match.capacity).toBe(2);
  });
});
