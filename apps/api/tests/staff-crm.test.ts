import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* Écran Équipe du CRM (22/09/2026, audit produit CR1/CR6/CR10/CR11/CR14/CR15) — un OWNER gère désormais son
   propre personnel sans passer par le superadmin. Réutilise le centre/comptes du seed : hamid (OWNER),
   yacine (MANAGER), nadia (RECEPTION), amine (STAFF). */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);
});
afterAll(() => stack.teardown());

const staffUrl = (v = seed.venueId) => `/venues/${v}/staff`;

describe('CR1 — GET /venues/:venueId/staff (lecture, VIEW_PLANNING = les 4 rôles)', () => {
  it('OWNER, MANAGER, RECEPTION et STAFF voient tous la liste', async () => {
    for (const token of [hamid, yacine, nadia, amine]) {
      const res = await stack.app.inject({ method: 'GET', url: staffUrl(), headers: bearer(token) });
      expect(res.statusCode, token).toBe(200);
      const staff = (res.json() as { staff: { email: string; role: string }[] }).staff;
      expect(staff.length).toBeGreaterThanOrEqual(4);
      expect(staff.some((s) => s.role === 'OWNER')).toBe(true);
    }
  });

  it('un compte non rattaché à ce centre : 403, jamais une liste vide silencieuse', async () => {
    const res = await stack.app.inject({ method: 'GET', url: staffUrl('00000000-0000-4000-8000-000000000000'), headers: bearer(hamid) });
    expect(res.statusCode).toBe(403);
  });

  it('anonyme : 401', async () => {
    expect((await stack.app.inject({ method: 'GET', url: staffUrl() })).statusCode).toBe(401);
  });
});

