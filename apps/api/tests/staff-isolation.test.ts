import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Audit juridique et technique du 25/09/2026, P0-4b — un PROPRIÉTAIRE ne prend pas la main sur le compte d'un autre
   centre. Avant ce correctif : un OWNER rattachait à SON centre n'importe quel compte plateforme retrouvé par e-mail
   (titulaire ni consulté ni informé), puis réinitialisait son mot de passe et obtenait les identifiants d'un compte qui
   ouvre aussi d'AUTRES centres. Ici : le centre A (seed, OWNER = hamid) contre le centre B et un superadmin. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '';
let superToken = '';
let venueB = '';
let managerBId = '';
const PASSWORD_B = 'MotDePasseCentreB-12';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
  await createPlatformAccount(stack.db, { email: 'admin.iso@moubarat.test', password: 'CorrectHorseBattery9!', name: 'Admin Iso', isSuperadmin: true });
  superToken = await loginAsPlatform(stack, 'admin.iso@moubarat.test', 'CorrectHorseBattery9!');
  venueB = (await stack.db.insertInto('venues').values({
    name: 'Centre Bêta Confidentiel', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
  }).returning('id').executeTakeFirstOrThrow()).id;
  managerBId = await createPlatformAccount(stack.db, { email: 'gerant.b@centre-beta.test', password: PASSWORD_B, name: 'Gérant Bêta' });
  await stack.db.insertInto('center_staff').values({ venue_id: venueB, user_id: managerBId, role: 'OWNER' }).execute();
  await createPlatformAccount(stack.db, { email: 'orphelin@nulle-part.test', password: 'CompteSansCentre-12', name: 'Sans Centre' });
});
afterAll(() => stack.teardown());

const staffUrl = (v = seed.venueId) => `/venues/${v}/staff`;
const attach = (token: string, email: string, venue = seed.venueId) => stack.app.inject({
  method: 'POST', url: staffUrl(venue), headers: bearer(token), payload: { email, name: 'Peu importe', role: 'MANAGER' },
});
const hashOf = async (email: string) =>
  (await stack.db.selectFrom('platform_accounts').select('password_hash').where('email', '=', email).executeTakeFirstOrThrow()).password_hash;
const linksOf = async (email: string) =>
  (await stack.db.selectFrom('center_staff').innerJoin('platform_accounts', 'platform_accounts.id', 'center_staff.user_id')
    .select('center_staff.venue_id').where('platform_accounts.email', '=', email).execute()).map((r) => r.venue_id);

