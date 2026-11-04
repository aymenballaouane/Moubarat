import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';

/* Audit produit 21/09/2026 (JO6/JO7) — un joueur suspendu voit un message clair au lieu d'une déconnexion
   silencieuse ; décision Aymen 22/09 : le SMS part comme pour tout numéro, « compte suspendu » n'apparaît
   qu'APRÈS le bon code (aucun oracle sur l'existence d'un compte suspendu avant). */

let stack: TestStack;
const PHONE = '+213555777001';
const SUSPENDED_MESSAGE = 'Ce compte est suspendu. Contactez le support de Moubarat.';

beforeAll(async () => { stack = await setupTestStack(); });
afterAll(() => stack.teardown());

async function setStatus(phone: string, status: 'ACTIVE' | 'SUSPENDED') {
  await stack.db.updateTable('users').set({ status }).where('phone', '=', phone).execute();
}
/** Le cooldown (60 s) et le quota (3 / 15 min) du core comptent par numéro : on « vieillit » les demandes précédentes
    pour pouvoir en enchaîner dans un même test, sans jamais toucher à la règle elle-même. */
async function requestCode(phone: string): Promise<string> {
  await stack.db.updateTable('otp_challenges').set({ created_at: new Date(Date.now() - 20 * 60_000) }).where('phone', '=', phone).execute();
  const res = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
  expect(res.statusCode, res.body).toBe(200);
  const code = stack.sms.codeFor(phone);
  expect(code).toBeTruthy();
  return code!;
}
async function sessionCount(phone: string): Promise<number> {
  const rows = await stack.db.selectFrom('sessions').innerJoin('users', 'users.id', 'sessions.user_id')
    .select('sessions.id').where('users.phone', '=', phone).execute();
  return rows.length;
}

describe('joueur suspendu — session en cours (JO7)', () => {
  let token = '';

  it('la session existante est refusée avec le code ACCOUNT_SUSPENDED (401 : un ancien client se déconnecte comme avant)', async () => {
    token = await loginAs(stack, PHONE, 'Joueur À Suspendre');
    expect((await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).statusCode).toBe(200);

    await setStatus(PHONE, 'SUSPENDED');
    for (const url of ['/auth/me', '/me/bookings', '/me/notifications']) {
      const res = await stack.app.inject({ method: 'GET', url, headers: bearer(token) });
      expect(res.statusCode, url).toBe(401);
      expect(res.json()).toEqual({ error: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MESSAGE });
    }
  });

  it('un jeton invalide reste « session expirée », jamais confondu avec une suspension', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer('jeton-qui-nexiste-pas') });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('UNAUTHORIZED');
  });

  it('la navigation publique reste possible avec ce jeton (anonyme : aucune identité posée)', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/matches', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
  });

  it('la réactivation rend la MÊME session (rien n’a été révoqué)', async () => {
    await setStatus(PHONE, 'ACTIVE');
    expect((await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).statusCode).toBe(200);
  });
});

describe('joueur suspendu — connexion par code (JO6)', () => {
  it('le SMS part comme pour tout numéro ; le BON code répond 403 ACCOUNT_SUSPENDED, sans jeton ni nouvelle session', async () => {
    await setStatus(PHONE, 'SUSPENDED');
    const sessionsBefore = await sessionCount(PHONE);
    const code = await requestCode(PHONE);

    const res = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MESSAGE });
    expect(res.body).not.toContain('token');
    expect(await sessionCount(PHONE)).toBe(sessionsBefore);
  });

  it('le bon code est consommé : le rejouer donne OTP_ALREADY_USED, jamais une seconde révélation', async () => {
    const replay = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code: stack.sms.codeFor(PHONE) } });
    expect(replay.statusCode).toBe(400);
    expect((replay.json() as { error: string }).error).toBe('OTP_ALREADY_USED');
  });

  it('aucun oracle : un MAUVAIS code sur un numéro suspendu répond exactement comme sur un numéro actif', async () => {
    await requestCode(PHONE);
    const suspendedWrong = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code: '000000' } });

    const other = '+213555777002';
    await loginAs(stack, other, 'Joueur Actif');
    await requestCode(other);
    const activeWrong = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: other, code: '000000' } });

    expect(suspendedWrong.statusCode).toBe(activeWrong.statusCode);
    expect(suspendedWrong.json()).toEqual(activeWrong.json());
    expect((suspendedWrong.json() as { error: string }).error).toBe('OTP_WRONG');
  });

  it('réactivé, le même numéro se reconnecte normalement avec un nouveau code', async () => {
    await setStatus(PHONE, 'ACTIVE');
    const code = await requestCode(PHONE);
    const res = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PHONE, code } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { token: string }).token).toBeTruthy();
  });
});
