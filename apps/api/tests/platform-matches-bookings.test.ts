import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* SUPERADMIN V1, étape 5 — supervision matchs/réservations, tous centres
   confondus. Réutilise les lectures existantes (module matches/bookings),
   juste sans filtre par centre — aucune règle métier nouvelle. */

const nextNonFriday = makeSafeDayPicker();

describe('SUPERADMIN V1 — supervision matchs et réservations', () => {
  let stack: TestStack;
  let seed: SeedResult;
  let superToken: string;
  let sofiane = '';
  let matchId = '';

  beforeAll(async () => {
    stack = await setupTestStack();
    seed = await seedDemo(stack.db);
    sofiane = await loginAs(stack, seed.phones.sofiane);
    await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true,
    });
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!' },
    });
    superToken = (login.json() as { token: string }).token;

    const day = nextNonFriday(3);
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day, startMin: 600, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match supervision plateforme', format: '5v5' },
    });
    matchId = (created.json() as { match: { id: string } }).match.id;
  });
  afterAll(() => stack.teardown());

  it('réservations — les 3 du seed + celle créée sont visibles, tous centres confondus', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/bookings', headers: bearer(superToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { bookings: { venueName: string; fieldName: string }[] };
    expect(body.bookings.length).toBeGreaterThanOrEqual(4);
    expect(body.bookings.every((b) => b.venueName === 'Complexe Ryad')).toBe(true);
  });

  it('réservations — filtre par terrain', async () => {
    const r = await stack.app.inject({
      method: 'GET', url: `/platform/bookings?fieldId=${seed.fields.t2}`, headers: bearer(superToken),
    });
    const body = r.json() as { bookings: { fieldId: string }[] };
    expect(body.bookings.length).toBeGreaterThan(0);
    expect(body.bookings.every((b) => b.fieldId === seed.fields.t2)).toBe(true);
  });

  it('matchs — le match créé est visible avec organisateur, centre, jauge d’inscrits', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/matches', headers: bearer(superToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { matches: { id: string; venueName: string; organizerName: string; joinedCount: number }[] };
    const m = body.matches.find((x) => x.id === matchId);
    expect(m).toBeDefined();
    expect(m!.venueName).toBe('Complexe Ryad');
    expect(m!.organizerName).toBe('Sofiane B.');
    expect(m!.joinedCount).toBeGreaterThanOrEqual(1); // l'organisateur est inscrit d'office
  });

  it('matchs — filtre par statut', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/matches?status=OPEN', headers: bearer(superToken) });
    const body = r.json() as { matches: { status: string }[] };
    expect(body.matches.length).toBeGreaterThan(0);
    expect(body.matches.every((m) => m.status === 'OPEN')).toBe(true);
  });

  it('non-superadmin : 403 sur matchs et réservations', async () => {
    await createPlatformAccount(stack.db, { email: 'ord3@moubarat.test', password: 'OrdinaireDemo9!', name: 'Ordinaire' });
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: 'ord3@moubarat.test', password: 'OrdinaireDemo9!' },
    });
    const token = (login.json() as { token: string }).token;
    const m = await stack.app.inject({ method: 'GET', url: '/platform/matches', headers: bearer(token) });
    expect(m.statusCode).toBe(403);
    const b = await stack.app.inject({ method: 'GET', url: '/platform/bookings', headers: bearer(token) });
    expect(b.statusCode).toBe(403);
  });
});
