import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchLeaveKind } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Règle 4 (MODIFIÉE, 26/10/2026) — trois temps, appliqués par le serveur : désistement libre jusqu'à H-2 ; de H-2 à H-1 partir est possible,
   compte comme une demi-absence (left_at en garde la trace) et la place est reproposée ; à H-1 la composition est figée. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let karim = '', walid = '';
const H = 3_600_000;

async function insertMatch(startInMs: number, joined: string[], capacity = 10): Promise<string> {
  const start = Date.now() + startInMs;
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Trois temps', venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity, price_per_player_da: 500,
    visibility: 'OPEN', status: joined.length + 1 >= capacity ? 'FULL' : 'OPEN', organizer_id: seed.users.sofiane,
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values(
    [seed.users.sofiane, ...joined].map((user_id, i) => ({ match_id: row.id, user_id, status: 'JOINED' as const, team: (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B' })),
  ).execute();
  return row.id;
}
const leave = (token: string, id: string) => stack.app.inject({ method: 'POST', url: `/matches/${id}/leave`, headers: bearer(token) });
const join = (token: string, id: string) => stack.app.inject({ method: 'POST', url: `/matches/${id}/join`, headers: bearer(token) });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;
const playerRow = (matchId: string, userId: string) =>
  stack.db.selectFrom('match_players').selectAll().where('match_id', '=', matchId).where('user_id', '=', userId).executeTakeFirstOrThrow();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
});
afterAll(async () => { await stack.teardown(); });

describe('règle 4 — trois temps', () => {
  it('avant H-2 : le départ est libre (EARLY)', async () => {
    const id = await insertMatch(5 * H, [seed.users.karim]);
    expect((await leave(karim, id)).statusCode).toBe(200);
    const row = await playerRow(id, seed.users.karim);
    expect(row.status).toBe('LEFT');
    expect(row.left_at).not.toBeNull();
    expect(matchLeaveKind({ range: { start: Date.now() + 5 * H, end: 0 } }, row.left_at!.getTime())).toBe('EARLY');
  });

  it('de H-2 à H-1 : le départ passe, c’est une demi-absence (LATE), la place est reproposée et un autre joueur peut la prendre', async () => {
    const id = await insertMatch(90 * 60_000, [seed.users.karim], 2);
    const before = await stack.db.selectFrom('matches').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(before.status).toBe('FULL');
    const res = await leave(karim, id);
    expect(res.statusCode, res.body).toBe(200);
    const row = await playerRow(id, seed.users.karim);
    const match = await stack.db.selectFrom('matches').select(['status', 'time_range']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(match.status).toBe('OPEN');   // la place est reproposée
    const start = Date.now() + 90 * 60_000;
    expect(matchLeaveKind({ range: { start, end: 0 } }, row.left_at!.getTime())).toBe('LATE');
    const taken = await join(walid, id);
    expect(taken.statusCode, taken.body).toBe(200);
    expect((await stack.db.selectFrom('matches').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status).toBe('FULL');
  });

  it('un joueur qui revient après être parti repart de zéro : left_at est remis à NULL', async () => {
    const id = await insertMatch(90 * 60_000, [seed.users.karim]);
    expect((await leave(karim, id)).statusCode).toBe(200);
    expect((await playerRow(id, seed.users.karim)).left_at).not.toBeNull();
    const back = await join(karim, id);
    expect(back.statusCode, back.body).toBe(200);
    const row = await playerRow(id, seed.users.karim);
    expect(row.status).toBe('JOINED');
    expect(row.left_at).toBeNull();
  });

  it('à H-1 : la composition est figée — ni départ (CANCEL_WINDOW_PASSED) ni inscription (MATCH_LOCKED)', async () => {
    const id = await insertMatch(40 * 60_000, [seed.users.karim]);
    const out = await leave(karim, id);
    expect(out.statusCode).toBe(409);
    expect(errorOf(out)).toBe('CANCEL_WINDOW_PASSED');
    expect((await playerRow(id, seed.users.karim)).status).toBe('JOINED');
    const inn = await join(walid, id);
    expect(inn.statusCode).toBe(400);
    expect(errorOf(inn)).toBe('MATCH_LOCKED');
  });
});
