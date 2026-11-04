import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';

/* Refonte app joueur, lot "Fondations" (règle 34, décidée par Aymen le 22/10/2026) : ville,
   sexe, sports et niveau du joueur — GET /auth/me (lecture) et PATCH /me/profile (écriture).
   `profiles` n'avait jusqu'ici AUCUNE ligne pour un compte créé par l'API (confirmé en phase 0
   de l'état des lieux) : ces tests couvrent donc aussi bien la toute première écriture
   (upsert) que les suivantes. */

let stack: TestStack;

beforeAll(async () => { stack = await setupTestStack(); });
afterAll(async () => { await stack.teardown(); });

describe('GET /auth/me — profil "jeu"', () => {
  it('un compte qui n’a jamais rien écrit renvoie un profil vide, jamais une 404/500', async () => {
    const token = await loginAs(stack, '+213551100001', 'Jamais Écrit');
    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { profile: { city: string | null; gender: string | null; sports: string[]; level: string | null } };
    expect(body.profile).toEqual({ city: null, gender: null, sports: [], level: null });
  });
});

describe('PATCH /me/profile', () => {
  it('première écriture (upsert) : pose ville/sexe/sports/niveau, relus ensuite par GET /auth/me', async () => {
    const token = await loginAs(stack, '+213551100002', 'Première Écriture');
    const patch = await stack.app.inject({
      method: 'PATCH', url: '/me/profile', headers: bearer(token),
      payload: { city: 'ALGER', gender: 'HOMME', sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE' },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json()).toEqual({ profile: { city: 'ALGER', gender: 'HOMME', sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE' } });

    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((me.json() as { profile: unknown }).profile).toEqual({ city: 'ALGER', gender: 'HOMME', sports: ['FOOTBALL', 'PADEL'], level: 'INTERMEDIAIRE' });
  });

  it('un PATCH partiel (un seul champ) ne touche jamais les autres déjà posés', async () => {
    const token = await loginAs(stack, '+213551100003', 'Partiel');
    await stack.app.inject({
      method: 'PATCH', url: '/me/profile', headers: bearer(token),
      payload: { city: 'ORAN', gender: 'FEMME', sports: ['PADEL'], level: 'LOISIR' },
    });
    const onlyCity = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { city: 'BLIDA' } });
    expect(onlyCity.statusCode).toBe(200);
    expect(onlyCity.json()).toEqual({ profile: { city: 'BLIDA', gender: 'FEMME', sports: ['PADEL'], level: 'LOISIR' } });
  });

  it('sports : les doublons envoyés par le client sont dédupliqués', async () => {
    const token = await loginAs(stack, '+213551100004', 'Doublons');
    const res = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { sports: ['FOOTBALL', 'FOOTBALL', 'BASKET'] } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { profile: { sports: string[] } }).profile.sports.sort()).toEqual(['BASKET', 'FOOTBALL']);
  });

  it('refuse (400) une ville, un sexe, un niveau ou un sport hors liste — jamais écrit', async () => {
    const token = await loginAs(stack, '+213551100005', 'Valeurs Invalides');
    const badCity = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { city: 'PARIS' } });
    expect(badCity.statusCode).toBe(400);
    expect((badCity.json() as { error: string }).error).toBe('INVALID_CITY');

    const badGender = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { gender: 'AUTRE' } });
    expect(badGender.statusCode).toBe(400);
    expect((badGender.json() as { error: string }).error).toBe('INVALID_GENDER');

    const badLevel = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { level: 'PRO' } });
    expect(badLevel.statusCode).toBe(400);
    expect((badLevel.json() as { error: string }).error).toBe('INVALID_LEVEL');

    const badSport = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { sports: ['TENNIS'] } });
    expect(badSport.statusCode).toBe(400);
    expect((badSport.json() as { error: string }).error).toBe('INVALID_SPORTS');

    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((me.json() as { profile: unknown }).profile).toEqual({ city: null, gender: null, sports: [], level: null });
  });

  it('un champ explicitement à null efface sa valeur (distinct d’un champ omis)', async () => {
    const token = await loginAs(stack, '+213551100006', 'Effacement');
    await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { city: 'SETIF' } });
    const cleared = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(token), payload: { city: null } });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { profile: { city: string | null } }).profile.city).toBeNull();
  });

  it('sans authentification : 401, jamais une écriture anonyme', async () => {
    const res = await stack.app.inject({ method: 'PATCH', url: '/me/profile', payload: { city: 'ALGER' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /me — le profil "jeu" est anonymisé comme le reste', () => {
  it('ville/sexe/sports/niveau effacés par la suppression de compte', async () => {
    const token = await loginAs(stack, '+213551100007', 'À Supprimer Avec Profil');
    await stack.app.inject({
      method: 'PATCH', url: '/me/profile', headers: bearer(token),
      payload: { city: 'CONSTANTINE', gender: 'HOMME', sports: ['BASKET'], level: 'COMPETITION' },
    });
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json() as { user: { id: string } };

    const del = await stack.app.inject({ method: 'DELETE', url: '/me', headers: bearer(token) });
    expect(del.statusCode).toBe(204);

    const row = await stack.db.selectFrom('profiles').selectAll().where('user_id', '=', me.user.id).executeTakeFirstOrThrow();
    expect(row.city).toBeNull();
    expect(row.gender).toBeNull();
    expect(row.level).toBeNull();
    expect(row.sports).toEqual([]);
  });
});
