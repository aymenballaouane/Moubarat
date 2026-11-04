/* A9 (24/09/2026, cadrage multi-centre/scalabilité §1.7) — garde de publication : un centre sans terrain actif
   tarifé ou sans horaires ne devient jamais visible dans l'app joueur. Trois niveaux testés : la règle pure,
   l'activation (approve/reactivate, console superadmin) et le catalogue public GET /venues. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, makeVenuePublishable, insertTestField, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { evaluateReadiness, notReadyMessage } from '../src/modules/venues/readiness.js';

const fld = (id: string, name: string, status: string | null = 'ACTIVE') => ({ id, name, status });
const hours = (start_min = 480, end_min = 1440) => [{ start_min, end_min }];

describe('evaluateReadiness — la règle pure', () => {
  const ok = { fields: [fld('a', 'T1')], pricedFieldIds: new Set(['a']), hours: hours() };

  it('terrain actif tarifé + horaires → prêt, sans aucune recommandation évaluée', () => {
    const r = evaluateReadiness(ok);
    expect(r.ready).toBe(true);
    expect(r.checks.map((c) => c.code)).toEqual(['ACTIVE_FIELD', 'FIELD_PRICES', 'OPENING_HOURS']);
  });

  it('aucun terrain : un seul point manque (pas de double comptage avec « tarif »)', () => {
    const r = evaluateReadiness({ ...ok, fields: [] });
    expect(r.ready).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.code)).toEqual(['ACTIVE_FIELD']);
  });

  it('maintenance et archivé ne comptent pas comme terrain actif ; statut nul = actif', () => {
    const inactive = { ...ok, fields: [fld('a', 'T1', 'MAINTENANCE'), fld('b', 'T2', 'ARCHIVED')] };
    expect(evaluateReadiness(inactive).ready).toBe(false);
    expect(evaluateReadiness({ ...ok, fields: [fld('a', 'T1', null)] }).ready).toBe(true);
  });

  it('un terrain actif sans tarif bloque, même si un autre est tarifé — le message nomme les terrains', () => {
    const r = evaluateReadiness({ ...ok, fields: [fld('a', 'T1'), fld('c', 'T3'), fld('b', 'T2')] });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.code === 'FIELD_PRICES')?.missing).toBe('tarif manquant : T2, T3');
  });

  it('un terrain archivé sans tarif ne bloque pas (il n\'est pas proposé)', () => {
    expect(evaluateReadiness({ ...ok, fields: [fld('a', 'T1'), fld('z', 'Ancien', 'ARCHIVED')] }).ready).toBe(true);
  });

  it('aucun horaire, ou une plage vide/inversée → bloque', () => {
    expect(evaluateReadiness({ ...ok, hours: [] }).ready).toBe(false);
    expect(evaluateReadiness({ ...ok, hours: hours(600, 600) }).ready).toBe(false);
    expect(evaluateReadiness({ ...ok, hours: hours(900, 600) }).ready).toBe(false);
    expect(evaluateReadiness({ ...ok, hours: [...hours(900, 600), ...hours(480, 1500)] }).ready).toBe(true); // une plage valide suffit
  });

  it('recommandés (gérant, téléphone) : listés quand évalués, jamais bloquants', () => {
    const r = evaluateReadiness({ ...ok, evaluateAdvisory: true, activeOwnerCount: 0, phone: null });
    expect(r.ready).toBe(true);
    expect(r.checks.filter((c) => !c.ok).map((c) => [c.code, c.blocking])).toEqual([['MANAGER', false], ['PHONE', false]]);
    const full = evaluateReadiness({ ...ok, evaluateAdvisory: true, activeOwnerCount: 1, phone: '+213555000000' });
    expect(full.checks.every((c) => c.ok)).toBe(true);
  });

  it('message de refus : seulement les points bloquants', () => {
    const r = evaluateReadiness({ fields: [], pricedFieldIds: new Set(), hours: [], evaluateAdvisory: true, activeOwnerCount: 0, phone: null });
    expect(notReadyMessage(r)).toBe('Ce centre n’est pas prêt à être publié — aucun terrain actif ; aucun horaire d’ouverture.');
  });
});

describe('garde de publication — activation et catalogue public', () => {
  let stack: TestStack;
  let superToken: string;

  beforeAll(async () => {
    stack = await setupTestStack();
    await createPlatformAccount(stack.db, { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
    const login = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email: 'admin@moubarat.test', password: 'CorrectHorseBattery9!' } });
    superToken = (login.json() as { token: string }).token;
  });
  afterAll(() => stack.teardown());

  async function createVenue(name: string) {
    const r = await stack.app.inject({
      method: 'POST', url: '/platform/venues', headers: bearer(superToken),
      payload: { name, wilaya: 'Alger', address: 'Adresse test', lat: 36.7, lng: 3.0 },
    });
    expect(r.statusCode, r.body).toBe(201);
    return (r.json() as { venue: { id: string } }).venue.id;
  }
  const post = (venueId: string, action: string) => stack.app.inject({ method: 'POST', url: `/platform/venues/${venueId}/${action}`, headers: bearer(superToken) });
  const statusOf = async (venueId: string) => (await stack.db.selectFrom('venues').select('status').where('id', '=', venueId).executeTakeFirstOrThrow()).status;
  const publicIds = async () => ((await stack.app.inject({ method: 'GET', url: '/venues' })).json() as { venues: { id: string }[] }).venues.map((v) => v.id);

  it('un centre vide ne peut pas être validé : 409 VENUE_NOT_READY, statut inchangé, points bloquants détaillés', async () => {
    const id = await createVenue('Centre vide');
    const res = await post(id, 'approve');
    expect(res.statusCode, res.body).toBe(409);
    const body = res.json() as { error: string; message: string; details: { checks: { code: string; ok: boolean; blocking: boolean }[] } };
    expect(body.error).toBe('VENUE_NOT_READY');
    expect(body.message).toBe('Ce centre n’est pas prêt à être publié — aucun terrain actif ; aucun horaire d’ouverture.');
    expect(body.details.checks.filter((c) => c.blocking && !c.ok).map((c) => c.code)).toEqual(['ACTIVE_FIELD', 'OPENING_HOURS']);
    expect(await statusOf(id)).toBe('PENDING');
    expect(await publicIds()).not.toContain(id);
  });

  it('un terrain sans tarif, ou des horaires seuls, ne suffisent pas ; chaque manque est nommé', async () => {
    const id = await createVenue('Centre à moitié configuré');
    await stack.db.insertInto('fields').values({ venue_id: id, name: 'T9', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 3000, status: 'ACTIVE' }).execute();
    await stack.db.insertInto('opening_hours').values({ venue_id: id, weekday: 1, start_min: 480, end_min: 1440 }).execute();
    const res = await post(id, 'approve');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { message: string }).message).toBe('Ce centre n’est pas prêt à être publié — tarif manquant : T9.');
    expect(await statusOf(id)).toBe('PENDING');
  });

  it('complet (terrain actif tarifé + horaires) : validation acceptée et centre visible — les recommandés ne bloquent pas', async () => {
    const id = await createVenue('Centre complet');
    await makeVenuePublishable(stack.db, id); // ni téléphone, ni compte gérant
    const res = await post(id, 'approve');
    expect(res.statusCode, res.body).toBe(200);
    expect(await statusOf(id)).toBe('ACTIVE');
    expect(await publicIds()).toContain(id);
  });

  it('réactivation : refusée si le centre suspendu a été vidé entre-temps, acceptée une fois corrigé', async () => {
    const id = await createVenue('Centre suspendu puis vidé');
    const { fieldId } = await makeVenuePublishable(stack.db, id);
    expect((await post(id, 'approve')).statusCode).toBe(200);
    expect((await post(id, 'suspend')).statusCode).toBe(200);
    await stack.db.updateTable('fields').set({ status: 'ARCHIVED' }).where('id', '=', fieldId).execute();

    const refused = await post(id, 'reactivate');
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: string }).error).toBe('VENUE_NOT_READY');
    expect(await statusOf(id)).toBe('SUSPENDED');

    await insertTestField(stack.db, { venue_id: id, name: 'T2', sport: 'PADEL', formats: ['DOUBLE'], hourly_rate_da: 2400, status: 'ACTIVE' });
    expect((await post(id, 'reactivate')).statusCode).toBe(200);
    expect(await statusOf(id)).toBe('ACTIVE');
  });

  it('une transition invalide reste INVALID_TRANSITION (la garde ne masque pas la règle du core)', async () => {
    const id = await createVenue('Centre déjà actif');
    await makeVenuePublishable(stack.db, id);
    await post(id, 'approve');
    const again = await post(id, 'approve');
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: string }).error).toBe('INVALID_TRANSITION');
  });

  it('catalogue public : un centre ACTIF devenu incomplet disparaît de GET /venues, et revient une fois corrigé', async () => {
    const id = await createVenue('Centre qui se vide');
    const { fieldId } = await makeVenuePublishable(stack.db, id);
    await post(id, 'approve');
    expect(await publicIds()).toContain(id);

    await stack.db.updateTable('fields').set({ status: 'ARCHIVED' }).where('id', '=', fieldId).execute();
    expect(await statusOf(id)).toBe('ACTIVE'); // toujours actif côté plateforme…
    expect(await publicIds()).not.toContain(id); // …mais jamais une carte vide côté joueur

    await stack.db.updateTable('fields').set({ status: 'ACTIVE' }).where('id', '=', fieldId).execute();
    await stack.db.deleteFrom('opening_hours').where('venue_id', '=', id).execute();
    expect(await publicIds()).not.toContain(id); // sans horaires non plus

    await stack.db.insertInto('opening_hours').values({ venue_id: id, weekday: 2, start_min: 600, end_min: 1300 }).execute();
    expect(await publicIds()).toContain(id);
  });

  it('un centre ACTIF inséré sans terrain (données anciennes) n\'apparaît pas non plus', async () => {
    const legacy = await stack.db.insertInto('venues').values({
      name: 'Centre ancien sans terrain', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    expect(await publicIds()).not.toContain(legacy.id);
  });

  it('liste plateforme : « prêt à publier » par centre ; fiche : points bloquants ET recommandés', async () => {
    const empty = await createVenue('Liste — vide');
    const full = await createVenue('Liste — complet');
    await makeVenuePublishable(stack.db, full);

    const list = await stack.app.inject({ method: 'GET', url: '/platform/venues', headers: bearer(superToken) });
    const byId = new Map((list.json() as { venues: { id: string; readiness: { ready: boolean; missingCount: number } }[] }).venues.map((v) => [v.id, v.readiness]));
    expect(byId.get(empty)).toEqual({ ready: false, missingCount: 2 });
    expect(byId.get(full)).toEqual({ ready: true, missingCount: 0 });

    const detail = await stack.app.inject({ method: 'GET', url: `/platform/venues/${full}`, headers: bearer(superToken) });
    const checks = (detail.json() as { venue: { readiness: { ready: boolean; checks: { code: string; ok: boolean; blocking: boolean }[] } } }).venue.readiness;
    expect(checks.ready).toBe(true);
    expect(checks.checks.map((c) => [c.code, c.ok, c.blocking])).toEqual([
      ['ACTIVE_FIELD', true, true], ['FIELD_PRICES', true, true], ['OPENING_HOURS', true, true],
      ['MANAGER', false, false], ['PHONE', false, false],
    ]);
  });
});
