import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD_MAX_ATTEMPTS } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Audit pré-lancement, lot 6 (27/09/2026) — ONB-1 : un compte plateforme change LUI-MÊME son mot de passe ;
   ONB-2 : le CRM lit « prêt à publier » de son centre et le gérant signale à Moubarat que c'est prêt. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '', amine = '', sofiane = '', admin = '';
const ADMIN_EMAIL = 'admin-lot6@moubarat.test';
const ADMIN_PASSWORD = 'CorrectHorseBattery9!';

/** `code` = le code d'erreur de l'API (`{ error, message, details? }`), aplati pour les assertions. */
function shape(res: { statusCode: number; json(): unknown }) {
  const body = res.json() as Record<string, unknown>;
  return { status: res.statusCode, body, code: body.error as string | undefined, details: body.details };
}
async function post(token: string, url: string, payload: Record<string, unknown> = {}) {
  return shape(await stack.app.inject({ method: 'POST', url, headers: bearer(token), payload }));
}
async function get(token: string, url: string) {
  return shape(await stack.app.inject({ method: 'GET', url, headers: bearer(token) }));
}
async function login(email: string, password: string) {
  return stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF
  sofiane = await loginAs(stack, seed.phones.sofiane);
  await createPlatformAccount(stack.db, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Admin lot 6', isSuperadmin: true });
  admin = await loginAsPlatform(stack, ADMIN_EMAIL, ADMIN_PASSWORD);
});
afterAll(async () => { await stack.teardown(); });

describe('ONB-1 — POST /platform/me/password', () => {
  const NEW = 'NouveauMotDePasse2026!';

  it('refus : champs manquants (400), trop court (400 PASSWORD_TOO_SHORT), identique (400 PASSWORD_UNCHANGED), joueur (401)', async () => {
    expect((await post(nadia, '/platform/me/password', { currentPassword: seed.crmStaffPassword })).status).toBe(400);
    const short = await post(nadia, '/platform/me/password', { currentPassword: seed.crmStaffPassword, newPassword: 'court' });
    expect(short.status).toBe(400);
    expect(short.code).toBe('PASSWORD_TOO_SHORT');
    const same = await post(nadia, '/platform/me/password', { currentPassword: seed.crmStaffPassword, newPassword: seed.crmStaffPassword });
    expect(same.status).toBe(400);
    expect(same.code).toBe('PASSWORD_UNCHANGED');
    expect((await post(sofiane, '/platform/me/password', { currentPassword: 'x', newPassword: NEW })).status).toBe(401);
  });

  it('mot de passe actuel faux : 403 INVALID_CURRENT_PASSWORD (jamais 401), compte comme un échec de connexion — verrou après 5', async () => {
    for (let i = 0; i < PASSWORD_MAX_ATTEMPTS; i++) {
      const r = await post(amine, '/platform/me/password', { currentPassword: 'pas-le-bon-mot-de-passe', newPassword: NEW });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.code).toBe('INVALID_CURRENT_PASSWORD');
    }
    const locked = await post(amine, '/platform/me/password', { currentPassword: seed.crmStaffPassword, newPassword: NEW });
    expect(locked.status).toBe(429);
    expect(locked.code).toBe('LOGIN_LOCKED');
    // Le même verrou que /login : le compte ne peut plus non plus se connecter pendant le verrou.
    expect((await login(seed.crmStaffEmails.amine, seed.crmStaffPassword)).statusCode).toBe(429);
    // Rien n'a changé : l'ancien mot de passe reste le bon (vérifié après déverrouillage en base).
    await stack.db.updateTable('platform_accounts').set({ failed_login_attempts: 0, locked_until: null })
      .where('email', '=', seed.crmStaffEmails.amine).execute();
    expect((await login(seed.crmStaffEmails.amine, seed.crmStaffPassword)).statusCode).toBe(200);
  });

  it('succès : l’ancien mot de passe ne connecte plus, le nouveau oui ; les AUTRES sessions sont fermées, la courante reste ; journal du centre', async () => {
    const other = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // un second poste
    expect((await get(other, '/platform/auth/me')).status).toBe(200);

    const r = await post(hamid, '/platform/me/password', { currentPassword: seed.crmStaffPassword, newPassword: NEW });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.revokedSessions).toBe(1);

    expect((await get(other, '/platform/auth/me')).status).toBe(401); // le second poste est déconnecté
    expect((await get(hamid, '/platform/auth/me')).status).toBe(200); // la session qui a changé le mot de passe vit
    expect((await login(seed.crmStaffEmails.hamid, seed.crmStaffPassword)).statusCode).toBe(401);
    expect((await login(seed.crmStaffEmails.hamid, NEW)).statusCode).toBe(200);

    const rows = await stack.db.selectFrom('audit_log').selectAll()
      .where('action', '=', 'PLATFORM_PASSWORD_CHANGED').where('object_id', '=', seed.crmStaff.hamid).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.venue_id).toBe(seed.venueId);
    expect(rows[0]!.actor_role).toBe('OWNER');
    expect(rows[0]!.summary).toContain('1 autre session fermée');
    expect(rows[0]!.summary).not.toContain(NEW);
    // Visible dans le Journal du centre (VIEW_AUDIT_LOG).
    const journal = await get(hamid, `/venues/${seed.venueId}/audit-log`);
    expect(journal.status).toBe(200);
    expect(JSON.stringify(journal.body)).toContain('a changé son mot de passe');
  });

  it('superadmin sans centre : une ligne plateforme, visible dans GET /platform/audit-log', async () => {
    const r = await post(admin, '/platform/me/password', { currentPassword: ADMIN_PASSWORD, newPassword: NEW });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const log = await get(admin, '/platform/audit-log?action=PLATFORM_PASSWORD_CHANGED');
    expect(log.status).toBe(200);
    const entries = log.body.entries as { objectId: string; venueId: string | null; actorRole: string }[];
    const mine = entries.find((e) => e.actorRole === 'SUPERADMIN');
    expect(mine).toBeDefined();
    expect(mine!.venueId).toBeNull();
  });
});

