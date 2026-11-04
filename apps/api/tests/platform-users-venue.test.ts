import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Audit produit 21/09/2026 (CR18/CR20) — la colonne « Centre » de la console affichait « — » pour TOUT le personnel CRM
   réel : `GET /platform/users` joignait `center_staff.user_id` sur `users.id`, alors que la migration 0009 (03/09/2026)
   a repointé cette colonne vers `platform_accounts` — la jointure ne pouvait plus matcher aucune ligne. Par ailleurs,
   suspendre/réactiver un compte CRM n'écrivait jamais `venueId` : le gérant n'apprenait jamais qu'un accès à son
   centre venait d'être coupé ou rendu. */

let stack: TestStack;
let seed: SeedResult;
let superToken = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await createPlatformAccount(stack.db, {
    email: 'admin.cr18@moubarat.test', password: 'CorrectHorseBattery9!', name: 'Aymen (SUPERADMIN)', isSuperadmin: true,
  });
  superToken = await loginAsPlatform(stack, 'admin.cr18@moubarat.test', 'CorrectHorseBattery9!');
});
afterAll(() => stack.teardown());

interface PlatformUser { kind: 'PLAYER' | 'STAFF'; id: string; name: string; venueName: string | null }

async function listUsers(q = '') {
  const res = await stack.app.inject({ method: 'GET', url: `/platform/users${q ? `?q=${q}` : ''}`, headers: bearer(superToken) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { users: PlatformUser[] }).users;
}

describe('CR18 — GET /platform/users : la colonne Centre reflète le VRAI rattachement (center_staff → platform_accounts)', () => {
  it('un compte CRM rattaché (OWNER du seed) affiche le nom réel du centre, jamais « — »', async () => {
    const users = await listUsers();
    const hamid = users.find((u) => u.kind === 'STAFF' && u.name === 'Hamid Benali');
    expect(hamid?.venueName).toBe('Complexe Ryad');
  });

  it('un compte plateforme sans aucun rattachement (pur SUPERADMIN) : venueName null, jamais un centre inventé', async () => {
    const users = await listUsers();
    const admin = users.find((u) => u.kind === 'STAFF' && u.name === 'Aymen (SUPERADMIN)');
    expect(admin?.venueName).toBeNull();
  });

  it('un joueur (kind PLAYER) n’a jamais de centre — ce concept n’existe que pour un compte plateforme', async () => {
    const users = await listUsers();
    const player = users.find((u) => u.kind === 'PLAYER');
    expect(player).toBeDefined();
    expect(player?.venueName).toBeNull();
  });

  it('un compte rattaché à DEUX centres : les deux noms apparaissent, aucun choisi arbitrairement', async () => {
    const second = await stack.db.insertInto('venues').values({
      name: 'Second Centre CR18', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values({ venue_id: second.id, user_id: seed.crmStaff.hamid, role: 'OWNER' }).execute();

    const users = await listUsers();
    const hamid = users.find((u) => u.kind === 'STAFF' && u.name === 'Hamid Benali');
    expect(hamid?.venueName?.split(' · ').sort()).toEqual(['Complexe Ryad', 'Second Centre CR18'].sort());
  });
});

describe('CR20 — suspension/réactivation d’un compte CRM journalisée AVEC venueId (visible dans le Journal du centre)', () => {
  async function centerJournal(venueId: string, token: string) {
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}/audit-log`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    return (res.json() as { entries: { actorName: string; actorRole: string; summary: string }[] }).entries;
  }

  it('suspendre un OWNER rattaché : une entrée apparaît dans le Journal DE SON centre, actorName masqué en « Équipe Moubarat »', async () => {
    const yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER, VIEW_AUDIT_LOG

    const suspend = await stack.app.inject({
      method: 'POST', url: `/platform/accounts/${seed.crmStaff.amine}/suspend`, headers: bearer(superToken),
    });
    expect(suspend.statusCode, suspend.body).toBe(200);

    const entries = await centerJournal(seed.venueId, yacine);
    const found = entries.find((e) => e.summary === 'a suspendu le compte plateforme Amine Kaci');
    expect(found).toBeDefined();
    expect(found!.actorRole).toBe('SUPERADMIN');
    expect(found!.actorName).toBe('Équipe Moubarat');

    const reactivate = await stack.app.inject({
      method: 'POST', url: `/platform/accounts/${seed.crmStaff.amine}/reactivate`, headers: bearer(superToken),
    });
    expect(reactivate.statusCode).toBe(200);
    const after = await centerJournal(seed.venueId, yacine);
    expect(after.some((e) => e.summary === 'a réactivé le compte plateforme Amine Kaci')).toBe(true);
  });

  it('compte rattaché à deux centres : une entrée dans le Journal de CHACUN, jamais une seule au hasard', async () => {
    // Le compte suspendu ne peut pas lire lui-même le journal de son second centre (sa propre session tombe
    // avec lui) : un SECOND compte OWNER y est rattaché exprès pour vérifier la lecture còté gérant.
    const second = await stack.db.insertInto('venues').values({
      name: 'Second Centre CR20', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('center_staff').values([
      { venue_id: second.id, user_id: seed.crmStaff.nadia, role: 'OWNER' },
      { venue_id: second.id, user_id: seed.crmStaff.yacine, role: 'OWNER' },
    ]).execute();

    await stack.app.inject({ method: 'POST', url: `/platform/accounts/${seed.crmStaff.nadia}/suspend`, headers: bearer(superToken) });

    const yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
    const centerRyad = await centerJournal(seed.venueId, yacine);
    const centerSecond = await centerJournal(second.id, yacine);
    expect(centerRyad.some((e) => e.summary === 'a suspendu le compte plateforme Nadia Cherif')).toBe(true);
    expect(centerSecond.some((e) => e.summary === 'a suspendu le compte plateforme Nadia Cherif')).toBe(true);
  });

  it('compte SANS aucun rattachement : une entrée sans venueId, visible côté plateforme, jamais une erreur', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${seed.venueId}/staff`, headers: bearer(superToken),
      payload: { email: 'staff.orphelin.cr20@moubarat.test', name: 'Staff Orphelin', role: 'STAFF' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const accountId = (created.json() as { account: { id: string } }).account.id;
    await stack.db.deleteFrom('center_staff').where('user_id', '=', accountId).execute(); // simule un compte non rattaché

    const suspend = await stack.app.inject({ method: 'POST', url: `/platform/accounts/${accountId}/suspend`, headers: bearer(superToken) });
    expect(suspend.statusCode).toBe(200);

    const platform = await stack.app.inject({ method: 'GET', url: '/platform/audit-log', headers: bearer(superToken) });
    const entries = (platform.json() as { entries: { summary: string; venueId: string | null }[] }).entries;
    const found = entries.find((e) => e.summary === 'a suspendu le compte plateforme Staff Orphelin');
    expect(found).toBeDefined();
    expect(found!.venueId).toBeNull();
  });

  it('suspendre un joueur (pas un compte plateforme) reste inchangé — jamais de venueId inventé', async () => {
    const suspend = await stack.app.inject({
      method: 'POST', url: `/platform/users/${seed.users.karim}/suspend`, headers: bearer(superToken),
    });
    expect(suspend.statusCode, suspend.body).toBe(200);
    const platform = await stack.app.inject({ method: 'GET', url: '/platform/audit-log', headers: bearer(superToken) });
    const entries = (platform.json() as { entries: { action: string; venueId: string | null }[] }).entries;
    expect(entries.find((e) => e.action === 'USER_SUSPENDED')?.venueId).toBeNull();
  });
});
