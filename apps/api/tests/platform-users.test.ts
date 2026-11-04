import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* SUPERADMIN V1, étape 5 — supervision utilisateurs. Deux espaces d'identité
   (users = joueurs, platform_accounts = comptes plateforme), combinés en
   lecture, jamais confondus en écriture (deux jeux de routes distincts). */

async function platformLogin(stack: TestStack, email: string, password: string): Promise<string> {
  const r = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`Connexion refusée (${r.statusCode}) : ${r.body}`);
  return (r.json() as { token: string }).token;
}

describe('SUPERADMIN V1 — supervision et modération des utilisateurs', () => {
  let stack: TestStack;
  let superToken: string;

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true,
    });
    superToken = await platformLogin(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
  });
  afterAll(() => stack.teardown());

  it('liste combinée : joueurs (users) + comptes plateforme (platform_accounts)', async () => {
    await loginAs(stack, '+213555111222', 'Joueur Test');
    const r = await stack.app.inject({ method: 'GET', url: '/platform/users', headers: bearer(superToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { users: { kind: string; name: string }[] };
    expect(body.users.some((u) => u.kind === 'PLAYER' && u.name === 'Joueur Test')).toBe(true);
    expect(body.users.some((u) => u.kind === 'STAFF' && u.name === 'SUPERADMIN')).toBe(true);
  });

  it('recherche : filtre par nom/téléphone/email', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/users?q=joueur', headers: bearer(superToken) });
    const body = r.json() as { users: { name: string }[] };
    expect(body.users.length).toBeGreaterThan(0);
    expect(body.users.every((u) => u.name.toLowerCase().includes('joueur'))).toBe(true);
  });

  it('suspendre un joueur bloque réellement sa session — pas juste un badge', async () => {
    const playerToken = await loginAs(stack, '+213555333444', 'À Suspendre');
    const meBefore = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(playerToken) });
    expect(meBefore.statusCode).toBe(200);

    const userRow = await stack.db.selectFrom('users').select('id').where('phone', '=', '+213555333444').executeTakeFirstOrThrow();
    const suspend = await stack.app.inject({
      method: 'POST', url: `/platform/users/${userRow.id}/suspend`, headers: bearer(superToken),
    });
    expect(suspend.statusCode).toBe(200);

    const meAfter = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(playerToken) });
    expect(meAfter.statusCode).toBe(401); // la session existante est maintenant invalide
    expect(meAfter.json()).toMatchObject({ error: 'ACCOUNT_SUSPENDED' }); // et l'app en est informée (JO7, 22/09/2026)

    const reactivate = await stack.app.inject({
      method: 'POST', url: `/platform/users/${userRow.id}/reactivate`, headers: bearer(superToken),
    });
    expect(reactivate.statusCode).toBe(200);
    // la réactivation restaure immédiatement le jeton EXISTANT — jamais révoqué,
    // seul le statut du compte faisait obstacle — pas besoin de se reconnecter.
    const meRestored = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(playerToken) });
    expect(meRestored.statusCode).toBe(200);
  });

  it('impossible de suspendre le dernier SUPERADMIN actif', async () => {
    const only = await stack.db.selectFrom('platform_accounts').select('id')
      .where('email', '=', 'admin@moubarat.test').executeTakeFirstOrThrow();
    const r = await stack.app.inject({
      method: 'POST', url: `/platform/accounts/${only.id}/suspend`, headers: bearer(superToken),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'LAST_SUPERADMIN' });
  });

  it('un second SUPERADMIN peut être suspendu (le premier reste actif)', async () => {
    const secondId = await createPlatformAccount(stack.db, {
      email: 'second@moubarat.test', password: 'SecondSuperadmin9!', name: 'Second SUPERADMIN', isSuperadmin: true,
    });
    const r = await stack.app.inject({
      method: 'POST', url: `/platform/accounts/${secondId}/suspend`, headers: bearer(superToken),
    });
    expect(r.statusCode).toBe(200);
  });

  it('SA-1(a) (27/09/2026) : le superadmin corrige le téléphone d’un joueur — normalisé, identique = no-op, déjà pris = 409, audité sans venueId', async () => {
    await loginAs(stack, '+213555777001', 'Vieux Numéro');
    await loginAs(stack, '+213555777002', 'Numéro Pris');
    const user = await stack.db.selectFrom('users').select(['id', 'phone']).where('phone', '=', '+213555777001').executeTakeFirstOrThrow();

    const invalid = await stack.app.inject({
      method: 'PATCH', url: `/platform/users/${user.id}/phone`, headers: bearer(superToken), payload: { phone: 'pas-un-numero' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'PHONE_INVALID' });

    const noop = await stack.app.inject({
      method: 'PATCH', url: `/platform/users/${user.id}/phone`, headers: bearer(superToken), payload: { phone: user.phone },
    });
    expect(noop.statusCode).toBe(200);
    expect((noop.json() as { changed: string[] }).changed).toEqual([]);

    const taken = await stack.app.inject({
      method: 'PATCH', url: `/platform/users/${user.id}/phone`, headers: bearer(superToken), payload: { phone: '0555777002' },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: 'PHONE_TAKEN' });

    const ok = await stack.app.inject({
      method: 'PATCH', url: `/platform/users/${user.id}/phone`, headers: bearer(superToken), payload: { phone: '0555777003' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const okBody = ok.json() as { user: { phone: string }; changed: string[] };
    expect(okBody.user.phone).toBe('+213555777003');
    expect(okBody.changed).toEqual(['phone']);

    const row = await stack.db.selectFrom('users').select('phone').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(row.phone).toBe('+213555777003');

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('action', '=', 'USER_PHONE_CHANGED').where('object_id', '=', user.id).executeTakeFirstOrThrow();
    expect(audit.venue_id).toBeNull();
    expect(audit.before_val).toBe('+213555777001');
    expect(audit.after_val).toBe('+213555777003');
  });

  it('non-superadmin : 403 sur toutes les routes utilisateurs', async () => {
    const ordId = await createPlatformAccount(stack.db, {
      email: 'ordinaire2@moubarat.test', password: 'OrdinaireDemo9!', name: 'Ordinaire',
    });
    const ordToken = await platformLogin(stack, 'ordinaire2@moubarat.test', 'OrdinaireDemo9!');
    const list = await stack.app.inject({ method: 'GET', url: '/platform/users', headers: bearer(ordToken) });
    expect(list.statusCode).toBe(403);
    const suspend = await stack.app.inject({ method: 'POST', url: `/platform/accounts/${ordId}/suspend`, headers: bearer(ordToken) });
    expect(suspend.statusCode).toBe(403);
  });
});
