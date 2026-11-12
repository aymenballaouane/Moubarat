import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { PASSWORD_MAX_ATTEMPTS } from '@moubarat/core';

/* Auth/session plateforme — login/logout/me, verrouillage anti-bruteforce,
   distinction SUPERADMIN/compte ordinaire, et (CRM Auth V1) les rattachements
   centre renvoyés par /me. */

describe('SUPERADMIN V1 — authentification plateforme', () => {
  let stack: TestStack;
  let superadminId: string;

  beforeAll(async () => {
    stack = await setupTestStack();
    superadminId = await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'Aymen (SUPERADMIN)', isSuperadmin: true,
    });
    await createPlatformAccount(stack.db, {
      email: 'hamid@moubarat.test', password: 'HamidPassword9!', name: 'Hamid (compte plateforme ordinaire)',
    });
  });
  afterAll(() => stack.teardown());

  it('connexion réussie : jeton émis, /me confirme is_superadmin', async () => {
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!' },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as { token: string; account: { id: string; isSuperadmin: boolean } };
    expect(body.account.id).toBe(superadminId);
    expect(body.account.isSuperadmin).toBe(true);

    const me = await stack.app.inject({
      method: 'GET', url: '/platform/auth/me', headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { account: { isSuperadmin: boolean } }).account.isSuperadmin).toBe(true);
  });

  it('compte plateforme non-superadmin : connexion OK, isSuperadmin=false', async () => {
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'hamid@moubarat.test', password: 'HamidPassword9!' },
    });
    expect(login.statusCode).toBe(200);
    expect((login.json() as { account: { isSuperadmin: boolean } }).account.isSuperadmin).toBe(false);
  });

  it('CRM Auth V1 : /me renvoie les rattachements centre (vide pour un pur SUPERADMIN)', async () => {
    const superLogin = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!' },
    });
    const superToken = (superLogin.json() as { token: string }).token;
    // La réponse de /login elle-même, pas seulement /me — c'est celle-là que
    // LoginScreen lit directement (bug réel trouvé en vérifiant dans le
    // navigateur : centerMemberships absent de /login, présent sur /me
    // seulement, plantage silencieux côté écran de connexion).
    expect((superLogin.json() as { centerMemberships: unknown[] }).centerMemberships).toEqual([]);
    const superMe = await stack.app.inject({
      method: 'GET', url: '/platform/auth/me', headers: { authorization: `Bearer ${superToken}` },
    });
    expect((superMe.json() as { centerMemberships: unknown[] }).centerMemberships).toEqual([]);

    const hamidId = await createPlatformAccount(stack.db, {
      email: 'hamid-membership@moubarat.test', password: 'HamidPassword9!', name: 'Hamid',
    });
    const venue = await stack.db.insertInto('venues').values({
      name: 'Centre Test Membership', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning(['id', 'name']).executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values({ venue_id: venue.id, user_id: hamidId, role: 'OWNER' }).execute();

    const hamidLogin = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'hamid-membership@moubarat.test', password: 'HamidPassword9!' },
    });
    const hamidToken = (hamidLogin.json() as { token: string }).token;
    expect((hamidLogin.json() as { centerMemberships: unknown[] }).centerMemberships).toEqual([
      // subscriptionStatus/subscriptionDueAt (22/09/2026, C1/CE11) : défauts PAID/null, voir venue-subscription.test.ts.
      { venueId: venue.id, venueName: venue.name, role: 'OWNER', subscriptionStatus: 'PAID', subscriptionDueAt: null },
    ]);
    const hamidMe = await stack.app.inject({
      method: 'GET', url: '/platform/auth/me', headers: { authorization: `Bearer ${hamidToken}` },
    });
    const memberships = (hamidMe.json() as {
      centerMemberships: { venueId: string; venueName: string; role: string }[];
    }).centerMemberships;
    expect(memberships).toEqual([{ venueId: venue.id, venueName: venue.name, role: 'OWNER', subscriptionStatus: 'PAID', subscriptionDueAt: null }]);
  });

  it('mauvais mot de passe : message générique, jamais "compte introuvable"', async () => {
    const wrongPassword = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'admin@moubarat.test', password: 'nope' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });

    const unknownEmail = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'ne-existe-pas@moubarat.test', password: 'peu-importe' },
    });
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });
  });

  /* Audit final, MS-005 (12/11/2026) : avant, 5 échecs verrouillaient le COMPTE 15 minutes pour tout le monde, et la
     réponse LOGIN_LOCKED prouvait que l'email existait. Désormais : ralentissement de l'adresse qui s'acharne. */
  it('ralentit l’adresse qui s’acharne, sans verrouiller le compte ni révéler qu’il existe', async () => {
    const email = 'lockout@moubarat.test';
    await createPlatformAccount(stack.db, { email, password: 'RealPassword9!', name: 'Test verrouillage' });
    const attempt = (who: string, password: string, from: string) => stack.app.inject({
      method: 'POST', url: '/platform/auth/login', remoteAddress: from, payload: { email: who, password },
    });
    const trace = async (who: string, from: string) => {
      const out: string[] = [];
      for (let i = 0; i < PASSWORD_MAX_ATTEMPTS + 1; i++) {
        const r = await attempt(who, 'faux', from);
        out.push(`${r.statusCode} ${(r.json() as { error: string }).error}`);
      }
      return out;
    };
    const real = await trace(email, '10.8.0.1');
    const unknown = await trace('personne@moubarat.test', '10.8.0.1');
    expect(real.slice(0, 3)).toEqual(Array(3).fill('401 INVALID_CREDENTIALS'));
    expect(real.slice(3)).toEqual(Array(real.length - 3).fill('429 LOGIN_SLOWDOWN'));
    expect(unknown).toEqual(real); // aucun oracle : un email inconnu se comporte exactement pareil
    // Même le bon mot de passe attend, depuis CETTE adresse…
    expect((await attempt(email, 'RealPassword9!', '10.8.0.1')).statusCode).toBe(429);
    // … mais le titulaire, depuis la sienne, entre normalement.
    const owner = await attempt(email, 'RealPassword9!', '10.8.0.2');
    expect(owner.statusCode, owner.body).toBe(200);
  });

  it('logout révoque la session : /me échoue ensuite', async () => {
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login',
      payload: { email: 'hamid@moubarat.test', password: 'HamidPassword9!' },
    });
    const token = (login.json() as { token: string }).token;
    const auth = { authorization: `Bearer ${token}` };

    const before = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: auth });
    expect(before.statusCode).toBe(200);

    const logout = await stack.app.inject({ method: 'POST', url: '/platform/auth/logout', headers: auth });
    expect(logout.statusCode).toBe(200);

    const after = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: auth });
    expect(after.statusCode).toBe(401);
  });

  it('sans jeton : 401', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/auth/me' });
    expect(r.statusCode).toBe(401);
  });

  it('compte suspendu : connexion refusée même avec le bon mot de passe', async () => {
    const email = 'suspendu@moubarat.test';
    await createPlatformAccount(stack.db, { email, password: 'SuspendedPass9!', name: 'Compte suspendu' });
    await stack.db.updateTable('platform_accounts').set({ status: 'SUSPENDED' }).where('email', '=', email).execute();

    const r = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email, password: 'SuspendedPass9!' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'ACCOUNT_SUSPENDED' });
  });
});
