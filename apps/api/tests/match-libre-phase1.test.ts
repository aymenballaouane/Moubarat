import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { algiersDateOf } from '../src/lib/algiers.js';

/* Lot « Match libre », phase 1 (décisions d'Aymen du 16/11/2026), vrai Postgres :
   - un match déjà COMMENCÉ quitte les listes (fil, décomptes par jour), même si son statut stocké est encore OPEN ;
   - un match qui commence dans 30 min y reste (plus de verrou à H-1) ;
   - « Qui peut voir ce match ? » : l'organisateur seul le passe en privé (ou le rend public) après publication. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
const MIN = 60_000;

async function insertMatch(startInMs: number, joined: string[] = [], over: { visibility?: 'OPEN' | 'PRIVATE'; status?: 'OPEN' | 'CANCELLED' } = {}): Promise<{ id: string; code: string }> {
  const start = Date.now() + startInMs;
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Phase 1', venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * MIN }), capacity: 10, price_per_player_da: 500,
    visibility: over.visibility ?? 'OPEN', status: over.status ?? 'OPEN', organizer_id: seed.users.sofiane,
  }).returning(['id', 'code']).executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values(
    [seed.users.sofiane, ...joined].map((user_id, i) => ({ match_id: row.id, user_id, status: 'JOINED' as const, team: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' })),
  ).execute();
  return { id: row.id, code: row.code };
}
const feedIds = async (qs = ''): Promise<string[]> => {
  const res = await stack.app.inject({ method: 'GET', url: `/matches?limit=100${qs}` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { matches: { id: string }[] }).matches.map((m) => m.id);
};
const setVisibility = (token: string, id: string, visibility: unknown) =>
  stack.app.inject({ method: 'PUT', url: `/matches/${id}/visibility`, headers: bearer(token), payload: { visibility } });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
});
afterAll(async () => { await stack.teardown(); });

describe('listes — un match commencé n’y est plus, un match qui commence bientôt y est encore', () => {
  it('le fil et les décomptes par jour excluent le match commencé (statut encore OPEN) et gardent celui dans 30 min', async () => {
    const started = await insertMatch(-10 * MIN);
    const soon = await insertMatch(30 * MIN);
    const ids = await feedIds();
    expect(ids).not.toContain(started.id);
    expect(ids).toContain(soon.id);

    // Les deux tombent le même jour d'Alger, sauf autour de minuit : on compare au décompte du jour de « soon ».
    const day = algiersDateOf(Date.now() + 30 * MIN);
    const sameDayIds = await feedIds(`&day=${day}`);
    const counts = await stack.app.inject({ method: 'GET', url: `/matches/day-counts?from=${day}&days=1` });
    expect(counts.statusCode, counts.body).toBe(200);
    const n = (counts.json() as { counts: Record<string, number> }).counts[day] ?? 0;
    expect(n).toBe(sameDayIds.length);
    expect(sameDayIds).not.toContain(started.id);
  });
});

describe('PUT /matches/:id/visibility — public ↔ privé après publication', () => {
  it('passer en privé : le match quitte le fil, l’inscrit garde sa place, un tiers le rejoint par son lien ; puis retour en public', async () => {
    const m = await insertMatch(5 * 3_600_000, [seed.users.karim]);
    expect(await feedIds()).toContain(m.id);

    const res = await setVisibility(sofiane, m.id, 'PRIVATE');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, visibility: 'PRIVATE' });
    expect(await feedIds()).not.toContain(m.id);

    // L'inscrit garde sa place et voit toujours le match.
    const mine = await stack.app.inject({ method: 'GET', url: `/matches/${m.id}`, headers: bearer(karim) });
    expect(mine.statusCode, mine.body).toBe(200);
    const kept = await stack.db.selectFrom('match_players').select('status').where('match_id', '=', m.id).where('user_id', '=', seed.users.karim).executeTakeFirstOrThrow();
    expect(kept.status).toBe('JOINED');

    // Un tiers : introuvable par l'identifiant seul, trouvable et rejoignable par le lien (code).
    expect((await stack.app.inject({ method: 'GET', url: `/matches/${m.id}`, headers: bearer(walid) })).statusCode).toBe(403);
    const byLink = await stack.app.inject({ method: 'GET', url: `/matches/by-code/${m.code}`, headers: bearer(walid) });
    expect(byLink.statusCode, byLink.body).toBe(200);
    const joined = await stack.app.inject({ method: 'POST', url: `/matches/${m.id}/join`, headers: bearer(walid) });
    expect(joined.statusCode, joined.body).toBe(200);

    const back = await setVisibility(sofiane, m.id, 'OPEN');
    expect(back.statusCode, back.body).toBe(200);
    expect(await feedIds()).toContain(m.id);
  });

  it('refus : pas l’organisateur (403), même visibilité (409), valeur inconnue (400), match commencé ou annulé (409), match de défi (409)', async () => {
    const m = await insertMatch(5 * 3_600_000, [seed.users.karim]);
    const stranger = await setVisibility(karim, m.id, 'PRIVATE');
    expect(stranger.statusCode).toBe(403);
    expect(errorOf(stranger)).toBe('NOT_ORGANIZER');
    const same = await setVisibility(sofiane, m.id, 'OPEN');
    expect(same.statusCode).toBe(409);
    expect(errorOf(same)).toBe('SAME_VISIBILITY');
    const bad = await setVisibility(sofiane, m.id, 'PUBLIC');
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad)).toBe('BAD_VISIBILITY');

    const started = await insertMatch(-10 * MIN);
    const late = await setVisibility(sofiane, started.id, 'PRIVATE');
    expect(late.statusCode).toBe(409);
    expect(errorOf(late)).toBe('MATCH_LOCKED');

    const cancelled = await insertMatch(5 * 3_600_000, [], { status: 'CANCELLED' });
    const dead = await setVisibility(sofiane, cancelled.id, 'PRIVATE');
    expect(dead.statusCode).toBe(409);
    expect(errorOf(dead)).toBe('MATCH_CANCELLED');

    const challengeLike = await insertMatch(5 * 3_600_000, [], { visibility: 'PRIVATE' });
    const challenge = await stack.db.selectFrom('challenges').select('id').executeTakeFirst();
    if (challenge) {
      await stack.db.updateTable('matches').set({ challenge_id: challenge.id }).where('id', '=', challengeLike.id).execute();
      const defi = await setVisibility(sofiane, challengeLike.id, 'OPEN');
      expect(defi.statusCode).toBe(409);
      expect(errorOf(defi)).toBe('MATCH_PRIVATE');
    }
    const still = await stack.db.selectFrom('matches').select('visibility').where('id', '=', m.id).executeTakeFirstOrThrow();
    expect(still.visibility).toBe('OPEN');
  });
});
