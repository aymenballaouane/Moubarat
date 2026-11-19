import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import ExcelJS from 'exceljs';
import { distanceM, parseCsv, parsePlaceInput, placeNameKey } from '../src/modules/places/community.js';

/* Lot B, phase 6 « Nos lieux d'abord » — les terrains de la communauté : ajout par un joueur (match libre), visibilité (à vérifier :
   seulement pour lui ; vérifié : pour tous), doublons, rattachement des matchs, signalement, console (vérifier, masquer, fusionner,
   ajouter, importer). */

const F = { 'x-moubarat-features': 'match-libre,format-9v9' };
const KIFFAN = { lat: 36.7466, lng: 3.1937 };
let stack: TestStack;
let seed: SeedResult;
let karim = ''; let sofiane = ''; let sa = '';
let slot = 0;
const nextStart = () => Math.ceil((Date.now() + (300 + 4 * slot++) * 3_600_000) / 1_800_000) * 1_800_000;

async function publish(token: string, place: Record<string, unknown>) {
  return stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(token), ...F }, payload: {
    place: { wilaya: 'Alger', ...place }, format: '5v5', level: 'LOISIR', start: nextStart(), durationMin: 90,
  } });
}
const community = async (token: string) => ((await stack.app.inject({ method: 'GET', url: `/places/community?lat=${KIFFAN.lat}&lng=${KIFFAN.lng}`, headers: bearer(token) }))
  .json() as { places: { id: string; name: string; verified: boolean; mine: boolean; matchCount: number }[] }).places;

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  [karim, sofiane] = await Promise.all([loginAs(stack, seed.phones.karim), loginAs(stack, seed.phones.sofiane)]);
  await createPlatformAccount(stack.db, { email: 'lieux@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true });
  const r = await stack.app.inject({ method: 'POST', url: '/platform/auth/login', payload: { email: 'lieux@moubarat.test', password: 'CorrectHorseBattery9!' } });
  sa = (r.json() as { token: string }).token;
});
afterAll(async () => { await stack.teardown(); });

describe('règles pures', () => {
  it('le nom replié ignore casse, accents, espaces et ponctuation', () => {
    expect(placeNameKey('Koora Land')).toBe(placeNameKey('KOORALAND'));
    expect(placeNameKey('Kooralánd !')).toBe('kooraland');
  });
  it('une ligne de fichier : nom, wilaya et position en Algérie obligatoires ; virgule décimale acceptée', () => {
    expect(parsePlaceInput({ name: 'City Foot', wilaya: 'Alger', lat: '36,7671', lng: '2,9586' })).toMatchObject({ ok: true, place: { lat: 36.7671, lng: 2.9586 } });
    expect(parsePlaceInput({ name: 'Paris', wilaya: 'Île-de-France', lat: 48.85, lng: 2.35 }).ok).toBe(false);
    expect(parsePlaceInput({ name: 'X', wilaya: 'Alger', lat: 36.7, lng: 3 }).ok).toBe(false);
  });
  it('distance en mètres', () => {
    expect(Math.round(distanceM(KIFFAN, { lat: KIFFAN.lat + 0.001, lng: KIFFAN.lng }))).toBeGreaterThan(100);
  });
});

