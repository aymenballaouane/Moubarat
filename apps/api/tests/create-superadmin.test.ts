import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { ensureSuperadmin, MIN_SUPERADMIN_PASSWORD_LENGTH } from '../src/platform/auth/superadmin.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Chantier « script Superadmin » (04/09/2026) : base vide (aucun seed — c'est
   précisément le cas d'une base de production), création réelle, puis
   connexion réelle par l'API pour prouver que le compte fonctionne. */

let stack: TestStack;
const EMAIL = 'aymen.prod@moubarat.local';
const PASSWORD = 'MotDePasseSuperadmin2026!';

beforeAll(async () => { stack = await setupTestStack(); });
afterAll(async () => { await stack.teardown(); });

async function login(email: string, password: string) {
  return stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
}

describe('ensureSuperadmin — création du superadmin hors seed', () => {
  it('crée le compte sur une base vide, l\'adresse normalisée, et la connexion plateforme fonctionne', async () => {
    const result = await ensureSuperadmin(stack.db, { email: `  ${EMAIL.toUpperCase()} `, password: PASSWORD, name: 'Aymen' });
    expect(result.outcome).toBe('created');
    expect(result.email).toBe(EMAIL);

    const row = await stack.db.selectFrom('platform_accounts').selectAll().where('email', '=', EMAIL).executeTakeFirstOrThrow();
    expect(row.is_superadmin).toBe(true);
    expect(row.name).toBe('Aymen');
    expect(row.password_hash).not.toContain(PASSWORD);

    const res = await login(EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    const token = (res.json() as { token: string }).token;
    const me = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { account: { isSuperadmin: boolean } }).account.isSuperadmin).toBe(true);
  });

  it('idempotent : une seconde exécution ne fait rien et ne change PAS le mot de passe', async () => {
    const again = await ensureSuperadmin(stack.db, { email: EMAIL, password: 'UnAutreMotDePasse2026!!' });
    expect(again.outcome).toBe('already-superadmin');

    const count = await stack.db.selectFrom('platform_accounts').select(stack.db.fn.countAll<string>().as('n'))
      .where('email', '=', EMAIL).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
    expect((await login(EMAIL, PASSWORD)).statusCode).toBe(200);
    expect((await login(EMAIL, 'UnAutreMotDePasse2026!!')).statusCode).toBe(401);
  });

  it('refuse de promouvoir un compte de centre existant, et le laisse intact', async () => {
    const centerEmail = 'reception.prod@moubarat.local';
    await createPlatformAccount(stack.db, { email: centerEmail, password: 'ReceptionDemo2026!!', name: 'Réception', isSuperadmin: false });

    await expect(ensureSuperadmin(stack.db, { email: centerEmail, password: PASSWORD }))
      .rejects.toThrow(/existe déjà SANS le rôle superadmin/);

    const row = await stack.db.selectFrom('platform_accounts').select(['is_superadmin']).where('email', '=', centerEmail).executeTakeFirstOrThrow();
    expect(row.is_superadmin).toBe(false);
    expect((await login(centerEmail, 'ReceptionDemo2026!!')).statusCode).toBe(200);
  });

  it('refuse un mot de passe trop court ou une adresse invalide, sans rien écrire', async () => {
    const short = 'x'.repeat(MIN_SUPERADMIN_PASSWORD_LENGTH - 1);
    await expect(ensureSuperadmin(stack.db, { email: 'court@moubarat.local', password: short }))
      .rejects.toThrow(/trop court/);
    await expect(ensureSuperadmin(stack.db, { email: 'pas-une-adresse', password: PASSWORD }))
      .rejects.toThrow(/SUPERADMIN_EMAIL invalide/);

    const rows = await stack.db.selectFrom('platform_accounts').select('email')
      .where('email', 'in', ['court@moubarat.local', 'pas-une-adresse']).execute();
    expect(rows).toEqual([]);
  });

  /* Audit 07-09/09/2026 (Z7) : le vrai trou n'était pas superadmin:create
     (déjà couvert par MIN_SUPERADMIN_PASSWORD_LENGTH ci-dessus) mais
     crm:create-account.ts, qui n'imposait rien — le mot de passe du gérant
     d'un centre pilote pouvait être trivial. La validation vit maintenant
     dans createPlatformAccount lui-même (routes.ts), seul point de passage
     des deux scripts : ce test l'exerce directement, pas via ensureSuperadmin. */
  it('createPlatformAccount (chemin crm:create-account) refuse aussi un mot de passe trop court, sans rien écrire', async () => {
    const short = 'x'.repeat(MIN_SUPERADMIN_PASSWORD_LENGTH - 1);
    await expect(createPlatformAccount(stack.db, { email: 'gerant-court@moubarat.local', password: short, name: 'Gérant' }))
      .rejects.toThrow(/trop court/);
    const row = await stack.db.selectFrom('platform_accounts').select('email')
      .where('email', '=', 'gerant-court@moubarat.local').executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
