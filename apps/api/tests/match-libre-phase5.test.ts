import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Lot « Match libre », phase 5 (GO d'Aymen du 16/11/2026), vrai Postgres — migration 0047 :
   - POST /matches/free crée un match sans centre, sans terrain, sans prix, sans réservation ;
   - une app qui n'envoie pas `X-Moubarat-Features: match-libre` (iPhone 1.0 et 1.0.1, Android 1.0.4, web en cache) ne reçoit
     JAMAIS de match libre : absent du fil, des décomptes, de Mes matchs, des matchs des amis ; sa fiche répond 409 ;
   - la base refuse un match à moitié libre (contrainte matches_place_kind). */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
const H = 3_600_000;
const NEW_APP = { 'x-moubarat-features': 'match-libre' };

/** Une heure de début sur la grille d'une demi-heure, `hours` heures plus tard. */
const slot = (hours: number) => Math.ceil((Date.now() + hours * H) / 1_800_000) * 1_800_000;
const create = (token: string, body: Record<string, unknown>) =>
  stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(token), ...NEW_APP }, payload: body });
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;
const valid = (over: Record<string, unknown> = {}) => ({
  place: { name: 'Terrain de Bab Ezzouar', wilaya: 'Alger' }, format: '5v5', level: 'LOISIR', start: slot(500), durationMin: 90, ...over,
});
const feedIds = async (headers: Record<string, string> = {}, qs = ''): Promise<string[]> => {
  const res = await stack.app.inject({ method: 'GET', url: `/matches?limit=100${qs}`, headers });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { matches: { id: string }[] }).matches.map((m) => m.id);
};

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
});
afterAll(async () => { await stack.teardown(); });

describe('POST /matches/free — créer un match libre', () => {
  it('crée le match : lieu saisi, ni centre ni terrain ni prix ni réservation, organisateur inscrit en équipe A', async () => {
    const res = await create(sofiane, valid({ place: { name: '  Stade   Ben Aknoun ', wilaya: 'Alger' }, note: 'Ramenez une chasuble.' }));
    expect(res.statusCode, res.body).toBe(201);
    const m = (res.json() as { match: Record<string, unknown> }).match;
    expect(m).toMatchObject({ venueId: null, fieldId: null, pricePerPlayerDa: 0, capacity: 10, visibility: 'OPEN', status: 'OPEN', title: 'Stade Ben Aknoun', note: 'Ramenez une chasuble.' });
    expect(m.place).toEqual({ name: 'Stade Ben Aknoun', wilaya: 'Alger' });
    expect(typeof m.code).toBe('string');
    const row = await stack.db.selectFrom('matches').selectAll().where('id', '=', m.id as string).executeTakeFirstOrThrow();
    expect(row.booking_id).toBeNull();
    const players = await stack.db.selectFrom('match_players').selectAll().where('match_id', '=', row.id).execute();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ user_id: seed.users.sofiane, status: 'JOINED', team: 'A' });
  });

  it('refuse : lieu vide, durée hors liste, heure hors grille, à moins de 2 h, format d’un autre sport', async () => {
    expect(errorOf(await create(sofiane, valid({ place: { name: ' ', wilaya: 'Alger' } })))).toBe('PLACE_INVALID');
    expect(errorOf(await create(sofiane, valid({ durationMin: 45 })))).toBe('DURATION_INVALID');
    expect(errorOf(await create(sofiane, valid({ start: slot(500) + 600_000 })))).toBe('SLOT_INVALID');
    expect(errorOf(await create(sofiane, valid({ start: slot(1) })))).toBe('MATCH_LOCKED');
    expect(errorOf(await create(sofiane, valid({ format: 'DOUBLE' })))).toBe('FORMAT_SPORT_MISMATCH');
  });

  it('refuse un créneau qui chevauche un autre engagement de l’organisateur (409 SCHEDULE_CONFLICT, avec le lieu)', async () => {
    const start = slot(520);
    expect((await create(walid, valid({ start, place: { name: 'Terrain du quartier', wilaya: 'Alger' } }))).statusCode).toBe(201);
    const clash = await create(walid, valid({ start: start + 1_800_000 }));
    expect(clash.statusCode, clash.body).toBe(409);
    expect(clash.json()).toMatchObject({ error: 'SCHEDULE_CONFLICT', details: { venueName: 'Terrain du quartier' } });
  });

  it('privé à la demande : hors du fil', async () => {
    const res = await create(sofiane, valid({ start: slot(540), visibility: 'PRIVATE' }));
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { match: { id: string } }).match.id;
    expect(await feedIds(NEW_APP)).not.toContain(id);
  });
});

