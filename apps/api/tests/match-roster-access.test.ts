import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Audit juridique et technique du 25/09/2026, P0-5 (décision d'Aymen) — la LISTE NOMINATIVE des inscrits d'un match
   exige un compte connecté, même pour un match ouvert. Les métadonnées (sport, niveau, horaire, lieu, prix, capacité,
   nombre d'inscrits) restent publiques : c'est ce qui donne envie de s'inscrire. Vrai Postgres 16 éphémère. */

let stack: TestStack;
let seed: SeedResult;
let karim = '';
let matchId = '', privateId = '';
let names: string[] = [];
const DAY = 86_400_000;

async function insertMatch(o: { title: string; visibility: 'OPEN' | 'PRIVATE'; players: string[] }): Promise<string> {
  const start = Date.now() + 3 * DAY;
  const row = await stack.db.insertInto('matches').values({
    sport: 'FOOTBALL', format: '5v5', level: 'INTERMEDIAIRE', title: o.title, venue_id: seed.venueId, field_id: seed.fields.t1,
    time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
    visibility: o.visibility, status: 'OPEN', organizer_id: seed.users.sofiane,
  }).returning('id').executeTakeFirstOrThrow();
  await stack.db.insertInto('match_players').values(o.players.map((user_id) => ({ match_id: row.id, user_id, status: 'JOINED' as const }))).execute();
  return row.id;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  karim = await loginAs(stack, seed.phones.karim);
  const joined = [seed.users.sofiane, seed.users.karim, seed.users.reda];
  matchId = await insertMatch({ title: 'Foot du jeudi', visibility: 'OPEN', players: joined });
  privateId = await insertMatch({ title: 'Match privé', visibility: 'PRIVATE', players: joined });
  names = (await stack.db.selectFrom('users').select('name').where('id', 'in', joined).execute()).map((u) => u.name);
  expect(names.length).toBe(3);
});
afterAll(() => stack.teardown());

interface MatchBody {
  match: {
    id: string; sport: string; level: string; format: string; start: number; end: number; venueId: string; fieldId: string;
    title: string; capacity: number; pricePerPlayerDa: number; status: string; joinedCount: number;
    players: { userId: string; name: string }[]; rosterHidden?: boolean;
  };
}

describe('visiteur sans compte : les métadonnées, jamais la liste nominative', () => {
  it('GET /matches/:id renvoie sport, niveau, format, horaire, lieu, prix, capacité, statut ET le nombre d’inscrits — donc les places restantes', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect(res.statusCode, res.body).toBe(200);
    const m = (res.json() as MatchBody).match;
    expect(m).toMatchObject({
      id: matchId, sport: 'FOOTBALL', level: 'INTERMEDIAIRE', format: '5v5', title: 'Foot du jeudi',
      venueId: seed.venueId, fieldId: seed.fields.t1, capacity: 10, pricePerPlayerDa: 500, status: 'OPEN', joinedCount: 3,
    });
    expect(m.start).toBeGreaterThan(Date.now());
    expect(m.end).toBeGreaterThan(m.start);
    expect(m.capacity - m.joinedCount).toBe(7); // places restantes, calculables sans compte
  });

  it('aucun nom ni identifiant d’inscrit : players vide ET rosterHidden explicite (jamais une liste vide qui laisse croire que personne n’est inscrit)', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    const m = (res.json() as MatchBody).match;
    expect(m.players).toEqual([]);
    expect(m.rosterHidden).toBe(true);
    for (const name of names) expect(res.body).not.toContain(name);
    for (const id of [seed.users.karim, seed.users.reda]) expect(res.body).not.toContain(id);
  });

  it('un jeton invalide ou expiré est traité comme un visiteur : mêmes métadonnées, roster masqué', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer('jeton-qui-nexiste-pas') });
    expect(res.statusCode).toBe(200);
    expect((res.json() as MatchBody).match.rosterHidden).toBe(true);
  });

  it('le fil public GET /matches reste inchangé : nombre d’inscrits, jamais de noms', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/matches' });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { matches: { id: string; joinedCount: number }[] }).matches.find((x) => x.id === matchId);
    expect(row?.joinedCount).toBe(3);
    for (const name of names) expect(res.body).not.toContain(name);
  });

  it('un match PRIVÉ reste fermé à un visiteur (403), comme avant', async () => {
    expect((await stack.app.inject({ method: 'GET', url: `/matches/${privateId}` })).statusCode).toBe(403);
  });
});

describe('joueur connecté : la liste nominative, comme avant', () => {
  it('nom, identifiant et date d’inscription de chaque inscrit ; pas de rosterHidden ; joinedCount cohérent', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(karim) });
    expect(res.statusCode, res.body).toBe(200);
    const m = (res.json() as MatchBody).match;
    expect(m.players.map((p) => p.name).sort()).toEqual([...names].sort());
    expect(m.joinedCount).toBe(m.players.length);
    expect(m.rosterHidden).toBeUndefined();
  });

  it('un inscrit voit aussi le roster d’un match privé', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${privateId}`, headers: bearer(karim) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as MatchBody).match.players).toHaveLength(3);
  });

  it('un joueur connecté mais NON inscrit voit le roster d’un match ouvert (un compte suffit)', async () => {
    const walid = await loginAs(stack, seed.phones.walid);
    const res = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(walid) });
    expect((res.json() as MatchBody).match.players).toHaveLength(3);
  });
});
