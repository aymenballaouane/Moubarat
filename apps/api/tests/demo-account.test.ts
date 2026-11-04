import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, type TestStack } from './helpers.js';
import { ensureDemoAccount, readDemoPassword } from '../src/scripts/demo-account.js';

/* Audit produit TR17 (22/09/2026) — le compte CRM du centre de démo n'a plus de mot de passe par défaut dans le code :
   obligatoire pour le créer (refus AVANT d'effacer quoi que ce soit), rotation par DEMO_VENUE_PASSWORD, jamais affiché. */

const EMAIL = 'demo.test@moubarat.test';
const FIRST = 'PremierMotDePasse-2026';
const SECOND = 'SecondMotDePasse-2026';

let stack: TestStack;
beforeAll(async () => { stack = await setupTestStack(); });
afterAll(() => stack.teardown());

const accountRows = () => stack.db.selectFrom('platform_accounts').select(['id', 'failed_login_attempts']).where('email', '=', EMAIL).execute();

describe('readDemoPassword', () => {
  it('valeur nettoyée ; absente, vide ou faite d’espaces : null', () => {
    expect(readDemoPassword({ DEMO_VENUE_PASSWORD: '  abcdefghijkl  ' })).toBe('abcdefghijkl');
    expect(readDemoPassword({})).toBeNull();
    expect(readDemoPassword({ DEMO_VENUE_PASSWORD: '' })).toBeNull();
    expect(readDemoPassword({ DEMO_VENUE_PASSWORD: '   ' })).toBeNull();
  });
});

describe('ensureDemoAccount', () => {
  it('compte absent + aucun mot de passe : refus explicite, AUCUN compte créé', async () => {
    await expect(ensureDemoAccount(stack.db, { email: EMAIL, password: null, name: 'Gérant Démo' }))
      .rejects.toThrow(/DEMO_VENUE_PASSWORD est obligatoire.*Rien n’a été modifié/s);
    expect(await accountRows()).toHaveLength(0);
  });

  it('mot de passe trop court : refus, aucun compte créé', async () => {
    await expect(ensureDemoAccount(stack.db, { email: EMAIL, password: 'court', name: 'Gérant Démo' })).rejects.toThrow(/trop court/);
    expect(await accountRows()).toHaveLength(0);
  });

  it('compte absent + mot de passe : créé, et le mot de passe fourni ouvre bien le compte', async () => {
    const r = await ensureDemoAccount(stack.db, { email: EMAIL, password: FIRST, name: 'Gérant Démo' });
    expect(r.outcome).toBe('created');
    await expect(loginAsPlatform(stack, EMAIL, FIRST)).resolves.toBeTruthy();
  });

  it('compte présent + rien fourni : inchangé (l’ancien mot de passe marche toujours, la session reste ouverte)', async () => {
    const token = await loginAsPlatform(stack, EMAIL, FIRST);
    const r = await ensureDemoAccount(stack.db, { email: EMAIL, password: null, name: 'Gérant Démo' });
    expect(r.outcome).toBe('reused');
    await expect(loginAsPlatform(stack, EMAIL, FIRST)).resolves.toBeTruthy();
    const me = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
  });

  it('compte présent + nouvelle valeur : rotation — l’ancien mot de passe est refusé, le nouveau ouvre, les sessions ouvertes sont révoquées, le verrou est levé', async () => {
    const oldToken = await loginAsPlatform(stack, EMAIL, FIRST);
    await stack.db.updateTable('platform_accounts').set({ failed_login_attempts: 3, locked_until: new Date(Date.now() + 600_000) }).where('email', '=', EMAIL).execute();

    const r = await ensureDemoAccount(stack.db, { email: EMAIL, password: SECOND, name: 'Gérant Démo' });
    expect(r.outcome).toBe('password-reset');

    await expect(loginAsPlatform(stack, EMAIL, FIRST)).rejects.toThrow();
    await expect(loginAsPlatform(stack, EMAIL, SECOND)).resolves.toBeTruthy();
    const me = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: { authorization: `Bearer ${oldToken}` } });
    expect(me.statusCode).toBe(401);
    expect((await accountRows())[0]!.failed_login_attempts).toBe(0);
  });

  it('rotation avec une valeur trop courte : refusée, le mot de passe actuel reste valable', async () => {
    await expect(ensureDemoAccount(stack.db, { email: EMAIL, password: 'court', name: 'Gérant Démo' })).rejects.toThrow(/trop court/);
    await expect(loginAsPlatform(stack, EMAIL, SECOND)).resolves.toBeTruthy();
  });
});

describe('plus aucun mot de passe de démo dans le code ni dans la documentation (TR17)', () => {
  // Construit par morceaux : ce fichier ne doit pas, lui non plus, réintroduire le mot de passe qu'il interdit.
  const BURNED = ['Demo2026', 'Arena!'].join('');
  const root = resolve(import.meta.dirname, '..', '..', '..');
  it.each([
    'apps/api/src/scripts/seed-demo-venue.ts',
    'apps/api/src/scripts/demo-account.ts',
    'scripts/demo.mjs',
    'docs/DEMO.md',
  ])('%s ne contient pas l’ancien mot de passe publié', (file) => {
    expect(readFileSync(resolve(root, file), 'utf8')).not.toContain(BURNED);
  });

  it('le script du centre démo n’imprime jamais le mot de passe (aucun console.log de DEMO_PASSWORD)', () => {
    const src = readFileSync(resolve(root, 'apps/api/src/scripts/seed-demo-venue.ts'), 'utf8');
    expect(src).not.toMatch(/console\.(log|info|warn|error)\([^)]*DEMO_PASSWORD/);
  });
});
