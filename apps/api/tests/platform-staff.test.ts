import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { generateTemporaryPassword } from '../src/lib/crypto.js';

/* 20/09/2026, demande d'Aymen — le superadmin crée le compte CRM d'un centre
   depuis la console (remplace `pnpm crm:create-account`) : mot de passe GÉNÉRÉ,
   affiché une seule fois ; réinitialisation qui coupe les sessions ouvertes.
   Aucun changement de mot de passe forcé à la première connexion (V1). */

async function login(stack: TestStack, email: string, password: string) {
  return stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
}
async function loginToken(stack: TestStack, email: string, password: string): Promise<string> {
  const r = await login(stack, email, password);
  if (r.statusCode !== 200) throw new Error(`Connexion refusée pour ${email} (${r.statusCode}) : ${r.body}`);
  return (r.json() as { token: string }).token;
}

describe('mot de passe temporaire généré', () => {
  it('16 caractères en 4 groupes, alphabet sans caractères ambigus, jamais deux identiques de suite', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/); // ni 0/O/o, ni 1/I/l
      expect(p.length).toBeGreaterThanOrEqual(12);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('comptes CRM d’un centre — création par le superadmin', () => {
  let stack: TestStack;
  let superToken: string;
  let ordinaryToken: string;
  let venueId = '';
  let otherVenueId = '';

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
    await createPlatformAccount(stack.db, { email: 'ordinaire@moubarat.test', password: 'OrdinairePass9!', name: 'Compte ordinaire' });
    superToken = await loginToken(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
    ordinaryToken = await loginToken(stack, 'ordinaire@moubarat.test', 'OrdinairePass9!');
    const mk = async (name: string) => (await stack.db.insertInto('venues').values({
      name, wilaya: 'Alger', address: 'x', lat: 36.7, lng: 3.0, status: 'PENDING',
    }).returning('id').executeTakeFirstOrThrow()).id;
    venueId = await mk('Centre Staff A');
    otherVenueId = await mk('Centre Staff B');
  });
  afterAll(() => stack.teardown());

  const post = (token: string | null, url: string, payload?: Record<string, unknown>) =>
    stack.app.inject({ method: 'POST', url, ...(token ? { headers: bearer(token) } : {}), ...(payload ? { payload } : {}) });
  const staffUrl = (v = venueId) => `/platform/venues/${v}/staff`;

  it('réservé au superadmin : anonyme 401, compte ordinaire 403 (liste, création, réinitialisation)', async () => {
    expect((await stack.app.inject({ method: 'GET', url: staffUrl() })).statusCode).toBe(401);
    expect((await post(null, staffUrl(), { email: 'a@b.co', name: 'Test' })).statusCode).toBe(401);
    expect((await stack.app.inject({ method: 'GET', url: staffUrl(), headers: bearer(ordinaryToken) })).statusCode).toBe(403);
    expect((await post(ordinaryToken, staffUrl(), { email: 'a@b.co', name: 'Test' })).statusCode).toBe(403);
    expect((await post(ordinaryToken, `${staffUrl()}/00000000-0000-0000-0000-000000000000/reset-password`)).statusCode).toBe(403);
  });

  it('validations : centre inconnu 404, email invalide, rôle invalide, nom trop court', async () => {
    expect((await post(superToken, staffUrl('00000000-0000-0000-0000-000000000000'), { email: 'a@b.co', name: 'Test Nom' })).statusCode).toBe(404);
    expect((await post(superToken, staffUrl(), { email: 'pas-un-email', name: 'Test Nom' })).statusCode).toBe(400);
    expect((await post(superToken, staffUrl(), { email: 'a@b.co', name: 'Test Nom', role: 'PATRON' })).statusCode).toBe(400);
    expect((await post(superToken, staffUrl(), { email: 'a@b.co', name: 'X' })).statusCode).toBe(400);
  });

  it('création : compte + rattachement OWNER, mot de passe généré renvoyé UNE fois, connexion CRM réelle avec ce mot de passe', async () => {
    const res = await post(superToken, staffUrl(), { email: '  Gerant@Centre-A.TEST ', name: 'Karim Gérant' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as { account: { id: string; email: string }; role: string; reused: boolean; temporaryPassword: string };
    expect(body.role).toBe('OWNER');
    expect(body.reused).toBe(false);
    expect(body.account.email).toBe('gerant@centre-a.test'); // normalisé
    expect(body.temporaryPassword).toMatch(/^[A-Za-z2-9-]{19}$/);

    // Se connecte réellement avec ce mot de passe, et n'est rattaché qu'à CE centre, en OWNER.
    const lg = await login(stack, 'gerant@centre-a.test', body.temporaryPassword);
    expect(lg.statusCode, lg.body).toBe(200);
    const lb = lg.json() as { account: { isSuperadmin: boolean }; centerMemberships: { venueId: string; role: string }[] };
    expect(lb.account.isSuperadmin).toBe(false);
    // subscriptionStatus/subscriptionDueAt (22/09/2026, C1/CE11) : défauts PAID/null, voir venue-subscription.test.ts.
    expect(lb.centerMemberships).toEqual([{ venueId, venueName: 'Centre Staff A', role: 'OWNER', subscriptionStatus: 'PAID', subscriptionDueAt: null }]);

    // Le mot de passe n'est en clair NULLE PART : ni en base, ni dans le journal d'audit.
    const acc = await stack.db.selectFrom('platform_accounts').select('password_hash').where('id', '=', body.account.id).executeTakeFirstOrThrow();
    expect(acc.password_hash).not.toContain(body.temporaryPassword);
    const audit = await stack.db.selectFrom('audit_log').selectAll().where('object_id', '=', body.account.id).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('STAFF_ACCOUNT_CREATED');
    expect(audit[0]!.actor_role).toBe('SUPERADMIN');
    expect(audit[0]!.venue_id).toBe(venueId);
    expect(JSON.stringify(audit)).not.toContain(body.temporaryPassword);

    // La liste ne le renvoie plus, et ne fuit jamais le hash.
    const list = await stack.app.inject({ method: 'GET', url: staffUrl(), headers: bearer(superToken) });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(body.temporaryPassword);
    expect(list.body).not.toContain('password_hash');
    const staff = (list.json() as { staff: { email: string; role: string; status: string; lastSeenAt: string | null }[] }).staff;
    expect(staff.map((s) => [s.email, s.role, s.status])).toEqual([['gerant@centre-a.test', 'OWNER', 'ACTIVE']]);
    expect(staff[0]!.lastSeenAt).not.toBeNull(); // la connexion ci-dessus
  });

  it('rôle choisi (RECEPTION), et un même email déjà rattaché à CE centre : 409 ALREADY_STAFF, rien n’est écrit', async () => {
    const ok = await post(superToken, staffUrl(), { email: 'accueil@centre-a.test', name: 'Nadia Accueil', role: 'reception' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as { role: string }).role).toBe('RECEPTION');
    const dup = await post(superToken, staffUrl(), { email: 'ACCUEIL@centre-a.test', name: 'Nadia Accueil' });
    expect(dup.statusCode, dup.body).toBe(409);
    expect((dup.json() as { error: string }).error).toBe('ALREADY_STAFF');
    const n = await stack.db.selectFrom('center_staff').select((eb) => eb.fn.countAll().as('n')).where('venue_id', '=', venueId).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(2);
  });

  it('compte EXISTANT d’un autre centre : rattaché, mot de passe INCHANGÉ (rien renvoyé), autre centre signalé', async () => {
    const before = await stack.db.selectFrom('platform_accounts').select('password_hash').where('email', '=', 'gerant@centre-a.test').executeTakeFirstOrThrow();
    const res = await post(superToken, staffUrl(otherVenueId), { email: 'gerant@centre-a.test', name: 'ignoré', role: 'MANAGER' });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { reused: boolean; role: string; otherVenues: string[]; temporaryPassword?: string };
    expect(body.reused).toBe(true);
    expect(body.role).toBe('MANAGER');
    expect(body.otherVenues).toEqual(['Centre Staff A']);
    expect(body.temporaryPassword).toBeUndefined();
    const after = await stack.db.selectFrom('platform_accounts').select('password_hash').where('email', '=', 'gerant@centre-a.test').executeTakeFirstOrThrow();
    expect(after.password_hash).toBe(before.password_hash);
    const audit = await stack.db.selectFrom('audit_log').select('action').where('venue_id', '=', otherVenueId).execute();
    expect(audit.map((a) => a.action)).toEqual(['STAFF_ACCOUNT_ATTACHED']);
  });

  it('un compte administrateur plateforme ne se rattache jamais à un centre (409)', async () => {
    const res = await post(superToken, staffUrl(), { email: 'admin@moubarat.test', name: 'Peu importe' });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: string }).error).toBe('ACCOUNT_IS_SUPERADMIN');
  });

  it('un compte SUSPENDU se rattache mais reste suspendu (visible dans la liste) ; la suspension existante fonctionne dessus', async () => {
    const created = await post(superToken, staffUrl(), { email: 'suspendu@centre-a.test', name: 'Compte Suspendu' });
    const accountId = (created.json() as { account: { id: string } }).account.id;
    expect((await post(superToken, `/platform/accounts/${accountId}/suspend`)).statusCode).toBe(200);
    const list = await stack.app.inject({ method: 'GET', url: staffUrl(), headers: bearer(superToken) });
    const row = (list.json() as { staff: { email: string; status: string }[] }).staff.find((s) => s.email === 'suspendu@centre-a.test')!;
    expect(row.status).toBe('SUSPENDED');
  });

  it('réinitialisation : nouveau mot de passe (ancien refusé), sessions ouvertes révoquées, verrouillage levé, journalisé sans le mot de passe', async () => {
    const created = await post(superToken, staffUrl(), { email: 'reset@centre-a.test', name: 'Reset Test' });
    const { account, temporaryPassword: oldPw } = created.json() as { account: { id: string }; temporaryPassword: string };
    const oldToken = await loginToken(stack, 'reset@centre-a.test', oldPw);
    expect((await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(oldToken) })).statusCode).toBe(200);
    // Simule un compte verrouillé par des essais ratés.
    await stack.db.updateTable('platform_accounts').set({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 3_600_000) }).where('id', '=', account.id).execute();

    const reset = await post(superToken, `${staffUrl()}/${account.id}/reset-password`);
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    const newPw = (reset.json() as { temporaryPassword: string }).temporaryPassword;
    expect(newPw).not.toBe(oldPw);

    // Ancienne session coupée, ancien mot de passe refusé, nouveau accepté (malgré le verrou levé).
    expect((await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(oldToken) })).statusCode).toBe(401);
    expect((await login(stack, 'reset@centre-a.test', oldPw)).statusCode).toBe(401);
    // (l'échec ci-dessus a repris un compteur ; le nouveau mot de passe le remet à zéro)
    expect((await login(stack, 'reset@centre-a.test', newPw)).statusCode).toBe(200);

    const audit = await stack.db.selectFrom('audit_log').selectAll().where('object_id', '=', account.id).where('action', '=', 'STAFF_PASSWORD_RESET').execute();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(newPw);
    expect(JSON.stringify(audit)).not.toContain(oldPw);
  });

  it('réinitialisation refusée : compte d’un AUTRE centre (404), compte inconnu (404), administrateur plateforme (jamais)', async () => {
    const other = await post(superToken, staffUrl(otherVenueId), { email: 'autre@centre-b.test', name: 'Autre Centre' });
    const otherId = (other.json() as { account: { id: string } }).account.id;
    // Le compte de B n'est pas réinitialisable via l'URL du centre A.
    expect((await post(superToken, `${staffUrl(venueId)}/${otherId}/reset-password`)).statusCode).toBe(404);
    expect((await post(superToken, `${staffUrl()}/00000000-0000-0000-0000-000000000000/reset-password`)).statusCode).toBe(404);
    // Un superadmin (même rattaché de force en base) ne se réinitialise pas depuis cet écran.
    const admin = await stack.db.selectFrom('platform_accounts').select('id').where('email', '=', 'admin@moubarat.test').executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values({ venue_id: venueId, user_id: admin.id, role: 'OWNER' }).execute();
    const res = await post(superToken, `${staffUrl()}/${admin.id}/reset-password`);
    expect(res.statusCode, res.body).toBe(403);
    // Son mot de passe n'a pas bougé.
    expect((await login(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!')).statusCode).toBe(200);
  });

  it('deux créations simultanées de la même adresse : une seule réussit, l’autre 409 (jamais un 500)', async () => {
    const results = await Promise.all([1, 2, 3].map(() => post(superToken, staffUrl(), { email: 'course@centre-a.test', name: 'Course Test' })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409).length).toBe(2);
  });
});
