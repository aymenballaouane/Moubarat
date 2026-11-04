import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot 7 (règle 3, NOUVELLE — migration 0034) : on choisit son équipe (sa paire au padel) ; changement d'équipe tant que les
   inscriptions sont ouvertes. Padel DOUBLE = 4 places, 2 par équipe. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', fouad = '', reda = '';
const nextDay = makeSafeDayPicker();
let matchId = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  [sofiane, karim, walid, fouad, reda] = (await Promise.all(
    [seed.phones.sofiane, seed.phones.karim, seed.phones.walid, seed.phones.fouad, seed.phones.reda].map((p) => loginAs(stack, p)),
  )) as [string, string, string, string, string];
  const booked = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t3, durationMin: 60, date: nextDay(4), startMin: 1080, format: 'DOUBLE' },
  });
  expect(booked.statusCode, booked.body).toBe(201);
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId: (booked.json() as { booking: { id: string } }).booking.id, title: 'Padel' },
  });
  expect(created.statusCode, created.body).toBe(201);
  matchId = (created.json() as { match: { id: string } }).match.id;
});
afterAll(async () => { await stack.teardown(); });

const join = (token: string, team?: string) => stack.app.inject({
  method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(token), payload: team === undefined ? {} : { team },
});
const changeTo = (token: string, team: string) => stack.app.inject({
  method: 'POST', url: `/matches/${matchId}/team`, headers: bearer(token), payload: { team },
});
async function roster(token?: string) {
  const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, ...(token ? { headers: bearer(token) } : {}) });
  return res.json() as { match: { teamCounts: { A: number; B: number }; players: { name: string; team: 'A' | 'B' | null; userId: string }[] } };
}

describe('règle 3 — équipes (API)', () => {
  it('l’organisateur est dans l’équipe A', async () => {
    const r = await roster(sofiane);
    expect(r.match.players).toHaveLength(1);
    expect(r.match.players[0]!.team).toBe('A');
    expect(r.match.teamCounts).toEqual({ A: 1, B: 0 });
  });

  it('sans équipe demandée : celle qui a le plus de places (B) ; équipe invalide : 400', async () => {
    const bad = await join(karim, 'C');
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('BAD_TEAM');
    const res = await join(karim);
    expect(res.statusCode, res.body).toBe(200);
    expect((await roster(karim)).match.teamCounts).toEqual({ A: 1, B: 1 });
  });

  it('équipe choisie ; équipe complète → 409 MATCH_TEAM_FULL ; l’autre reste ouverte', async () => {
    expect((await join(walid, 'B')).statusCode).toBe(200);                      // B : karim + walid = complète
    const full = await join(fouad, 'B');
    expect(full.statusCode).toBe(400);
    expect((full.json() as { error: string }).error).toBe('MATCH_TEAM_FULL');
    expect((await join(fouad, 'A')).statusCode).toBe(200);                     // A : sofiane + fouad → match complet
    const r = await roster(sofiane);
    expect(r.match.teamCounts).toEqual({ A: 2, B: 2 });
    expect(new Map(r.match.players.map((p) => [p.userId, p.team])).size).toBe(4);
  });

  it('visiteur : les places par équipe sans aucun nom', async () => {
    const visitor = await roster();
    expect(visitor.match.teamCounts).toEqual({ A: 2, B: 2 });
    expect(visitor.match.players).toEqual([]);
  });

  it('match complet : un cinquième est refusé (MATCH_FULL)', async () => {
    const res = await join(reda);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MATCH_FULL');
  });

  it('changer d’équipe : refusé si l’autre est pleine, accepté après un départ, refusé si c’est la même', async () => {
    const full = await changeTo(karim, 'A');
    expect(full.statusCode).toBe(400);
    expect((full.json() as { error: string }).error).toBe('MATCH_TEAM_FULL');
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/leave`, headers: bearer(fouad) })).statusCode).toBe(200);
    expect((await changeTo(karim, 'A')).statusCode).toBe(200);
    expect((await roster(karim)).match.teamCounts).toEqual({ A: 2, B: 1 });
    const same = await changeTo(karim, 'A');
    expect(same.statusCode).toBe(400);
    expect((same.json() as { error: string }).error).toBe('SAME_TEAM');
  });

  it('changer d’équipe sans être inscrit ou sans équipe : refusé', async () => {
    const stranger = await changeTo(reda, 'A');
    expect(stranger.statusCode).toBe(400);
    expect((stranger.json() as { error: string }).error).toBe('NOT_JOINED');
    const none = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/team`, headers: bearer(karim), payload: {} });
    expect(none.statusCode).toBe(400);
  });
});

describe('Mes matchs — MON équipe dans les listes', () => {
  it('GET /me/matches sert viewerTeam (mon équipe, jamais celle d’un autre)', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(karim) });
    const mine = (res.json() as { matches: { id: string; viewerTeam: 'A' | 'B' | null; viewerJoined: boolean }[] }).matches.find((m) => m.id === matchId);
    expect(mine).toMatchObject({ viewerJoined: true, viewerTeam: 'A' });       // karim est passé dans l'équipe A plus haut
    const feed = await stack.app.inject({ method: 'GET', url: '/matches', headers: bearer(reda) });
    const seenByReda = (feed.json() as { matches: { id: string; viewerTeam: 'A' | 'B' | null }[] }).matches.find((m) => m.id === matchId);
    expect(seenByReda?.viewerTeam ?? null).toBeNull();                          // reda n'est pas inscrit
  });
});