describe('CR1 — POST /venues/:venueId/staff (créer/rattacher, MANAGE_STAFF = OWNER seul)', () => {
  it('OWNER crée un compte pour SON centre : mot de passe généré, journalisé avec actorRole=OWNER', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: staffUrl(), headers: bearer(hamid),
      payload: { email: 'nouveau.staff@centre-a.test', name: 'Nouveau Staff', role: 'STAFF' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { account: { id: string }; temporaryPassword: string };
    expect(body.temporaryPassword).toBeTruthy();
    const audit = await stack.db.selectFrom('audit_log').select(['actor_role', 'venue_id']).where('object_id', '=', body.account.id).executeTakeFirstOrThrow();
    expect(audit.actor_role).toBe('OWNER');
    expect(audit.venue_id).toBe(seed.venueId);
  });

  it('MANAGER, RECEPTION, STAFF : 403 (MANAGE_STAFF réservée à OWNER par le cœur), rien n’est créé', async () => {
    for (const token of [yacine, nadia, amine]) {
      const res = await stack.app.inject({
        method: 'POST', url: staffUrl(), headers: bearer(token),
        payload: { email: `refuse-${token.slice(0, 4)}@centre-a.test`, name: 'Refusé', role: 'STAFF' },
      });
      expect(res.statusCode, token).toBe(403);
    }
  });

  it('un OWNER ne peut PAS créer pour un AUTRE centre auquel il n’est pas rattaché : 403', async () => {
    const other = await stack.db.insertInto('venues').values({
      name: 'Autre Centre CRM Staff', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const res = await stack.app.inject({
      method: 'POST', url: staffUrl(other.id), headers: bearer(hamid),
      payload: { email: 'intrusion@autre.test', name: 'Intrusion', role: 'STAFF' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('CR10/CR11 — PATCH /venues/:venueId/staff/:accountId (changer de rôle, transfert OWNER)', () => {
  it('OWNER promeut un STAFF vers MANAGER', async () => {
    const res = await stack.app.inject({
      method: 'PATCH', url: `${staffUrl()}/${seed.crmStaff.amine}`, headers: bearer(hamid), payload: { role: 'MANAGER' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { role: string }).role).toBe('MANAGER');
    const row = await stack.db.selectFrom('center_staff').select('role').where('venue_id', '=', seed.venueId).where('user_id', '=', seed.crmStaff.amine).executeTakeFirstOrThrow();
    expect(row.role).toBe('MANAGER');
    const audit = await stack.db.selectFrom('audit_log').selectAll().where('object_id', '=', seed.crmStaff.amine).where('action', '=', 'STAFF_ROLE_CHANGED').executeTakeFirstOrThrow();
    expect(audit.before_val).toBe('STAFF');
    expect(audit.after_val).toBe('MANAGER');
    expect(audit.actor_role).toBe('OWNER');
  });

  it('transfert de propriété : promouvoir un MANAGER vers OWNER — plusieurs OWNER coexistent, aucune opération spéciale', async () => {
    // Stack ISOLÉ (comme CR14 plus bas) : promouvoir yacine en OWNER ici ne doit JAMAIS affecter les
    // tests suivants de ce fichier, qui comptent sur yacine restant MANAGER sur le stack partagé.
    const stack2 = await setupTestStack();
    const seed2 = await seedDemo(stack2.db);
    const h2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.hamid, seed2.crmStaffPassword);
    try {
      const res = await stack2.app.inject({
        method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.yacine}`, headers: bearer(h2), payload: { role: 'OWNER' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const owners = await stack2.db.selectFrom('center_staff').select('user_id').where('venue_id', '=', seed2.venueId).where('role', '=', 'OWNER').execute();
      expect(owners.length).toBeGreaterThanOrEqual(2);
    } finally {
      await stack2.teardown();
    }
  });

  it('MANAGER ne peut pas changer de rôle (403)', async () => {
    const res = await stack.app.inject({
      method: 'PATCH', url: `${staffUrl()}/${seed.crmStaff.nadia}`, headers: bearer(yacine), payload: { role: 'STAFF' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rôle invalide : 400 ; compte d’un autre centre : 404', async () => {
    expect((await stack.app.inject({ method: 'PATCH', url: `${staffUrl()}/${seed.crmStaff.nadia}`, headers: bearer(hamid), payload: { role: 'PATRON' } })).statusCode).toBe(400);
    expect((await stack.app.inject({ method: 'PATCH', url: `${staffUrl()}/00000000-0000-4000-8000-000000000000`, headers: bearer(hamid), payload: { role: 'STAFF' } })).statusCode).toBe(404);
  });
});

describe('CR14 — garde « dernier OWNER »', () => {
  it('rétrograder le seul OWNER actif : 409 LAST_OWNER, rôle inchangé', async () => {
    // Sur ce centre de test frais, seul hamid est OWNER.
    const stack2 = await setupTestStack();
    const seed2 = await seedDemo(stack2.db);
    const h2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.hamid, seed2.crmStaffPassword);
    try {
      const res = await stack2.app.inject({
        method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.hamid}`, headers: bearer(h2), payload: { role: 'MANAGER' },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('LAST_OWNER');
      const row = await stack2.db.selectFrom('center_staff').select('role').where('venue_id', '=', seed2.venueId).where('user_id', '=', seed2.crmStaff.hamid).executeTakeFirstOrThrow();
      expect(row.role).toBe('OWNER');
    } finally {
      await stack2.teardown();
    }
  });

  it('un DEUXIÈME OWNER actif présent : rétrograder le premier passe ; retirer le second (devenu seul) échoue ensuite', async () => {
    const stack2 = await setupTestStack();
    const seed2 = await seedDemo(stack2.db);
    const h2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.hamid, seed2.crmStaffPassword);
    try {
      await stack2.app.inject({ method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.yacine}`, headers: bearer(h2), payload: { role: 'OWNER' } });
      const demote = await stack2.app.inject({ method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.hamid}`, headers: bearer(h2), payload: { role: 'STAFF' } });
      expect(demote.statusCode, demote.body).toBe(200);

      const y2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.yacine, seed2.crmStaffPassword);
      const removeLast = await stack2.app.inject({ method: 'DELETE', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.yacine}`, headers: bearer(y2) });
      expect(removeLast.statusCode).toBe(409);
      expect((removeLast.json() as { error: string }).error).toBe('LAST_OWNER');
    } finally {
      await stack2.teardown();
    }
  });

  it('un OWNER suspendu ne compte pas comme « actif » : rétrograder l’OWNER restant reste bloqué même si un autre OWNER existe mais est suspendu', async () => {
    const stack2 = await setupTestStack();
    const seed2 = await seedDemo(stack2.db);
    const h2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.hamid, seed2.crmStaffPassword);
    try {
      await stack2.app.inject({ method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.yacine}`, headers: bearer(h2), payload: { role: 'OWNER' } });
      await stack2.db.updateTable('platform_accounts').set({ status: 'SUSPENDED' }).where('id', '=', seed2.crmStaff.yacine).execute();
      const demote = await stack2.app.inject({ method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.hamid}`, headers: bearer(h2), payload: { role: 'STAFF' } });
      expect(demote.statusCode).toBe(409);
    } finally {
      await stack2.teardown();
    }
  });
});

describe('CR6 — DELETE /venues/:venueId/staff/:accountId (retirer de CE centre, jamais le compte plateforme)', () => {
  it('OWNER retire un STAFF : ligne center_staff supprimée, compte plateforme INCHANGÉ (toujours ACTIVE)', async () => {
    const res = await stack.app.inject({ method: 'DELETE', url: `${staffUrl()}/${seed.crmStaff.amine}`, headers: bearer(hamid) });
    expect(res.statusCode).toBe(204);
    const link = await stack.db.selectFrom('center_staff').select('role').where('venue_id', '=', seed.venueId).where('user_id', '=', seed.crmStaff.amine).executeTakeFirst();
    expect(link).toBeUndefined();
    const account = await stack.db.selectFrom('platform_accounts').select('status').where('id', '=', seed.crmStaff.amine).executeTakeFirstOrThrow();
    expect(account.status).toBe('ACTIVE');
  });

  it('CR6, auto-retrait autorisé : un OWNER non-dernier peut se retirer lui-même', async () => {
    const stack2 = await setupTestStack();
    const seed2 = await seedDemo(stack2.db);
    const h2 = await loginAsPlatform(stack2, seed2.crmStaffEmails.hamid, seed2.crmStaffPassword);
    try {
      await stack2.app.inject({ method: 'PATCH', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.yacine}`, headers: bearer(h2), payload: { role: 'OWNER' } });
      const selfRemove = await stack2.app.inject({ method: 'DELETE', url: `/venues/${seed2.venueId}/staff/${seed2.crmStaff.hamid}`, headers: bearer(h2) });
      expect(selfRemove.statusCode).toBe(204);
    } finally {
      await stack2.teardown();
    }
  });

  it('MANAGER ne peut pas retirer (403) ; compte d’un autre centre : 404', async () => {
    expect((await stack.app.inject({ method: 'DELETE', url: `${staffUrl()}/${seed.crmStaff.nadia}`, headers: bearer(yacine) })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'DELETE', url: `${staffUrl()}/00000000-0000-4000-8000-000000000000`, headers: bearer(hamid) })).statusCode).toBe(404);
  });
});

describe('CR15 — POST /venues/:venueId/staff/:accountId/unlock (lever le verrou SANS régénérer le mot de passe)', () => {
  it('OWNER déverrouille : verrou levé, mot de passe et sessions ouvertes INCHANGÉS', async () => {
    const nadiaToken = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
    const before = await stack.db.selectFrom('platform_accounts').select('password_hash').where('id', '=', seed.crmStaff.nadia).executeTakeFirstOrThrow();
    await stack.db.updateTable('platform_accounts').set({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 3_600_000) }).where('id', '=', seed.crmStaff.nadia).execute();

    const res = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${seed.crmStaff.nadia}/unlock`, headers: bearer(hamid) });
    expect(res.statusCode, res.body).toBe(200);

    const after = await stack.db.selectFrom('platform_accounts').select(['password_hash', 'failed_login_attempts', 'locked_until']).where('id', '=', seed.crmStaff.nadia).executeTakeFirstOrThrow();
    expect(after.password_hash).toBe(before.password_hash); // mot de passe inchangé
    expect(after.failed_login_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
    // La session ouverte AVANT le déverrouillage reste valide (jamais révoquée, contrairement au reset).
    expect((await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(nadiaToken) })).statusCode).toBe(200);

    const audit = await stack.db.selectFrom('audit_log').selectAll().where('object_id', '=', seed.crmStaff.nadia).where('action', '=', 'STAFF_UNLOCKED').executeTakeFirstOrThrow();
    expect(audit.summary).not.toMatch(/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/); // aucun mot de passe dans le résumé
  });

  it('compte déjà déverrouillé : 200 quand même, aucune erreur', async () => {
    const res = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${seed.crmStaff.nadia}/unlock`, headers: bearer(hamid) });
    expect(res.statusCode).toBe(200);
  });

  it('MANAGER ne peut pas déverrouiller (403)', async () => {
    const res = await stack.app.inject({ method: 'POST', url: `${staffUrl()}/${seed.crmStaff.nadia}/unlock`, headers: bearer(yacine) });
    expect(res.statusCode).toBe(403);
  });
});

describe('isolation entre centres — toutes les routes de ce fichier', () => {
  it('un OWNER du centre A ne peut agir sur AUCUNE route staff d’un centre B (403 partout)', async () => {
    const other = await stack.db.insertInto('venues').values({
      name: 'Centre B Isolation Staff', wilaya: 'Oran', address: 'x', lat: 35.7, lng: -0.64, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const b = staffUrl(other.id);
    expect((await stack.app.inject({ method: 'GET', url: b, headers: bearer(hamid) })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'POST', url: b, headers: bearer(hamid), payload: { email: 'x@y.test', name: 'X', role: 'STAFF' } })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'PATCH', url: `${b}/${seed.crmStaff.nadia}`, headers: bearer(hamid), payload: { role: 'STAFF' } })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'DELETE', url: `${b}/${seed.crmStaff.nadia}`, headers: bearer(hamid) })).statusCode).toBe(403);
    expect((await stack.app.inject({ method: 'POST', url: `${b}/${seed.crmStaff.nadia}/unlock`, headers: bearer(hamid) })).statusCode).toBe(403);
  });
});