describe('un joueur ajoute son terrain', () => {
  let placeId = '';

  it('« Ajouter ce terrain à Moubarat » : le match est rattaché à un lieu à vérifier, visible seulement pour lui', async () => {
    const res = await publish(karim, { name: 'Kooraland', ...KIFFAN, address: 'Route de Bordj El Bahri', share: true });
    expect(res.statusCode, res.body).toBe(201);
    placeId = (res.json() as { match: { placeId: string } }).match.placeId;
    expect(placeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await community(karim)).toEqual([expect.objectContaining({ id: placeId, name: 'Kooraland', verified: false, mine: true, matchCount: 1 })]);
    expect((await community(sofiane)).map((p) => p.id)).not.toContain(placeId);
  });

  it('sans la case : aucun lieu créé', async () => {
    const res = await publish(karim, { name: 'Terrain du quartier', lat: 36.70, lng: 3.05 });
    expect((res.json() as { match: { placeId: string | null } }).match.placeId).toBeNull();
  });

  it('même nom à moins de 150 m : pas de doublon, le match rejoint le lieu existant', async () => {
    const res = await publish(karim, { name: 'KOORA LAND', lat: KIFFAN.lat + 0.0004, lng: KIFFAN.lng, share: true });
    expect((res.json() as { match: { placeId: string } }).match.placeId).toBe(placeId);
    const n = await stack.db.selectFrom('places').select(stack.db.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it('un lieu à vérifier ne se choisit pas par un autre joueur ; vérifié, il se choisit et le match prend ses données', async () => {
    const refused = await publish(sofiane, { name: 'n’importe quoi', placeId });
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: string }).error).toBe('PLACE_NOT_FOUND');
    expect((await stack.app.inject({ method: 'POST', url: `/platform/places/${placeId}/verify`, headers: bearer(sa) })).statusCode).toBe(200);
    expect((await community(sofiane)).map((p) => p.id)).toContain(placeId);
    const ok = await publish(sofiane, { name: 'n’importe quoi', placeId, lat: 1, lng: 1 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as { match: { placeId: string; place: { name: string; address: string; lat: number } } }).match)
      .toMatchObject({ placeId, place: { name: 'Kooraland', address: 'Route de Bordj El Bahri', lat: KIFFAN.lat } });
  });

  it('« Signaler une erreur » : un seul signalement ouvert par joueur ; la console le voit', async () => {
    const a = await stack.app.inject({ method: 'POST', url: `/places/community/${placeId}/report`, headers: bearer(sofiane), payload: { reason: 'WRONG_POSITION', note: 'C’est 200 m plus loin' } });
    expect(a.statusCode).toBe(201);
    const b = await stack.app.inject({ method: 'POST', url: `/places/community/${placeId}/report`, headers: bearer(sofiane), payload: { reason: 'CLOSED' } });
    expect(b.json()).toMatchObject({ duplicate: true });
    const list = (await stack.app.inject({ method: 'GET', url: '/platform/places?status=REPORTED', headers: bearer(sa) })).json() as { places: { id: string; reports: unknown[] }[]; counts: { reported: number } };
    expect(list.counts.reported).toBe(1);
    expect(list.places[0]).toMatchObject({ id: placeId, reports: [expect.objectContaining({ reason: 'WRONG_POSITION' })] });
    await stack.app.inject({ method: 'POST', url: `/platform/places/${placeId}/reports/handle`, headers: bearer(sa) });
    expect(((await stack.app.inject({ method: 'GET', url: '/platform/places?status=REPORTED', headers: bearer(sa) })).json() as { places: unknown[] }).places).toHaveLength(0);
  });

  it('un joueur ne touche pas aux routes de la console', async () => {
    expect((await stack.app.inject({ method: 'GET', url: '/platform/places', headers: bearer(karim) })).statusCode).toBeGreaterThanOrEqual(401);
  });
});

