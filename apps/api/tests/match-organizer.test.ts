import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker, SEED_SUBSCRIPTION_WEEKDAY } from './helpers/dates.js';

/* Lot 7 — l'organisateur gère son match : « Ton mot aux joueurs » (MotAuxJoueurs, 280 signes, migration 0035) et le groupe
   WhatsApp (règle 10, NOUVELLE). Le lien du groupe n'est visible que de l'organisateur et des inscrits : jamais dans une liste,
   jamais pour un visiteur ni un joueur non inscrit (quiconque le lit entre dans le groupe et y voit tous les numéros). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
let matchId = '';
/* La réservation ci-dessous vise T1 à 20:00 : le seed y place l'abonnement du mardi (FC Kahwa, 20:00-21:30) — jour à éviter,
   sinon le test échoue (409 SLOT_TAKEN) les jours où « aujourd'hui + 5 » tombe un mardi (constaté le 05/11/2026). */
const nextDay = makeSafeDayPicker([SEED_SUBSCRIPTION_WEEKDAY.T1]);
const GROUP = 'https://chat.whatsapp.com/Kx7Q2Rr9AbCdEf';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  const booked = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t1, durationMin: 60, date: nextDay(5), startMin: 1200, format: '5v5' },
  });
  expect(booked.statusCode, booked.body).toBe(201);
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId: (booked.json() as { booking: { id: string } }).booking.id, title: 'Green Arena Sport', note: 'Premier mot' },
  });
  matchId = (created.json() as { match: { id: string } }).match.id;
  expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim), payload: {} })).statusCode).toBe(200);
});
afterAll(async () => { await stack.teardown(); });

const put = (path: string, token: string, payload: unknown) =>
  stack.app.inject({ method: 'PUT', url: `/matches/${matchId}/${path}`, headers: bearer(token), payload: payload as Record<string, unknown> });
async function detail(token?: string) {
  const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, ...(token ? { headers: bearer(token) } : {}) });
  return (res.json() as { match: { whatsappUrl: string | null; hasGroup: boolean; note: string | null } }).match;
}

describe('« Ton mot aux joueurs »', () => {
  it('l’organisateur le modifie (280 signes, rogné) ; vide = plus de mot', async () => {
    const res = await put('note', sofiane, { note: '  Coup d’envoi à 21:30 pile.  ' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await detail(sofiane)).note).toBe('Coup d’envoi à 21:30 pile.');
    expect((await put('note', sofiane, { note: 'x'.repeat(280) })).statusCode).toBe(200);
    const tooLong = await put('note', sofiane, { note: 'x'.repeat(281) });
    expect(tooLong.statusCode).toBe(400);
    expect((tooLong.json() as { error: string }).error).toBe('NOTE_TOO_LONG');
    expect((await put('note', sofiane, { note: '   ' })).statusCode).toBe(200);
    expect((await detail(sofiane)).note).toBeNull();
  });
  it('un autre joueur ne le modifie pas (403)', async () => {
    const res = await put('note', karim, { note: 'Je prends la main' });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('NOT_ORGANIZER');
  });
});

describe('groupe WhatsApp (règle 10)', () => {
  it('sans groupe : hasGroup false et aucun lien', async () => {
    const m = await detail(sofiane);
    expect(m.hasGroup).toBe(false);
    expect(m.whatsappUrl).toBeNull();
  });
  it('seul un lien chat.whatsapp.com est accepté', async () => {
    for (const bad of ['http://chat.whatsapp.com/Kx7Q2Rr9AbCdEf', 'https://wa.me/213550000000', 'https://chat.whatsapp.com/', 'n’importe quoi', 42]) {
      const res = await put('whatsapp', sofiane, { url: bad });
      expect(res.statusCode, String(bad)).toBe(400);
      expect((res.json() as { error: string }).error).toBe('BAD_WHATSAPP_URL');
    }
  });
  it('un autre joueur ne l’ajoute pas (403)', async () => {
    expect((await put('whatsapp', karim, { url: GROUP })).statusCode).toBe(403);
  });
  it('ajouté : l’organisateur et les inscrits le lisent ; un visiteur et un joueur non inscrit non, et jamais dans les listes', async () => {
    expect((await put('whatsapp', sofiane, { url: GROUP })).statusCode).toBe(200);
    expect((await detail(sofiane)).whatsappUrl).toBe(GROUP);          // organisateur
    expect((await detail(karim)).whatsappUrl).toBe(GROUP);            // inscrit
    const outsider = await detail(walid);                              // connecté mais pas inscrit
    expect(outsider.whatsappUrl).toBeNull();
    expect(outsider.hasGroup).toBe(true);
    const visitor = await detail();
    expect(visitor.whatsappUrl).toBeNull();
    const list = await stack.app.inject({ method: 'GET', url: '/matches', headers: bearer(walid) });
    expect(JSON.stringify(list.json())).not.toContain('chat.whatsapp.com');
    const mine = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(karim) });
    expect(JSON.stringify(mine.json())).not.toContain('chat.whatsapp.com');
  });
  it('changé, puis retiré (url: null)', async () => {
    const other = 'https://chat.whatsapp.com/ZzZzZzZzZz1234';
    expect((await put('whatsapp', sofiane, { url: other })).statusCode).toBe(200);
    expect((await detail(karim)).whatsappUrl).toBe(other);
    expect((await put('whatsapp', sofiane, { url: null })).statusCode).toBe(200);
    const m = await detail(karim);
    expect(m.whatsappUrl).toBeNull();
    expect(m.hasGroup).toBe(false);
  });
});
