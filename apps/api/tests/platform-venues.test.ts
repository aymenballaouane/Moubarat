import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, makeVenuePublishable, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* SUPERADMIN V1, étape 3 — workflow de validation d'un centre. Le serveur est
   l'autorité : chaque transition repasse par venueStatusTransition (core),
   jamais supposée correcte parce que le bouton existe. */

async function platformLogin(stack: TestStack, email: string, password: string): Promise<string> {
  const r = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`Connexion refusée (${r.statusCode}) : ${r.body}`);
  return (r.json() as { token: string }).token;
}

describe('SUPERADMIN V1 — workflow de validation des centres', () => {
  let stack: TestStack;
  let superToken: string;
  let ordinaryToken: string;

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, {
      email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true,
    });
    await createPlatformAccount(stack.db, {
      email: 'ordinaire@moubarat.test', password: 'OrdinairePass9!', name: 'Compte plateforme ordinaire',
    });
    superToken = await platformLogin(stack, 'admin@moubarat.test', 'CorrectHorseBattery9!');
    ordinaryToken = await platformLogin(stack, 'ordinaire@moubarat.test', 'OrdinairePass9!');
  });
  afterAll(() => stack.teardown());

  async function createVenue(name: string) {
    const r = await stack.app.inject({
      method: 'POST', url: '/platform/venues',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name, wilaya: 'Alger', address: 'Adresse test', lat: 36.7, lng: 3.0 },
    });
    expect(r.statusCode, r.body).toBe(201);
    return (r.json() as { venue: { id: string; status: string } }).venue;
  }

  it('création : statut toujours PENDING, jamais pré-activé', async () => {
    const v = await createVenue('Terrain Test A');
    expect(v.status).toBe('PENDING');
  });

  it('un nouveau centre PENDING est invisible sur GET /venues (Player)', async () => {
    const v = await createVenue('Terrain Test — invisible');
    const list = await stack.app.inject({ method: 'GET', url: '/venues' });
    const names = (list.json() as { venues: { id: string }[] }).venues.map((x) => x.id);
    expect(names).not.toContain(v.id);
  });

  it('approuver rend le centre visible sur GET /venues (Player) — bout en bout', async () => {
    const v = await createVenue('Terrain Test — approuvé');
    await makeVenuePublishable(stack.db, v.id); // A9 : un centre vide ne peut pas être validé
    const approve = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${v.id}/approve`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect((approve.json() as { venue: { status: string } }).venue.status).toBe('ACTIVE');

    const list = await stack.app.inject({ method: 'GET', url: '/venues' });
    const ids = (list.json() as { venues: { id: string }[] }).venues.map((x) => x.id);
    expect(ids).toContain(v.id);
  });

  it('transition invalide refusée par le serveur (ACTIVE → REJECTED impossible)', async () => {
    const v = await createVenue('Terrain Test — transition invalide');
    await makeVenuePublishable(stack.db, v.id);
    await stack.app.inject({
      method: 'POST', url: `/platform/venues/${v.id}/approve`, headers: { authorization: `Bearer ${superToken}` },
    });
    const badReject = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${v.id}/reject`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect(badReject.statusCode).toBe(409);
    expect(badReject.json()).toMatchObject({ error: 'INVALID_TRANSITION' });
  });

  it('cycle complet : PENDING → REJECTED (terminal), puis suspend/reactivate sur un centre actif', async () => {
    const rejected = await createVenue('Terrain Test — rejeté');
    const reject = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${rejected.id}/reject`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect((reject.json() as { venue: { status: string } }).venue.status).toBe('REJECTED');
    const reapprove = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${rejected.id}/approve`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect(reapprove.statusCode).toBe(409); // REJECTED est terminal en V1

    const active = await createVenue('Terrain Test — suspend/reactivate');
    await makeVenuePublishable(stack.db, active.id);
    await stack.app.inject({
      method: 'POST', url: `/platform/venues/${active.id}/approve`, headers: { authorization: `Bearer ${superToken}` },
    });
    const suspend = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${active.id}/suspend`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect((suspend.json() as { venue: { status: string } }).venue.status).toBe('SUSPENDED');
    const listWhileSuspended = await stack.app.inject({ method: 'GET', url: '/venues' });
    expect((listWhileSuspended.json() as { venues: { id: string }[] }).venues.map((x) => x.id)).not.toContain(active.id);

    const reactivate = await stack.app.inject({
      method: 'POST', url: `/platform/venues/${active.id}/reactivate`, headers: { authorization: `Bearer ${superToken}` },
    });
    expect((reactivate.json() as { venue: { status: string } }).venue.status).toBe('ACTIVE');
  });

  it('non-superadmin : 403 sur toutes les routes /platform/venues', async () => {
    const v = await createVenue('Terrain Test — permissions');
    const auth = { authorization: `Bearer ${ordinaryToken}` };
    const list = await stack.app.inject({ method: 'GET', url: '/platform/venues', headers: auth });
    expect(list.statusCode).toBe(403);
    const approve = await stack.app.inject({ method: 'POST', url: `/platform/venues/${v.id}/approve`, headers: auth });
    expect(approve.statusCode).toBe(403);
    const create = await stack.app.inject({
      method: 'POST', url: '/platform/venues', headers: auth,
      payload: { name: 'x', wilaya: 'x', address: 'x', lat: 1, lng: 1 },
    });
    expect(create.statusCode).toBe(403);
  });

  it('centre introuvable : 404, pas un 500', async () => {
    const r = await stack.app.inject({
      method: 'POST', url: '/platform/venues/00000000-0000-0000-0000-000000000000/approve',
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it('liste plateforme : tous statuts confondus, avec fieldCount', async () => {
    const r = await stack.app.inject({ method: 'GET', url: '/platform/venues', headers: { authorization: `Bearer ${superToken}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { venues: { status: string }[] };
    const statuses = new Set(body.venues.map((v) => v.status));
    expect(statuses.has('PENDING')).toBe(true);
    expect(statuses.has('ACTIVE')).toBe(true);
  });

  it('détail centre : tarifs PAR FORMAT (formatPrices), plus le tarif unique périmé du terrain', async () => {
    const v = await createVenue('Terrain Test — tarifs par format');
    const f = await stack.db.insertInto('fields').values({
      venue_id: v.id, name: 'T1', sport: 'FOOTBALL', formats: ['5v5', '6v6'], hourly_rate_da: 1, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    await stack.db.insertInto('field_format_prices').values([
      { field_id: f.id, format: '5v5', hourly_rate_da: 3000 }, { field_id: f.id, format: '6v6', hourly_rate_da: 3600 },
    ]).execute();
    const r = await stack.app.inject({ method: 'GET', url: `/platform/venues/${v.id}`, headers: { authorization: `Bearer ${superToken}` } });
    expect(r.statusCode, r.body).toBe(200);
    const field = (r.json() as { venue: { fields: { formatPrices: { format: string; hourlyRateDa: number }[]; hourlyRateDa?: number }[] } }).venue.fields[0]!;
    expect(field.formatPrices).toEqual([{ format: '5v5', hourlyRateDa: 3000 }, { format: '6v6', hourlyRateDa: 3600 }]);
    expect(field.hourlyRateDa).toBeUndefined();
  });
});
