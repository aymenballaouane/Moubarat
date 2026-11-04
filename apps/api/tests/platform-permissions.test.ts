import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* SUPERADMIN V1, étape 2 — preuve HTTP que requireSuperadmin distingue
   réellement les niveaux d'accès, sur la première vraie ressource protégée
   (GET /platform/accounts). Aucune route /platform/venues|users|... n'existe
   encore (étape 3) — hors périmètre ici. */

async function platformLogin(stack: TestStack, email: string, password: string): Promise<string> {
  const r = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`Connexion plateforme refusée pour ${email} (${r.statusCode})`);
  return (r.json() as { token: string }).token;
}

describe('SUPERADMIN V1 — requireSuperadmin sur une vraie ressource (GET /platform/accounts)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'Aymen (SUPERADMIN)', isSuperadmin: true,
    });
    await createPlatformAccount(stack.db, {
      email: 'hamid.ordinaire@moubarat.test', password: 'HamidPassword9!', name: 'Compte plateforme non-superadmin',
    });
  });
  afterAll(() => stack.teardown());

  it('SUPERADMIN : accès accordé (200), liste réelle depuis Postgres', async () => {
    const token = await platformLogin(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
    const r = await stack.app.inject({ method: 'GET', url: '/platform/accounts', headers: bearer(token) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { accounts: { email: string; isSuperadmin: boolean }[] };
    expect(body.accounts.map((a) => a.email)).toContain('admin@moubarat.test');
    expect(body.accounts.map((a) => a.email)).toContain('hamid.ordinaire@moubarat.test');
    // jamais le hash de mot de passe dans la réponse
    expect(JSON.stringify(body)).not.toContain('password_hash');
  });

  it('compte plateforme réel mais NON superadmin : 403 (session valide, autorisation refusée)', async () => {
    const token = await platformLogin(stack, 'hamid.ordinaire@moubarat.test', 'HamidPassword9!');
    const r = await stack.app.inject({ method: 'GET', url: '/platform/accounts', headers: bearer(token) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('un joueur (session Player réelle, OTP) : 401 — pas un jeton plateforme reconnu, pas juste refusé', async () => {
    const playerToken = await loginAs(stack, '+213661200002', 'Karim Test'); // PLAYER
    const r = await stack.app.inject({ method: 'GET', url: '/platform/accounts', headers: bearer(playerToken) });
    expect(r.statusCode).toBe(401);
  });

  it('sans jeton : 401', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/accounts' });
    expect(r.statusCode).toBe(401);
  });

  it('jeton Player invalide/aléatoire présenté comme jeton plateforme : 401, jamais un 500', async () => {
    const r = await stack.app.inject({
      method: 'GET', url: '/platform/accounts', headers: bearer('0'.repeat(64)),
    });
    expect(r.statusCode).toBe(401);
  });
});
