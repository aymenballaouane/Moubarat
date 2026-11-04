import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Audit produit 21/09/2026 (CE1/CE2) — le superadmin corrige l'identité d'un centre (nom, wilaya,
   adresse, position, téléphone, description) ; le gérant, lui, ne touche qu'au téléphone en plus de
   ce qu'il modifiait déjà. Décision Aymen 22/09 : nom, wilaya et position restent au superadmin. */

let stack: TestStack;
let seed: SeedResult;
let superToken = '', ordinaryToken = '', hamid = '', nadia = '', sofiane = '';
const SUPERADMIN_REAL_NAME = 'Aymen Nom-Personnel-Secret';

async function patchVenue(token: string | null, body: unknown, venueId = seed.venueId) {
  return stack.app.inject({
    method: 'PATCH', url: `/platform/venues/${venueId}`,
    ...(token ? { headers: bearer(token) } : {}), payload: body as Record<string, unknown>,
  });
}
async function auditRows() {
  return stack.db.selectFrom('audit_log').selectAll()
    .where('venue_id', '=', seed.venueId).where('action', '=', 'CENTER_UPDATED').where('object_type', '=', 'venue')
    .orderBy('at', 'asc').execute();
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await createPlatformAccount(stack.db, { email: 'super.edit@moubarat.test', password: 'SuperEditPass9!', name: SUPERADMIN_REAL_NAME, isSuperadmin: true });
  await createPlatformAccount(stack.db, { email: 'ordinaire.edit@moubarat.test', password: 'OrdinairePass9!', name: 'Compte ordinaire' });
  superToken = await loginAsPlatform(stack, 'super.edit@moubarat.test', 'SuperEditPass9!');
  ordinaryToken = await loginAsPlatform(stack, 'ordinaire.edit@moubarat.test', 'OrdinairePass9!');
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);  // OWNER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);  // RECEPTION — pas EDIT_PROFILE
  sofiane = await loginAs(stack, seed.phones.sofiane);                                     // joueur
});
afterAll(() => stack.teardown());

describe('PATCH /platform/venues/:venueId — le superadmin corrige la fiche d’identité', () => {
  it('modifie nom, wilaya et position ; la valeur survit à une relecture indépendante', async () => {
    const res = await patchVenue(superToken, { name: 'Complexe Corrigé', wilaya: 'Boumerdès', lat: 36.7538, lng: 3.0588 });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { venue: { name: string; lat: number }; changed: string[] };
    expect(body.venue.name).toBe('Complexe Corrigé');
    expect(body.changed.sort()).toEqual(['lat', 'lng', 'name', 'wilaya']);

    const reread = await stack.app.inject({ method: 'GET', url: `/platform/venues/${seed.venueId}`, headers: bearer(superToken) });
    const v = (reread.json() as { venue: { name: string; wilaya: string; lat: number; lng: number } }).venue;
    expect([v.name, v.wilaya, v.lat, v.lng]).toEqual(['Complexe Corrigé', 'Boumerdès', 36.7538, 3.0588]);
  });

  it('journalise UNE entrée avec venueId (visible dans le Journal du centre), avant/après limités aux champs modifiés, sans doublon « position »', async () => {
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const e = rows[0]!;
    expect(e.actor_role).toBe('SUPERADMIN');
    expect(e.summary).toBe('a modifié la fiche du centre (nom, wilaya, position)');
    expect(Object.keys(JSON.parse(e.before_val!)).sort()).toEqual(['lat', 'lng', 'name', 'wilaya']);
    expect(JSON.parse(e.after_val!)).toEqual({ name: 'Complexe Corrigé', wilaya: 'Boumerdès', lat: 36.7538, lng: 3.0588 });
  });

  it('mêmes valeurs renvoyées → 200, changed vide, AUCUNE nouvelle ligne de journal', async () => {
    const res = await patchVenue(superToken, { name: 'Complexe Corrigé', lat: 36.7538, lng: 3.0588 });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { changed: string[] }).changed).toEqual([]);
    expect(await auditRows()).toHaveLength(1);
  });

  it('un seul champ de la position réellement modifié → seul celui-là est écrit et journalisé', async () => {
    const res = await patchVenue(superToken, { lat: 36.75, lng: 3.0588 });
    expect((res.json() as { changed: string[] }).changed).toEqual(['lat']);
  });

  it('téléphone : posé, puis vidé (null) ; description idem', async () => {
    const set = await patchVenue(superToken, { phone: '  0550 12 34 56 ', description: 'Nouvelle description' });
    expect((set.json() as { venue: { phone: string; description: string } }).venue).toMatchObject({ phone: '0550 12 34 56', description: 'Nouvelle description' });
    const cleared = await patchVenue(superToken, { phone: '', description: '   ' });
    expect((cleared.json() as { venue: { phone: null; description: null } }).venue).toMatchObject({ phone: null, description: null });
  });

  it.each([
    ['nom vide', { name: '   ' }],
    ['wilaya vide', { wilaya: '' }],
    ['adresse non textuelle', { address: 12 }],
    ['latitude seule', { lat: 36.7 }],
    ['longitude seule', { lng: 3.0 }],
    ['latitude en chaîne', { lat: '36.7', lng: 3.0 }],
    ['latitude hors limites', { lat: 91, lng: 3.0 }],
    ['longitude hors limites', { lat: 36.7, lng: 181 }],
    ['latitude non finie', { lat: null, lng: 3.0 }],
    ['téléphone trop long', { phone: '0'.repeat(41) }],
    ['téléphone avec saut de ligne', { phone: '0550\n123456' }],
    ['téléphone non textuel', { phone: 550123456 }],
    ['corps sans aucun champ connu', { equipments: ['Parking'] }],
    ['corps vide', {}],
  ])('refuse : %s → 400', async (_label, body) => {
    const res = await patchVenue(superToken, body);
    expect(res.statusCode, res.body).toBe(400);
  });

  it('centre inconnu → 404 ; identifiant malformé → 400 ; jamais un 500', async () => {
    expect((await patchVenue(superToken, { name: 'X' }, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await patchVenue(superToken, { name: 'X' }, 'pas-un-uuid')).statusCode).toBe(400);
  });

  it('réservé au superadmin : compte ordinaire, gérant du centre, joueur et anonyme refusés, rien n’est écrit', async () => {
    const before = await auditRows();
    expect((await patchVenue(ordinaryToken, { name: 'Piratage' })).statusCode).toBe(403);
    expect((await patchVenue(hamid, { name: 'Piratage' })).statusCode).toBe(403);
    expect((await patchVenue(sofiane, { name: 'Piratage' })).statusCode).toBe(401);
    expect((await patchVenue(null, { name: 'Piratage' })).statusCode).toBe(401);
    expect(await auditRows()).toHaveLength(before.length);
    const row = await stack.db.selectFrom('venues').select('name').where('id', '=', seed.venueId).executeTakeFirstOrThrow();
    expect(row.name).not.toBe('Piratage');
  });

  it('le gérant voit l’action dans son Journal sous « Équipe Moubarat » — jamais le nom personnel du compte plateforme', async () => {
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(hamid) });
    expect(res.statusCode).toBe(200);
    const entries = (res.json() as { entries: { actorName: string; actorRole: string; summary: string }[] }).entries;
    const mine = entries.filter((e) => e.actorRole === 'SUPERADMIN');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.actorName === 'Équipe Moubarat')).toBe(true);
    expect(res.body).not.toContain(SUPERADMIN_REAL_NAME);
  });
});