describe('console', () => {
  it('ajouter (vérifié d’office), refuser un doublon, corriger, marquer « sur OpenStreetMap »', async () => {
    const a = await stack.app.inject({ method: 'POST', url: '/platform/places', headers: bearer(sa), payload: { name: 'City Foot', area: 'Chéraga', wilaya: 'Alger', lat: 36.7671, lng: 2.9586 } });
    expect(a.statusCode, a.body).toBe(201);
    const id = (a.json() as { place: { id: string } }).place.id;
    const dup = await stack.app.inject({ method: 'POST', url: '/platform/places', headers: bearer(sa), payload: { name: 'CITY FOOT', wilaya: 'Alger', lat: 36.7672, lng: 2.9586 } });
    expect(dup.statusCode).toBe(409);
    expect((await stack.app.inject({ method: 'PATCH', url: `/platform/places/${id}`, headers: bearer(sa), payload: { lat: 36.768, onOsm: true } })).statusCode).toBe(200);
    const row = await stack.db.selectFrom('places').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'VERIFIED', source: 'CONSOLE', lat: 36.768, on_osm: true });
    const audit = await stack.db.selectFrom('audit_log').select('action').where('object_id', '=', id).execute();
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['PLACE_CREATED', 'PLACE_UPDATED']));
  });

  it('fusionner : les matchs suivent, la fiche fusionnée disparaît ; masquer retire un lieu des joueurs', async () => {
    const a = (await publish(karim, { name: 'Foot Center', lat: 36.75, lng: 3.20, share: true })).json() as { match: { placeId: string } };
    const b = (await publish(sofiane, { name: 'Foot Centre Kiffan', lat: 36.7501, lng: 3.2001, share: true })).json() as { match: { id: string; placeId: string } };
    expect(a.match.placeId).not.toBe(b.match.placeId);
    expect((await stack.app.inject({ method: 'POST', url: `/platform/places/${b.match.placeId}/merge`, headers: bearer(sa), payload: { intoId: a.match.placeId } })).statusCode).toBe(200);
    const m = await stack.db.selectFrom('matches').select('place_id').where('id', '=', b.match.id).executeTakeFirstOrThrow();
    expect(m.place_id).toBe(a.match.placeId);
    const merged = await stack.db.selectFrom('places').select(['status', 'merged_into']).where('id', '=', b.match.placeId).executeTakeFirstOrThrow();
    expect(merged).toEqual({ status: 'HIDDEN', merged_into: a.match.placeId });

    await stack.app.inject({ method: 'POST', url: `/platform/places/${a.match.placeId}/verify`, headers: bearer(sa) });
    expect((await community(sofiane)).map((p) => p.id)).toContain(a.match.placeId);
    await stack.app.inject({ method: 'POST', url: `/platform/places/${a.match.placeId}/hide`, headers: bearer(sa) });
    expect((await community(sofiane)).map((p) => p.id)).not.toContain(a.match.placeId);
  });

  it('importer : lignes valides « à vérifier », doublons ignorés, erreurs numérotées comme dans le fichier', async () => {
    const res = await stack.app.inject({ method: 'POST', url: '/platform/places/import', headers: bearer(sa), payload: { rows: [
      { name: 'Salle OMS Hydra', wilaya: 'Alger', lat: 36.74, lng: 3.03 },
      { name: 'City Foot', wilaya: 'Alger', lat: 36.768, lng: 2.9586 },
      { name: 'Sans position', wilaya: 'Alger' },
    ] } });
    expect(res.json()).toMatchObject({ created: 1, skipped: 1, errorCount: 1, errors: [{ row: 4 }] });
    const row = await stack.db.selectFrom('places').select(['status', 'source']).where('name', '=', 'Salle OMS Hydra').executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'PENDING', source: 'IMPORT' });
  });
});

describe('import d’un fichier', () => {
  it('CSV « ; » avec guillemets, en-têtes en français', () => {
    expect(parseCsv('Nom;Wilaya;Latitude;Longitude\r\n"Stade ""5 Juillet""";Alger;36,75;3,02\r\n')).toEqual([
      ['Nom', 'Wilaya', 'Latitude', 'Longitude'], ['Stade "5 Juillet"', 'Alger', '36,75', '3,02'],
    ]);
  });

  it('un vrai fichier .csv puis un vrai .xlsx envoyés par la console', async () => {
    const csv = Buffer.from('nom;quartier;wilaya;latitude;longitude\nTerrain OMS Bab Ezzouar;Bab Ezzouar;Alger;36,72;3,18\n', 'utf8');
    const a = await stack.app.inject({ method: 'POST', url: '/platform/places/import', headers: bearer(sa), payload: { filename: 'lieux.csv', file: csv.toString('base64') } });
    expect(a.json()).toMatchObject({ created: 1, errorCount: 0 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lieux');
    ws.addRow(['Nom', 'Adresse', 'Wilaya', 'Latitude', 'Longitude']);
    ws.addRow(['Salle OMS Oran Est', 'Bir El Djir', 'Oran', 35.72, -0.55]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const b = await stack.app.inject({ method: 'POST', url: '/platform/places/import', headers: bearer(sa), payload: { filename: 'lieux.xlsx', file: xlsx.toString('base64') } });
    expect(b.json()).toMatchObject({ created: 1, errorCount: 0 });
    const row = await stack.db.selectFrom('places').select(['address', 'wilaya', 'lng']).where('name', '=', 'Salle OMS Oran Est').executeTakeFirstOrThrow();
    expect(row).toEqual({ address: 'Bir El Djir', wilaya: 'Oran', lng: -0.55 });
    const bad = await stack.app.inject({ method: 'POST', url: '/platform/places/import', headers: bearer(sa), payload: { filename: 'lieux.pdf', file: 'AAAA' } });
    expect(bad.statusCode).toBe(400);
  });
});
