import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker, SEED_SUBSCRIPTION_WEEKDAY } from './helpers/dates.js';

/* Lot 7 (LienMatch.dc.html, migration 0036) — le code court d'un match et son lien « app.moubarat.app/m/CODE » : généré par la base, servi à tous pour un match ouvert, secret pour un
   match sur invitation (règle 6 : « accessible que par son lien »), et la fiche publique d'un match À PARTIR DE SON CODE — sans compte, sans un nom d'inscrit. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
let openId = '', openCode = '', privateId = '', privateCode = '';
/* Indépendant du jour (30/10/2026) : tous les matchs sont posés sur T1 à 20:00, or le seed y place l'abonnement du mardi (FC Kahwa 20:00-21:30) — le test échouait quand le
   calendrier tombait un mardi (SLOT_TAKEN). On évite aussi ce jour-là, comme les autres tests qui occupent T1 en soirée. */
const nextDay = makeSafeDayPicker([SEED_SUBSCRIPTION_WEEKDAY.T1]);

async function makeMatch(token: string, dayOffset: number, startMin: number, visibility: 'OPEN' | 'PRIVATE', fieldId: string) {
  const booked = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(token),
    payload: { fieldId, durationMin: 60, date: nextDay(dayOffset), startMin, format: '5v5' },
  });
  expect(booked.statusCode, booked.body).toBe(201);
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(token),
    payload: { bookingId: (booked.json() as { booking: { id: string } }).booking.id, title: 'Green Arena Sport', visibility },
  });
  expect(created.statusCode, created.body).toBe(201);
  return (created.json() as { match: { id: string; code: string | null } }).match;
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
  const open = await makeMatch(sofiane, 3, 1200, 'OPEN', seed.fields.t1);
  openId = open.id; openCode = open.code ?? '';
  const priv = await makeMatch(sofiane, 4, 1200, 'PRIVATE', seed.fields.t1);
  privateId = priv.id; privateCode = priv.code ?? '';
});
afterAll(async () => { await stack.teardown(); });

const byCode = (code: string, token?: string) =>
  stack.app.inject({ method: 'GET', url: `/matches/by-code/${code}`, ...(token ? { headers: bearer(token) } : {}) });

describe('le code du match', () => {
  it('chaque match a un code court unique (6 signes, sans I O 0 1), servi à l’organisateur à la création', () => {
    expect(openCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(privateCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(openCode).not.toBe(privateCode);
  });

  it('match ouvert : le code est public (il se partage) ; match sur invitation : jamais dans une liste ni pour un tiers', async () => {
    const feed = await stack.app.inject({ method: 'GET', url: '/matches', headers: bearer(walid) });
    const matches = (feed.json() as { matches: { id: string; code: string | null }[] }).matches;
    expect(matches.find((m) => m.id === openId)?.code).toBe(openCode);
    expect(matches.some((m) => m.id === privateId)).toBe(false);             // hors fil
    expect(JSON.stringify(feed.json())).not.toContain(privateCode);
    const outsider = await stack.app.inject({ method: 'GET', url: `/matches/${privateId}`, headers: bearer(walid) });
    expect(outsider.statusCode).toBe(403);                                   // l'identifiant ne suffit pas
    const mine = await stack.app.inject({ method: 'GET', url: `/matches/${privateId}`, headers: bearer(sofiane) });
    expect((mine.json() as { match: { code: string } }).match.code).toBe(privateCode);
  });
});

describe('GET /matches/by-code/:code — la fiche publique d’un match', () => {
  it('sans compte : la fiche, le prénom de l’organisateur, aucun nom d’inscrit', async () => {
    const res = await byCode(openCode);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { match: { id: string; joinedCount: number; players: unknown[]; rosterHidden: boolean; code: string }; organizerName: string | null; venueName: string | null; fieldName: string | null };
    expect(body.match.id).toBe(openId);
    expect(body.match.joinedCount).toBe(1);
    expect(body.match.players).toEqual([]);
    expect(body.match.rosterHidden).toBe(true);
    expect(body.organizerName).toBeTruthy();
    expect(body.venueName).toBe('Complexe Ryad');
    expect(body.fieldName).toBe('T1');
    expect(JSON.stringify(body)).not.toMatch(/\+213/);                       // aucun numéro
  });

  it('minuscules acceptées ; code inconnu ou mal formé → 404', async () => {
    expect((await byCode(openCode.toLowerCase())).statusCode).toBe(200);
    expect((await byCode('ZZZZZZ')).statusCode).toBe(404);
    expect((await byCode('ab')).statusCode).toBe(404);
    expect((await byCode('A!B@C#')).statusCode).toBe(404);
  });

  it('match sur invitation : le lien ouvre la fiche et on peut s’inscrire (règle 6) ; sans le lien, non', async () => {
    const res = await byCode(privateCode, karim);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { match: { id: string } }).match.id).toBe(privateId);
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${privateId}/join`, headers: bearer(karim), payload: {} });
    expect(join.statusCode, join.body).toBe(200);
    // une fois inscrit, il lit aussi la fiche par identifiant
    expect((await stack.app.inject({ method: 'GET', url: `/matches/${privateId}`, headers: bearer(karim) })).statusCode).toBe(200);
  });

  it('connecté : le roster nominatif, comme GET /matches/:id', async () => {
    const res = await byCode(openCode, sofiane);
    const body = res.json() as { match: { players: { userId: string; team: string | null }[] } };
    expect(body.match.players).toHaveLength(1);
    expect(body.match.players[0]!.team).toBe('A');
  });
});
