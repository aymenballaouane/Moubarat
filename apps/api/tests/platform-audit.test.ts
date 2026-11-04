import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, bearer, makeVenuePublishable, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* SUPERADMIN V1, étape 6 — journal plateforme. Même audit_log que le CRM
   (décision Aymen §8) : ce test vérifie la LECTURE (filtre, résolution du
   nom d'acteur), pas une nouvelle écriture — les écritures sont déjà
   couvertes par les tests centres/utilisateurs. */

describe('SUPERADMIN V1 — journal (GET /platform/audit-log)', () => {
  let stack: TestStack;
  let superToken: string;
  let venueId = '';

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'Aymen (SUPERADMIN)', isSuperadmin: true,
    });
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!' },
    });
    superToken = (login.json() as { token: string }).token;

    const created = await stack.app.inject({
      method: 'POST', url: '/platform/venues', headers: bearer(superToken),
      payload: { name: 'Centre Audit Test', wilaya: 'Alger', address: 'x', lat: 1, lng: 1 },
    });
    venueId = (created.json() as { venue: { id: string } }).venue.id;
    await makeVenuePublishable(stack.db, venueId); // A9 : un centre vide ne peut pas être validé
    await stack.app.inject({ method: 'POST', url: `/platform/venues/${venueId}/approve`, headers: bearer(superToken) });
  });
  afterAll(() => stack.teardown());

  it('les actions récentes apparaissent, avec le nom réel de l’acteur résolu', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/audit-log', headers: bearer(superToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { entries: { action: string; actorName: string; objectId: string }[] };
    const created = body.entries.find((e) => e.action === 'CENTER_CREATED' && e.objectId === venueId);
    const approved = body.entries.find((e) => e.action === 'CENTER_APPROVED' && e.objectId === venueId);
    expect(created?.actorName).toBe('Aymen (SUPERADMIN)');
    expect(approved?.actorName).toBe('Aymen (SUPERADMIN)');
  });

  it('filtre par action', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/audit-log?action=CENTER_APPROVED', headers: bearer(superToken) });
    const body = r.json() as { entries: { action: string }[] };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.action === 'CENTER_APPROVED')).toBe(true);
  });

  it('recherche dans le résumé', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/audit-log?q=Audit%20Test', headers: bearer(superToken) });
    const body = r.json() as { entries: { summary: string }[] };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.summary.includes('Audit Test'))).toBe(true);
  });

  it('non-superadmin : 403', async () => {
    await createPlatformAccount(stack.db, { email: 'ord4@moubarat.test', password: 'OrdinaireDemo9!', name: 'Ordinaire' });
    const login = await stack.app.inject({
      method: 'POST', url: '/platform/auth/login', payload: { email: 'ord4@moubarat.test', password: 'OrdinaireDemo9!' },
    });
    const token = (login.json() as { token: string }).token;
    const r = await stack.app.inject({ method: 'GET', url: '/platform/audit-log', headers: bearer(token) });
    expect(r.statusCode).toBe(403);
  });
});