describe('rattacher un compte EXISTANT — refusé à un propriétaire', () => {
  it('compte d’un AUTRE centre : 409 ACCOUNT_EXISTS, aucun rattachement, mot de passe intact, aucun détail sur le compte ni sur l’autre centre', async () => {
    const before = await hashOf('gerant.b@centre-beta.test');
    const res = await attach(hamid, 'gerant.b@centre-beta.test');
    expect(res.statusCode, res.body).toBe(409);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('ACCOUNT_EXISTS');
    expect(res.body).not.toContain('Bêta');
    expect(res.body).not.toContain('otherVenues');
    expect(res.body).not.toContain('account');
    expect(await linksOf('gerant.b@centre-beta.test')).toEqual([venueB]); // jamais rattaché à A
    expect(await hashOf('gerant.b@centre-beta.test')).toBe(before);
    // Et la prise de contrôle qui suivait (réinitialisation) n'est plus atteignable : le compte n'est pas de ce centre.
    const reset = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${managerBId}/reset-password`, headers: bearer(hamid) });
    expect(reset.statusCode).toBe(404);
  });

  it('la tentative est TRACÉE dans le journal du centre de l’auteur (jamais dans celui de l’autre), sans le nom de l’autre centre', async () => {
    const rows = await stack.db.selectFrom('audit_log').select(['venue_id', 'actor_role', 'summary'])
      .where('action', '=', 'STAFF_ATTACH_REFUSED').execute();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.venue_id === seed.venueId && r.actor_role === 'OWNER')).toBe(true);
    expect(rows.some((r) => r.summary.includes('gerant.b@centre-beta.test'))).toBe(true);
    expect(rows.some((r) => r.summary.includes('Bêta'))).toBe(false);
  });

  it('adresse d’un administrateur plateforme, d’un compte SANS centre, d’un compte d’ailleurs : la MÊME réponse (rien à apprendre de la différence)', async () => {
    const asSuper = await attach(hamid, 'admin.iso@moubarat.test');
    const orphan = await attach(hamid, 'orphelin@nulle-part.test');
    const other = await attach(hamid, 'gerant.b@centre-beta.test');
    expect(asSuper.statusCode).toBe(409);
    expect(orphan.statusCode).toBe(409);
    expect(asSuper.json()).toEqual(other.json());
    expect(orphan.json()).toEqual(other.json());
    expect(await linksOf('orphelin@nulle-part.test')).toEqual([]);
    expect(await linksOf('admin.iso@moubarat.test')).toEqual([]);
  });

  it('un autre centre ne peut pas non plus être visé : le propriétaire de A n’a aucun droit sur le centre B (403)', async () => {
    expect((await attach(hamid, 'quelquun@x.test', venueB)).statusCode).toBe(403);
  });
});

describe('employé retiré puis repris — le cas légitime reste possible, et seulement lui', () => {
  const email = 'reembauche@centre-a.test';
  let accountId = '';

  it('créé par CE centre : mot de passe généré ; réinitialisation possible (compte à ce seul centre)', async () => {
    const res = await stack.app.inject({ method: 'POST', url: staffUrl(), headers: bearer(hamid), payload: { email, name: 'Employé Repris', role: 'STAFF' } });
    expect(res.statusCode, res.body).toBe(201);
    accountId = (res.json() as { account: { id: string } }).account.id;
    const reset = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${accountId}/reset-password`, headers: bearer(hamid) });
    expect(reset.statusCode, reset.body).toBe(200);
  });

  it('retiré puis re-rattaché par le même propriétaire : accepté, mot de passe inchangé, aucun autre centre', async () => {
    expect((await stack.app.inject({ method: 'DELETE', url: `${staffUrl()}/${accountId}`, headers: bearer(hamid) })).statusCode).toBe(204);
    const before = await hashOf(email);
    const res = await attach(hamid, email);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { reused: boolean; otherVenues: string[]; temporaryPassword?: string };
    expect(body.reused).toBe(true);
    expect(body.otherVenues).toEqual([]);
    expect(body.temporaryPassword).toBeUndefined();
    expect(await hashOf(email)).toBe(before);
  });

  it('dès qu’un AUTRE centre le rattache (superadmin), le propriétaire de A ne peut plus réinitialiser son mot de passe (403 SHARED_ACCOUNT), sessions et mot de passe intacts', async () => {
    const viaSuper = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${venueB}/staff`, headers: bearer(superToken),
      payload: { email, name: 'ignoré', role: 'RECEPTION' },
    });
    expect(viaSuper.statusCode, viaSuper.body).toBe(201);
    const sessionToken = await loginAsPlatform(stack, email, 'inconnu').catch(() => null); // mot de passe inconnu : pas de session
    expect(sessionToken).toBeNull();
    // Une session ouverte sur ce compte (jeton posé comme un login le ferait) ne doit pas être révoquée par le refus.
    const { sha256 } = await import('../src/lib/crypto.js');
    await stack.db.insertInto('platform_sessions').values({ account_id: accountId, token_hash: sha256('jeton-employe-partage') }).execute();
    const before = await hashOf(email);

    const reset = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${accountId}/reset-password`, headers: bearer(hamid) });
    expect(reset.statusCode, reset.body).toBe(403);
    expect((reset.json() as { error: string }).error).toBe('SHARED_ACCOUNT');
    expect(reset.body).not.toContain('Bêta');
    expect(await hashOf(email)).toBe(before);
    const me = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer('jeton-employe-partage') });
    expect(me.statusCode).toBe(200);
  });

  it('retiré de A puis re-tenté : refusé — le compte appartient désormais aussi à un autre centre', async () => {
    expect((await stack.app.inject({ method: 'DELETE', url: `${staffUrl()}/${accountId}`, headers: bearer(hamid) })).statusCode).toBe(204);
    const res = await attach(hamid, email);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('ACCOUNT_EXISTS');
    expect(await linksOf(email)).toEqual([venueB]);
  });
});

describe('le superadmin garde son pouvoir (console) — c’est LUI le recours', () => {
  it('rattache un compte existant d’un autre centre (signalé), et réinitialise le mot de passe d’un compte partagé', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${seed.venueId}/staff`, headers: bearer(superToken),
      payload: { email: 'gerant.b@centre-beta.test', name: 'ignoré', role: 'MANAGER' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { reused: boolean; otherVenues: string[] }).otherVenues).toEqual(['Centre Bêta Confidentiel']);

    const before = await hashOf('gerant.b@centre-beta.test');
    const reset = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${seed.venueId}/staff/${managerBId}/reset-password`, headers: bearer(superToken),
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(await hashOf('gerant.b@centre-beta.test')).not.toBe(before);
  });
});