describe('ancienne app (sans l’en-tête) — jamais un match libre', () => {
  it('fil, décomptes, fiche, lien, Mes matchs : la nouvelle app le voit, l’ancienne non', async () => {
    const start = slot(560);
    const created = await create(sofiane, valid({ start }));
    const { id, code } = (created.json() as { match: { id: string; code: string } }).match;

    expect(await feedIds(NEW_APP)).toContain(id);
    expect(await feedIds()).not.toContain(id);

    // Ville : le filtre « Alger » le garde, « Oran » non.
    expect(await feedIds(NEW_APP, '&city=ALGER')).toContain(id);
    expect(await feedIds(NEW_APP, '&city=ORAN')).not.toContain(id);
    // Un filtre par centre ne montre jamais un match libre.
    expect(await feedIds(NEW_APP, `&venueId=${seed.venueId}`)).not.toContain(id);

    // Fiche et lien : 409 APP_UPDATE_REQUIRED pour une ancienne app, la fiche complète pour la nouvelle.
    const oldDetail = await stack.app.inject({ method: 'GET', url: `/matches/${id}`, headers: bearer(karim) });
    expect(oldDetail.statusCode, oldDetail.body).toBe(409);
    expect(errorOf(oldDetail)).toBe('APP_UPDATE_REQUIRED');
    const oldLink = await stack.app.inject({ method: 'GET', url: `/matches/by-code/${code}` });
    expect(oldLink.statusCode).toBe(409);
    const detail = await stack.app.inject({ method: 'GET', url: `/matches/${id}`, headers: { ...bearer(karim), ...NEW_APP } });
    expect(detail.statusCode, detail.body).toBe(200);
    expect((detail.json() as { match: { place: unknown } }).match.place).toEqual({ name: 'Terrain de Bab Ezzouar', wilaya: 'Alger' });
    const link = await stack.app.inject({ method: 'GET', url: `/matches/by-code/${code}`, headers: NEW_APP });
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json()).toMatchObject({ venueName: null, fieldName: null, match: { place: { name: 'Terrain de Bab Ezzouar' } } });

    // Mes matchs de l'organisateur.
    const mine = async (headers: Record<string, string>) => ((await stack.app.inject({ method: 'GET', url: '/me/matches', headers: { ...bearer(sofiane), ...headers } }))
      .json() as { matches: { id: string }[] }).matches.map((m) => m.id);
    expect(await mine(NEW_APP)).toContain(id);
    expect(await mine({})).not.toContain(id);

    // Décomptes par jour : la nouvelle app compte un match de plus que l'ancienne, le jour du match.
    const day = new Date(start + 3_600_000).toISOString().slice(0, 10);
    const count = async (headers: Record<string, string>) => ((await stack.app.inject({ method: 'GET', url: `/matches/day-counts?from=${day}&days=1`, headers }))
      .json() as { counts: Record<string, number> }).counts[day] ?? 0;
    expect(await count(NEW_APP)).toBe((await count({})) + 1);
  });
});

describe('un match libre se vit comme un match de centre', () => {
  it('un joueur le rejoint, l’organisateur l’annule : les inscrits sont prévenus, aucune réservation n’est touchée', async () => {
    const res = await create(sofiane, valid({ start: slot(580) }));
    const id = (res.json() as { match: { id: string } }).match.id;
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${id}/join`, headers: { ...bearer(karim), ...NEW_APP }, payload: {} });
    expect(join.statusCode, join.body).toBe(200);
    const team = await stack.db.selectFrom('match_players').select('team').where('match_id', '=', id).where('user_id', '=', seed.users.karim).executeTakeFirstOrThrow();
    expect(team.team).toBe('B');   // l'équipe la moins remplie

    const cancel = await stack.app.inject({ method: 'POST', url: `/matches/${id}/cancel`, headers: { ...bearer(sofiane), ...NEW_APP }, payload: {} });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(cancel.json()).toMatchObject({ ok: true, status: 'CANCELLED', bookingCancelled: false });
    const notif = await stack.db.selectFrom('notifications').select('type').where('user_id', '=', seed.users.karim).where('ref_id', '=', id).execute();
    expect(notif.map((n) => n.type)).toContain('MATCH_CANCELLED');
  });
});

describe('la base — contrainte matches_place_kind', () => {
  const base = () => {
    const start = slot(600);
    return {
      sport: 'FOOTBALL' as const, format: '5v5' as const, level: 'LOISIR' as const, title: 'Contrainte',
      time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 0, organizer_id: seed.users.sofiane,
    };
  };
  it('refuse un match sans centre ET sans lieu, un match avec centre ET lieu, et un match libre avec un prix', async () => {
    await expect(stack.db.insertInto('matches').values({ ...base(), venue_id: null, field_id: null }).execute()).rejects.toThrow(/matches_place_kind/);
    await expect(stack.db.insertInto('matches').values({ ...base(), venue_id: seed.venueId, field_id: seed.fields.t1, place_name: 'Stade', place_wilaya: 'Alger' }).execute())
      .rejects.toThrow(/matches_place_kind/);
    await expect(stack.db.insertInto('matches').values({ ...base(), venue_id: null, field_id: null, place_name: 'Stade', place_wilaya: 'Alger', price_per_player_da: 300 }).execute())
      .rejects.toThrow(/matches_place_kind/);
  });
});
