import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot 6 « Créer un match » (26/10/2026, migration 0033) : le « petit mot pour les joueurs » de l'organisateur est
   enregistré avec le match (avant : le champ existait dans l'app mais n'était jamais envoyé). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '';
const nextDay = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
});
afterAll(async () => { await stack.teardown(); });

async function bookAndMatch(startMin: number, dayOffset: number, extra: Record<string, unknown>) {
  const booked = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t1, durationMin: 60, date: nextDay(dayOffset), startMin },
  });
  expect(booked.statusCode, booked.body).toBe(201);
  const bookingId = (booked.json() as { booking: { id: string } }).booking.id;
  return stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Green Arena Sport', ...extra } });
}

describe('POST /matches — mot aux joueurs', () => {
  it('le mot est enregistré, rogné, et servi par GET /matches/:id', async () => {
    const created = await bookAndMatch(600, 3, { note: '  On joue à la cool.  ' });
    expect(created.statusCode, created.body).toBe(201);
    const match = (created.json() as { match: { id: string; note: string | null } }).match;
    expect(match.note).toBe('On joue à la cool.');
    const read = await stack.app.inject({ method: 'GET', url: `/matches/${match.id}` });
    expect((read.json() as { match: { note: string | null } }).match.note).toBe('On joue à la cool.');
  });

  it('sans mot, ou un mot vide : note = null', async () => {
    const none = await bookAndMatch(660, 4, {});
    expect((none.json() as { match: { note: string | null } }).match.note).toBeNull();
    const blank = await bookAndMatch(720, 5, { note: '   ' });
    expect(blank.statusCode, blank.body).toBe(201);
    expect((blank.json() as { match: { note: string | null } }).match.note).toBeNull();
  });

  it('plus de 280 signes → 400 NOTE_TOO_LONG, et aucun match créé', async () => {
    const refused = await bookAndMatch(780, 6, { note: 'x'.repeat(281) });
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: string }).error).toBe('NOTE_TOO_LONG');
    const ok = await bookAndMatch(840, 7, { note: 'x'.repeat(280) });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('un mot qui n’est pas un texte → 400', async () => {
    const refused = await bookAndMatch(900, 8, { note: 42 });
    expect(refused.statusCode).toBe(400);
  });
});
