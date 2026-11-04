import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Home « Tes amis jouent bientôt » (règle 40, refonte-app-joueur/docs/regles.md, GO d'Aymen
   25/10/2026) — GET /me/friends-matches. Aucun système d'amis : les coéquipiers sont dérivés
   des matchs déjà JOUÉS ensemble, comptés par nombre de matchs partagés. Vrai Postgres 16
   éphémère, comme le reste de la suite. */

let stack: TestStack;
let seed: SeedResult;
let amine = '';
const DAY = 86_400_000;

async function insertMatch(o: {
  title: string; start: number; status: 'OPEN' | 'FULL' | 'LOCKED' | 'PLAYED' | 'CANCELLED';
  visibility?: 'OPEN' | 'PRIVATE'; organizerId: string; joined?: string[];
}): Promise<string> {
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: o.title, venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start: o.start, end: o.start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
    visibility: o.visibility ?? 'OPEN', status: o.status, organizer_id: o.organizerId,
  }).returning('id').executeTakeFirstOrThrow();
  if (o.joined?.length) {
    await stack.db.insertInto('match_players').values(
      o.joined.map((user_id) => ({ match_id: row.id, user_id, status: 'JOINED' as const })),
    ).execute();
  }
  return row.id;
}

interface FriendsBody {
  matches: { id: string; title: string; start: number; joinedCount: number; viewerJoined: boolean; friends: { userId: string; name: string }[] }[];
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);

  // Historique joué : amine a joué 2 fois avec sofiane/karim, 1 fois avec walid.
  await insertMatch({ title: 'Joué 1', start: Date.now() - 10 * DAY, status: 'PLAYED', organizerId: seed.users.sofiane, joined: [seed.users.amine, seed.users.karim] });
  await insertMatch({ title: 'Joué 2', start: Date.now() - 5 * DAY, status: 'PLAYED', organizerId: seed.users.karim, joined: [seed.users.amine, seed.users.sofiane] });
  await insertMatch({ title: 'Joué 3', start: Date.now() - 2 * DAY, status: 'PLAYED', organizerId: seed.users.walid, joined: [seed.users.amine] });
  amine = await loginAs(stack, seed.phones.amine);
});
afterAll(() => stack.teardown());

describe('GET /me/friends-matches', () => {
  it('aucun historique joué : liste vide, jamais une erreur', async () => {
    const token = await loginAs(stack, seed.phones.fouad);
    const res = await stack.app.inject({ method: 'GET', url: '/me/friends-matches', headers: bearer(token) });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as FriendsBody).matches).toEqual([]);
  });

  it('exclut les matchs à venir d’un joueur jamais croisé, PRIVÉ, annulé, ou hors fenêtre 7 jours', async () => {
    await insertMatch({ title: 'Jamais croisé', start: Date.now() + 2 * DAY, status: 'OPEN', organizerId: seed.users.fouad });
    await insertMatch({ title: 'Privé de karim', start: Date.now() + 2 * DAY, status: 'OPEN', visibility: 'PRIVATE', organizerId: seed.users.karim });
    await insertMatch({ title: 'Annulé de karim', start: Date.now() + 2 * DAY, status: 'CANCELLED', organizerId: seed.users.karim });
    await insertMatch({ title: 'Trop loin de walid', start: Date.now() + 10 * DAY, status: 'OPEN', organizerId: seed.users.walid });

    const res = await stack.app.inject({ method: 'GET', url: '/me/friends-matches', headers: bearer(amine) });
    expect(res.statusCode, res.body).toBe(200);
    const titles = ['Jamais croisé', 'Privé de karim', 'Annulé de karim', 'Trop loin de walid'];
    expect((res.json() as FriendsBody).matches.map((m) => m.title).filter((t) => titles.includes(t))).toEqual([]);
  });

  it('inclut un match organisé par un coéquipier et un match où il est seulement inscrit, triés par horaire', async () => {
    const reda = seed.users.reda; // n'a jamais joué avec amine : organisateur « neutre »
    await insertMatch({ title: 'Karim organise', start: Date.now() + 3 * DAY, status: 'OPEN', organizerId: seed.users.karim });
    await insertMatch({ title: 'Sofiane rejoint', start: Date.now() + 1 * DAY, status: 'OPEN', organizerId: reda, joined: [seed.users.sofiane] });

    const res = await stack.app.inject({ method: 'GET', url: '/me/friends-matches', headers: bearer(amine) });
    expect(res.statusCode, res.body).toBe(200);
    const matches = (res.json() as FriendsBody).matches.filter((m) => ['Karim organise', 'Sofiane rejoint'].includes(m.title));
    expect(matches.map((m) => m.title)).toEqual(['Sofiane rejoint', 'Karim organise']); // le plus proche d'abord
    expect(matches.find((m) => m.title === 'Sofiane rejoint')?.friends.map((f) => f.userId)).toEqual([seed.users.sofiane]);
    expect(matches.find((m) => m.title === 'Karim organise')?.friends.map((f) => f.userId)).toEqual([seed.users.karim]);
  });

  it('un match où amine est déjà inscrit : viewerJoined vrai, et ses coéquipiers y figurent aussi', async () => {
    const id = await insertMatch({
      title: 'Déjà inscrit', start: Date.now() + 4 * DAY, status: 'OPEN', organizerId: seed.users.reda,
      joined: [seed.users.amine, seed.users.sofiane],
    });
    const res = await stack.app.inject({ method: 'GET', url: '/me/friends-matches', headers: bearer(amine) });
    const m = (res.json() as FriendsBody).matches.find((x) => x.id === id);
    expect(m?.viewerJoined).toBe(true);
    expect(m?.joinedCount).toBe(2);
    expect(m?.friends.map((f) => f.userId)).toEqual([seed.users.sofiane]);
  });

  it('sans jeton : 401, comme toute route /me/*', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/me/friends-matches' });
    expect(res.statusCode).toBe(401);
  });
});