describe('PATCH /venues/:venueId — le gérant modifie le téléphone de son centre (EDIT_PROFILE)', () => {
  async function crmPatch(token: string, body: unknown) {
    return stack.app.inject({ method: 'PATCH', url: `/venues/${seed.venueId}`, headers: bearer(token), payload: body as Record<string, unknown> });
  }

  it('OWNER pose un téléphone : renvoyé, relisible sur la fiche publique, journalisé avant/après', async () => {
    const res = await crmPatch(hamid, { phone: ' +213 550 99 88 77 ' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { venue: { phone: string } }).venue.phone).toBe('+213 550 99 88 77');

    const reread = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}` });
    expect((reread.json() as { venue: { phone: string } }).venue.phone).toBe('+213 550 99 88 77');

    const last = (await stack.db.selectFrom('audit_log').selectAll()
      .where('venue_id', '=', seed.venueId).where('actor_role', '=', 'OWNER').orderBy('at', 'desc').limit(1).execute())[0]!;
    expect(JSON.parse(last.before_val!).phone).toBeNull(); // vidé par les tests superadmin ci-dessus
    expect(JSON.parse(last.after_val!).phone).toBe('+213 550 99 88 77');
  });

  it('téléphone vide → effacé (null)', async () => {
    const res = await crmPatch(hamid, { phone: '' });
    expect((res.json() as { venue: { phone: null } }).venue.phone).toBeNull();
  });

  it('même validation que le superadmin : trop long, saut de ligne, non textuel → 400', async () => {
    for (const phone of ['0'.repeat(41), '0550\n1', 550123456]) {
      expect((await crmPatch(hamid, { phone })).statusCode).toBe(400);
    }
  });

  it('RECEPTION (pas EDIT_PROFILE) → 403 ; le gérant ne peut PAS renommer son centre ni déplacer sa position (réservé au superadmin)', async () => {
    expect((await crmPatch(nadia, { phone: '0550000000' })).statusCode).toBe(403);
    const before = await stack.db.selectFrom('venues').select(['name', 'wilaya', 'lat', 'lng']).where('id', '=', seed.venueId).executeTakeFirstOrThrow();
    for (const body of [{ name: 'Renommé' }, { wilaya: 'Oran' }, { lat: 1, lng: 1 }]) {
      expect((await crmPatch(hamid, body)).statusCode).toBe(400); // aucun champ modifiable dans ce corps
    }
    const after = await stack.db.selectFrom('venues').select(['name', 'wilaya', 'lat', 'lng']).where('id', '=', seed.venueId).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });
});