describe('ONB-2 — GET /venues/:id/readiness et POST /venues/:id/ready-signal', () => {
  it('readiness : tout le personnel lit (STAFF inclus), un joueur non ; statut + points bloquants ET recommandés + readySignaledAt', async () => {
    const r = await get(amine, `/venues/${seed.venueId}/readiness`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('ACTIVE');
    const readiness = r.body.readiness as { ready: boolean; checks: { code: string; blocking: boolean }[] };
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.map((c) => c.code)).toEqual(['ACTIVE_FIELD', 'FIELD_PRICES', 'OPENING_HOURS', 'MANAGER', 'PHONE']);
    expect(r.body.readySignaledAt).toBeNull();
    expect((await get(sofiane, `/venues/${seed.venueId}/readiness`)).status).toBe(401);
    // La route publique, elle, ne dit toujours rien du statut plateforme.
    const pub = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect(JSON.stringify(pub.json())).not.toContain('readiness');
  });

  it('signal : centre ACTIF → 409 VENUE_NOT_PENDING ; RECEPTION → 403 ; en attente et prêt → journalisé, visible partout, puis 409 ALREADY_SIGNALED', async () => {
    const active = await post(hamid, `/venues/${seed.venueId}/ready-signal`);
    expect(active.status).toBe(409);
    expect(active.code).toBe('VENUE_NOT_PENDING');

    await stack.db.updateTable('venues').set({ status: 'PENDING' }).where('id', '=', seed.venueId).execute();
    expect((await post(nadia, `/venues/${seed.venueId}/ready-signal`)).status).toBe(403);

    const ok = await post(hamid, `/venues/${seed.venueId}/ready-signal`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const rd = await get(hamid, `/venues/${seed.venueId}/readiness`);
    expect(rd.body.status).toBe('PENDING');
    expect(rd.body.readySignaledAt).toBeTypeOf('string');

    const journal = await get(hamid, `/venues/${seed.venueId}/audit-log`);
    expect(JSON.stringify(journal.body)).toContain('prêt à être publié');
    const platformLog = await get(admin, '/platform/audit-log?action=VENUE_READY_SIGNALED');
    const entries = platformLog.body.entries as { venueId: string | null; actorRole: string }[];
    expect(entries.some((e) => e.venueId === seed.venueId && e.actorRole === 'OWNER')).toBe(true);
    const detail = await get(admin, `/platform/venues/${seed.venueId}`);
    expect((detail.body.venue as { readySignaledAt: string | null }).readySignaledAt).toBeTypeOf('string');
    const list = await get(admin, '/platform/venues');
    const mine = (list.body.venues as { id: string; readySignaledAt: string | null }[]).find((v) => v.id === seed.venueId)!;
    expect(mine.readySignaledAt).toBeTypeOf('string');

    const again = await post(hamid, `/venues/${seed.venueId}/ready-signal`);
    expect(again.status).toBe(409);
    expect(again.code).toBe('ALREADY_SIGNALED');
  });

  it('signal refusé tant qu’un point bloquant manque (409 VENUE_NOT_READY, mêmes points que la validation)', async () => {
    const saved = await stack.db.selectFrom('opening_hours').selectAll().where('venue_id', '=', seed.venueId).execute();
    await stack.db.deleteFrom('opening_hours').where('venue_id', '=', seed.venueId).execute();
    await stack.db.deleteFrom('audit_log').where('action', '=', 'VENUE_READY_SIGNALED').where('venue_id', '=', seed.venueId).execute();
    try {
      const r = await post(hamid, `/venues/${seed.venueId}/ready-signal`);
      expect(r.status).toBe(409);
      expect(r.code).toBe('VENUE_NOT_READY');
      expect((r.details as { checks: { code: string; ok: boolean }[] }).checks.find((c) => c.code === 'OPENING_HOURS')!.ok).toBe(false);
      const rd = await get(hamid, `/venues/${seed.venueId}/readiness`);
      expect((rd.body.readiness as { ready: boolean }).ready).toBe(false);
    } finally {
      await stack.db.insertInto('opening_hours').values(saved).execute();
      await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
    }
  });
});
