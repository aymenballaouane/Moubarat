/* Abonnement SaaS minimal (C1/CE11, audit produit 21/09/2026, item 6 de la feuille de route
   post-audit) : plan/échéance/statut payé-impayé, superadmin uniquement, aucune coupure d'accès. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

let stack: TestStack;
let seed: SeedResult;
let superToken = '', ordinaryToken = '', hamid = '', sofiane = '';

async function patchSub(token: string | null, body: unknown, venueId = seed.venueId) {
  return stack.app.inject({
    method: 'PATCH', url: `/platform/venues/${venueId}/subscription`,
    ...(token ? { headers: bearer(token) } : {}), payload: body as Record<string, unknown>,
  });
}
async function auditRows() {
  return stack.db.selectFrom('audit_log').selectAll()
    .where('venue_id', '=', seed.venueId).where('action', '=', 'CENTER_SUBSCRIPTION_UPDATED').orderBy('at', 'asc').execute();
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await createPlatformAccount(stack.db, { email: 'super.sub@moubarat.test', password: 'SuperSubPass9!', name: 'Super Sub', isSuperadmin: true });
  await createPlatformAccount(stack.db, { email: 'ordinaire.sub@moubarat.test', password: 'OrdinaireSubPass9!', name: 'Compte ordinaire' });
  superToken = await loginAsPlatform(stack, 'super.sub@moubarat.test', 'SuperSubPass9!');
  ordinaryToken = await loginAsPlatform(stack, 'ordinaire.sub@moubarat.test', 'OrdinaireSubPass9!');
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword); // OWNER
  sofiane = await loginAs(stack, seed.phones.sofiane); // joueur
});
afterAll(() => stack.teardown());

describe('défauts — un centre existant (pilote compris) n’est jamais signalé impayé par la seule migration', () => {
  it('CRM_ONLY / PAID / aucune échéance dès la création', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/platform/venues/${seed.venueId}`, headers: bearer(superToken) });
    const v = (res.json() as { venue: { subscriptionPlan: string; subscriptionStatus: string; subscriptionDueAt: string | null } }).venue;
    expect(v).toMatchObject({ subscriptionPlan: 'CRM_ONLY', subscriptionStatus: 'PAID', subscriptionDueAt: null });
  });

  it('visible aussi dans la liste des centres (répond au vrai besoin : qui est à jour, sans ouvrir chaque fiche)', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/platform/venues', headers: bearer(superToken) });
    const rows = (res.json() as { venues: { id: string; subscriptionStatus: string }[] }).venues;
    expect(rows.find((r) => r.id === seed.venueId)?.subscriptionStatus).toBe('PAID');
  });
});

describe('PATCH /platform/venues/:venueId/subscription — superadmin uniquement', () => {
  it('modifie plan/status/dueAt ; la valeur survit à une relecture indépendante', async () => {
    const res = await patchSub(superToken, { plan: 'CRM_PLUS_APP', status: 'UNPAID', dueAt: '2026-10-01T00:00:00.000Z' });
    expect(res.statusCode, res.body).toBe(200);
    const v = (res.json() as { venue: { subscriptionPlan: string; subscriptionStatus: string; subscriptionDueAt: string } }).venue;
    expect(v.subscriptionPlan).toBe('CRM_PLUS_APP');
    expect(v.subscriptionStatus).toBe('UNPAID');
    expect(new Date(v.subscriptionDueAt).toISOString()).toBe('2026-10-01T00:00:00.000Z');

    const reread = await stack.app.inject({ method: 'GET', url: `/platform/venues/${seed.venueId}`, headers: bearer(superToken) });
    const reread_v = (reread.json() as { venue: { subscriptionPlan: string; subscriptionStatus: string } }).venue;
    expect(reread_v).toMatchObject({ subscriptionPlan: 'CRM_PLUS_APP', subscriptionStatus: 'UNPAID' });
  });

  it('journalise (venueId posé, avant/après), jamais de montant ni de facture dans le résumé', async () => {
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const e = rows[0]!;
    expect(e.actor_role).toBe('SUPERADMIN');
    expect(e.summary).toBe('a modifié l’abonnement du centre');
    expect(JSON.parse(e.before_val!)).toEqual({ plan: 'CRM_ONLY', status: 'PAID', dueAt: null });
    expect(JSON.parse(e.after_val!).status).toBe('UNPAID');
  });

  it('dueAt effacé (null) accepté explicitement', async () => {
    const res = await patchSub(superToken, { dueAt: null });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { venue: { subscriptionDueAt: string | null } }).venue.subscriptionDueAt).toBeNull();
  });

  it.each([
    ['plan invalide', { plan: 'GRATUIT' }],
    ['status invalide', { status: 'PARTIEL' }],
    ['dueAt invalide', { dueAt: 'pas-une-date' }],
    ['corps vide', {}],
    ['champ inconnu seul', { montant: 5000 }],
  ])('refuse : %s → 400', async (_label, body) => {
    expect((await patchSub(superToken, body)).statusCode).toBe(400);
  });

  it('centre inconnu → 404 ; identifiant malformé → 400', async () => {
    expect((await patchSub(superToken, { status: 'PAID' }, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await patchSub(superToken, { status: 'PAID' }, 'pas-un-uuid')).statusCode).toBe(400);
  });

  it('réservé au superadmin : compte ordinaire, OWNER du centre, joueur et anonyme refusés, rien n’est écrit', async () => {
    const before = await auditRows();
    expect((await patchSub(ordinaryToken, { status: 'UNPAID' })).statusCode).toBe(403);
    expect((await patchSub(hamid, { status: 'UNPAID' })).statusCode).toBe(403);
    expect((await patchSub(sofiane, { status: 'UNPAID' })).statusCode).toBe(401);
    expect((await patchSub(null, { status: 'UNPAID' })).statusCode).toBe(401);
    expect(await auditRows()).toHaveLength(before.length);
  });

  it('le gérant ne peut PAS modifier l’abonnement de son propre centre depuis le CRM (aucune route)', async () => {
    const res = await stack.app.inject({ method: 'PATCH', url: `/venues/${seed.venueId}/subscription`, headers: bearer(hamid), payload: { status: 'PAID' } });
    expect(res.statusCode).toBe(404); // aucune route CRM de ce nom — jamais construite volontairement
  });
});

describe('CRM (/platform/auth/login, /platform/auth/me) — le gérant voit l’abonnement de son centre', () => {
  it('login et me renvoient le même statut, jamais via GET /venues/:id (public, sans auth)', async () => {
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: seed.crmStaffEmails.hamid, password: seed.crmStaffPassword },
    });
    const loginMemberships = (login.json() as { centerMemberships: { venueId: string; subscriptionStatus: string; subscriptionDueAt: string | null }[] }).centerMemberships;
    const mine = loginMemberships.find((m) => m.venueId === seed.venueId);
    expect(mine?.subscriptionStatus).toBe('UNPAID');

    const me = await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(hamid) });
    const meMemberships = (me.json() as { centerMemberships: { venueId: string; subscriptionStatus: string }[] }).centerMemberships;
    expect(meMemberships.find((m) => m.venueId === seed.venueId)?.subscriptionStatus).toBe('UNPAID');

    // Jamais fuité côté joueur/public — GET /venues/:id ne porte AUCUN champ subscription*.
    const publicVenue = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect(publicVenue.body).not.toContain('subscription');
  });
});
