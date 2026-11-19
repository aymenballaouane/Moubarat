import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* Lot B, phase 4 — bloquer un joueur : effets côté serveur (fil, lien, rejoindre), dans les deux sens, sans toucher aux inscriptions
   déjà faites. */

const F = { 'x-moubarat-features': 'match-libre,format-9v9' };
let stack: TestStack;
let seed: SeedResult;
let karim = ''; let sofiane = ''; let walid = '';
let karimId = ''; let sofianeId = ''; let walidId = '';
let matchK = { id: '', code: '' };

const idOf = async (phone: string) => (await stack.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow()).id;
const feedIds = async (token: string) => ((await stack.app.inject({ method: 'GET', url: '/matches?limit=100', headers: { ...bearer(token), ...F } })).json() as { matches: { id: string }[] }).matches.map((m) => m.id);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  [karim, sofiane, walid] = await Promise.all([loginAs(stack, seed.phones.karim), loginAs(stack, seed.phones.sofiane), loginAs(stack, seed.phones.walid)]);
  [karimId, sofianeId, walidId] = await Promise.all([idOf(seed.phones.karim), idOf(seed.phones.sofiane), idOf(seed.phones.walid)]);
  const start = Math.ceil((Date.now() + 400 * 3_600_000) / 1_800_000) * 1_800_000;
  const res = await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(karim), ...F }, payload: {
    place: { name: 'Terrain · Kouba', wilaya: 'Alger' }, format: '5v5', level: 'LOISIR', start, durationMin: 90,
  } });
  expect(res.statusCode, res.body).toBe(201);
  matchK = (res.json() as { match: { id: string; code: string } }).match;
  // Walid est déjà inscrit au match de Karim avant d'être bloqué.
  expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchK.id}/join`, headers: { ...bearer(walid), ...F } })).statusCode).toBeLessThan(300);
});
afterAll(async () => { await stack.teardown(); });

describe('bloquer un joueur', () => {
  it('on ne se bloque pas soi-même ; un inconnu : 404', async () => {
    expect((await stack.app.inject({ method: 'POST', url: '/me/blocks', headers: bearer(karim), payload: { userId: karimId } })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'POST', url: '/me/blocks', headers: bearer(karim), payload: { userId: '00000000-0000-0000-0000-000000000000' } })).statusCode).toBe(404);
  });

  it('Karim bloque Sofiane et Walid : chacun disparaît du fil de l’autre ; Sofiane ne rejoint pas, par le lien non plus', async () => {
    expect(await feedIds(sofiane)).toContain(matchK.id);
    for (const id of [sofianeId, walidId]) {
      const res = await stack.app.inject({ method: 'POST', url: '/me/blocks', headers: bearer(karim), payload: { userId: id } });
      expect(res.statusCode, res.body).toBe(204);
    }
    expect(await feedIds(sofiane)).not.toContain(matchK.id);
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchK.id}/join`, headers: { ...bearer(sofiane), ...F } });
    expect(join.statusCode).toBe(404);
    expect((join.json() as { error: string; message: string })).toMatchObject({ error: 'MATCH_UNAVAILABLE', message: 'Ce match n’est plus disponible.' });
    const link = await stack.app.inject({ method: 'GET', url: `/matches/by-code/${matchK.code}`, headers: { ...bearer(sofiane), ...F } });
    expect(link.statusCode).toBe(404);
    const detail = await stack.app.inject({ method: 'GET', url: `/matches/${matchK.id}`, headers: { ...bearer(sofiane), ...F } });
    expect(detail.statusCode).toBe(404);
  });

  it('un inscrit d’avant le blocage garde son match ; personne n’est prévenu', async () => {
    const detail = await stack.app.inject({ method: 'GET', url: `/matches/${matchK.id}`, headers: { ...bearer(walid), ...F } });
    expect(detail.statusCode, detail.body).toBe(200);
    const notifs = await stack.db.selectFrom('notifications').select('type').where('user_id', 'in', [sofianeId, walidId]).where('created_at', '>', new Date(Date.now() - 60_000)).execute();
    expect(notifs.map((n) => n.type)).not.toContain('PLAYER_REMOVED');
  });

  it('Joueurs bloqués : la liste (prénom ou pseudo), puis « Débloquer » rend tout comme avant', async () => {
    const list = (await stack.app.inject({ method: 'GET', url: '/me/blocks', headers: bearer(karim) })).json() as { blocked: { userId: string; name: string }[] };
    expect(list.blocked.map((b) => b.userId).sort()).toEqual([sofianeId, walidId].sort());
    expect(list.blocked.every((b) => b.name.length > 0)).toBe(true);
    expect((await stack.app.inject({ method: 'DELETE', url: `/me/blocks/${sofianeId}`, headers: bearer(karim) })).statusCode).toBe(204);
    expect(await feedIds(sofiane)).toContain(matchK.id);
    expect((await stack.app.inject({ method: 'GET', url: `/matches/by-code/${matchK.code}`, headers: { ...bearer(sofiane), ...F } })).statusCode).toBe(200);
  });

  it('celui qui bloque ne voit plus les matchs du joueur bloqué', async () => {
    const start = Math.ceil((Date.now() + 420 * 3_600_000) / 1_800_000) * 1_800_000;
    const res = await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(walid), ...F }, payload: {
      place: { name: 'Terrain · Hydra', wilaya: 'Alger' }, format: '5v5', level: 'LOISIR', start, durationMin: 90,
    } });
    const walidMatch = (res.json() as { match: { id: string } }).match.id;
    expect(await feedIds(karim)).not.toContain(walidMatch);
    expect(await feedIds(sofiane)).toContain(walidMatch);
  });
});
