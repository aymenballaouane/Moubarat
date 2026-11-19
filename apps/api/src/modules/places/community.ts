import type { FastifyInstance } from 'fastify';
import { sql, type Transaction } from 'kysely';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import type { Guards } from '../../auth/guards.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';
import { foldText } from '../../lib/search.js';
import { assertCleanText } from '../../lib/content-filter.js';
import { writeAudit } from '../../audit/log.js';
import ExcelJS from 'exceljs';

/* --- Lecture d'un fichier importé (Excel .xlsx ou CSV) ------------------------------------------------------------------------- */

/** Les en-têtes reconnus (casse et accents ignorés), en français ou en anglais. */
const HEADERS: Record<string, keyof PlaceInput> = {
  nom: 'name', name: 'name', lieu: 'name', terrain: 'name',
  quartier: 'area', commune: 'area', area: 'area',
  adresse: 'address', address: 'address',
  wilaya: 'wilaya', ville: 'wilaya',
  latitude: 'lat', lat: 'lat',
  longitude: 'lng', lng: 'lng', lon: 'lng', long: 'lng',
};
function headerKey(h: unknown): keyof PlaceInput | null {
  return HEADERS[foldText(String(h ?? '')).replace(/[^a-z]/g, '')] ?? null;
}
function rowsFromTable(table: unknown[][]): Record<string, unknown>[] {
  const [head, ...body] = table;
  if (!head) return [];
  const keys = head.map(headerKey);
  return body.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => {
    const o: Record<string, unknown> = {};
    keys.forEach((k, i) => { if (k) o[k] = r[i]; });
    return o;
  });
}
/** CSV séparé par « ; » (Excel en français) ou « , », guillemets doubles gérés. */
export function parseCsv(text: string): unknown[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); out.push(row); }
  return out;
}
export async function rowsFromFile(filename: string, bytes: Buffer): Promise<Record<string, unknown>[]> {
  if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) return rowsFromTable(parseCsv(bytes.toString('utf8')));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const table: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const values = (r.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v));
    table.push(values);
  });
  return rowsFromTable(table);
}

/* Lot B, phase 6 « Nos lieux d'abord » (19/11/2026, GO d'Aymen sur la maquette) — les terrains de la communauté.

   Un lieu naît de trois façons : un joueur l'ajoute en publiant un match libre (case « Ajouter ce terrain à Moubarat », cochée par
   défaut), Moubarat l'ajoute dans la console, ou une liste est importée (fichier Excel ou CSV, par exemple une liste publique
   d'installations sportives — jamais une copie de Google). Il est « À vérifier » (PENDING) : visible tout de suite pour celui qui l'a
   ajouté, pour tous dès que la console l'a vérifié (VERIFIED). « Masquer » (HIDDEN) le retire ; « Fusionner » réunit deux fiches du
   même terrain (les matchs suivent).

   Doublons : un joueur qui ajoute un terrain dont le NOM replié est déjà celui d'un lieu à moins de DUPLICATE_RADIUS_M est rattaché à
   ce lieu, sans nouvelle fiche ; l'app lui propose aussi, avant, « C'est l'un de ces terrains ? » (lieux à moins de NEARBY_RADIUS_M). */

export const DUPLICATE_RADIUS_M = 150;
export const NEARBY_RADIUS_M = 150;
/** Lieux qu'un joueur peut ajouter par jour (garde-fou contre le remplissage abusif). */
export const PLACE_CREATE_MAX_PER_DAY = 10;

type Executor = Db | Transaction<Database>;
type Status = 'PENDING' | 'VERIFIED' | 'HIDDEN';
const REASONS = ['WRONG_NAME', 'WRONG_POSITION', 'CLOSED', 'OTHER'] as const;

/** « Kooraland », « KOORA LAND », « Kooralánd » → « kooraland » : la clé des doublons et de la recherche (espaces et ponctuation ôtés). */
export function placeNameKey(name: string): string {
  return foldText(name).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Distance en mètres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Le cadre (en degrés) qui contient un cercle de `radiusM` mètres autour d'un point : un premier tri par l'index, avant la vraie distance. */
function box(lat: number, lng: number, radiusM: number) {
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

function num(raw: unknown, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const trimOrNull = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t.slice(0, max);
};

export interface PlaceInput { name: string; area: string | null; address: string | null; wilaya: string; lat: number; lng: number }

/** Lit et vérifie un lieu envoyé par la console ou un fichier (les mêmes bornes que la base). `null` + la raison si la ligne est invalide. */
export function parsePlaceInput(raw: Record<string, unknown>): { ok: true; place: PlaceInput } | { ok: false; message: string } {
  const name = trimOrNull(raw.name, 61);
  if (!name || name.length < 2 || name.length > 60) return { ok: false, message: 'Nom du lieu : 2 à 60 signes.' };
  const wilaya = trimOrNull(raw.wilaya, 41);
  if (!wilaya || wilaya.length < 2 || wilaya.length > 40) return { ok: false, message: 'Wilaya manquante.' };
  const lat = num(typeof raw.lat === 'string' ? raw.lat.replace(',', '.') : raw.lat, 18, 38);
  const lng = num(typeof raw.lng === 'string' ? raw.lng.replace(',', '.') : raw.lng, -9, 12.5);
  if (lat === null || lng === null) return { ok: false, message: 'Position invalide (latitude et longitude en Algérie).' };
  return { ok: true, place: { name, area: trimOrNull(raw.area, 60), address: trimOrNull(raw.address, 120), wilaya, lat, lng } };
}

/** Un lieu proche portant le même nom (doublon), hors lieux masqués. */
export async function findDuplicate(db: Executor, p: { name: string; lat: number; lng: number }): Promise<{ id: string } | null> {
  const b = box(p.lat, p.lng, DUPLICATE_RADIUS_M);
  const rows = await db.selectFrom('places').select(['id', 'lat', 'lng'])
    .where('name_key', '=', placeNameKey(p.name)).where('status', '<>', 'HIDDEN')
    .where('lat', '>=', b.minLat).where('lat', '<=', b.maxLat).where('lng', '>=', b.minLng).where('lng', '<=', b.maxLng)
    .execute();
  const hit = rows.find((r) => distanceM(p, r) <= DUPLICATE_RADIUS_M);
  return hit ? { id: hit.id } : null;
}

/** Le lieu qu'un joueur a le droit de choisir : vérifié, ou « à vérifier » s'il l'a ajouté lui-même. Une fiche fusionnée mène à la bonne. */
export async function placeForPlayer(db: Executor, id: string, userId: string) {
  if (!isUuid(id)) return null;
  let row = await db.selectFrom('places').selectAll().where('id', '=', id).executeTakeFirst();
  if (row?.merged_into) row = await db.selectFrom('places').selectAll().where('id', '=', row.merged_into).executeTakeFirst();
  if (!row || row.status === 'HIDDEN') return null;
  if (row.status === 'PENDING' && row.created_by !== userId) return null;
  return row;
}

/** Ce que l'app joueur reçoit d'un lieu. */
function playerView(r: { id: string; name: string; area: string | null; address: string | null; wilaya: string; lat: number; lng: number; status: Status; created_by: string | null }, userId: string, matchCount: number) {
  return {
    id: r.id, name: r.name, area: r.area, address: r.address, wilaya: r.wilaya, lat: r.lat, lng: r.lng,
    verified: r.status === 'VERIFIED', mine: r.created_by === userId, matchCount,
  };
}

/** Nombre de matchs (non annulés) rattachés à chaque lieu. */
async function matchCounts(db: Executor, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('matches').select(['place_id', db.fn.countAll<string>().as('n')])
    .where('place_id', 'in', ids as string[]).where('status', '<>', 'CANCELLED').groupBy('place_id').execute();
  return new Map(rows.map((r) => [r.place_id!, Number(r.n)]));
}

/** Le lieu d'un match libre qu'on publie : un lieu choisi (`placeId`), ou un nouveau lieu ajouté par le joueur (`share`) — sinon aucun.
    Renvoie l'identifiant à poser sur le match et, pour un lieu choisi, ses données (le match les copie : nom, adresse, position). */
export async function resolvePlaceForMatch(
  trx: Transaction<Database>,
  input: { placeId: string | null; share: boolean; name: string; area: string | null; address: string | null; wilaya: string; lat: number | undefined; lng: number | undefined },
  userId: string, limiter: RateLimiter | undefined,
): Promise<{ placeId: string | null; chosen: PlaceInput | null }> {
  if (input.placeId) {
    const row = await placeForPlayer(trx, input.placeId, userId);
    if (!row) throw new ApiError(404, 'PLACE_NOT_FOUND', 'Ce terrain n’est plus disponible. Choisis-le à nouveau sur la carte.');
    return { placeId: row.id, chosen: { name: row.name, area: row.area, address: row.address, wilaya: row.wilaya, lat: row.lat, lng: row.lng } };
  }
  if (!input.share || input.lat === undefined || input.lng === undefined) return { placeId: null, chosen: null };
  const dup = await findDuplicate(trx, { name: input.name, lat: input.lat, lng: input.lng });
  if (dup) return { placeId: dup.id, chosen: null };
  if (limiter && !(await limiter.check(userId)).allowed) return { placeId: null, chosen: null };   // au-delà du plafond : le match se crée, sans fiche
  const row = await trx.insertInto('places').values({
    name: input.name.slice(0, 60), name_key: placeNameKey(input.name), area: input.area, address: input.address,
    wilaya: input.wilaya, lat: input.lat, lng: input.lng, source: 'PLAYER', created_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  return { placeId: row.id, chosen: null };
}

interface Deps {
  db: Db; guards: Guards;
  platformGuards: PlatformGuards;
  contentFilter?: boolean;
}

export async function registerCommunityPlaceRoutes(app: FastifyInstance, { db, guards, platformGuards, contentFilter = false }: Deps): Promise<void> {
  const superadmin = { preHandler: (req: Parameters<PlatformGuards['requireSuperadmin']>[0]) => platformGuards.requireSuperadmin(req) };

  /* --- App joueur -------------------------------------------------------------------------------------------------------------- */

  /** Les lieux autour d'un point (carte, recherche, doublons) : vérifiés, plus ceux que j'ai ajoutés. 300 au plus. */
  app.get<{ Querystring: { lat?: string; lng?: string; radiusKm?: string } }>('/places/community',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      if (lat === null || lng === null) throw badRequest('Position invalide.');
      const radiusKm = num(req.query.radiusKm, 1, 80) ?? 40;
      const userId = req.auth!.userId;
      const b = box(lat, lng, radiusKm * 1000);
      const rows = await db.selectFrom('places').select(['id', 'name', 'area', 'address', 'wilaya', 'lat', 'lng', 'status', 'created_by'])
        .where('lat', '>=', b.minLat).where('lat', '<=', b.maxLat).where('lng', '>=', b.minLng).where('lng', '<=', b.maxLng)
        .where((eb) => eb.or([eb('status', '=', 'VERIFIED'), eb.and([eb('status', '=', 'PENDING'), eb('created_by', '=', userId)])]))
        .limit(300).execute();
      const counts = await matchCounts(db, rows.map((r) => r.id));
      return reply.send({ places: rows.map((r) => playerView(r, userId, counts.get(r.id) ?? 0)) });
    });

  /** Un lieu (détail d'un match) : tout lieu non masqué — ses nom, adresse et position sont déjà ceux du match. */
  app.get<{ Params: { id: string } }>('/places/community/:id',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      if (!isUuid(req.params.id)) throw notFound('Lieu introuvable.');
      let row = await db.selectFrom('places').selectAll().where('id', '=', req.params.id).executeTakeFirst();
      if (row?.merged_into) row = await db.selectFrom('places').selectAll().where('id', '=', row.merged_into).executeTakeFirst();
      if (!row || row.status === 'HIDDEN') throw notFound('Lieu introuvable.');
      const counts = await matchCounts(db, [row.id]);
      return reply.send({ place: playerView(row, req.auth!.userId, counts.get(row.id) ?? 0) });
    });

  /** « Signaler une erreur » : mauvais nom, mauvaise position, terrain fermé, autre. Un seul signalement ouvert par joueur et par lieu. */
  app.post<{ Params: { id: string }; Body: { reason?: string; note?: string } }>('/places/community/:id/report',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      if (!isUuid(req.params.id)) throw notFound('Lieu introuvable.');
      const reason = String(req.body?.reason ?? '');
      if (!(REASONS as readonly string[]).includes(reason)) throw badRequest('Raison invalide.', 'REPORT_INVALID');
      const note = trimOrNull(req.body?.note, 281);
      if (note && note.length > 280) throw badRequest('280 signes au plus.', 'REPORT_INVALID');
      const place = await db.selectFrom('places').select(['id', 'status']).where('id', '=', req.params.id).executeTakeFirst();
      if (!place || place.status === 'HIDDEN') throw notFound('Lieu introuvable.');
      const res = await db.insertInto('place_reports')
        .values({ place_id: place.id, reporter_id: req.auth!.userId, reason: reason as (typeof REASONS)[number], note })
        .onConflict((oc) => oc.columns(['place_id', 'reporter_id']).where('status', '=', 'OPEN').doNothing())
        .executeTakeFirst();
      return reply.code(Number(res.numInsertedOrUpdatedRows ?? 0n) > 0 ? 201 : 200).send({ ok: true, duplicate: Number(res.numInsertedOrUpdatedRows ?? 0n) === 0 });
    });

  /* --- Console Moubarat --------------------------------------------------------------------------------------------------------- */

  app.get<{ Querystring: { status?: string; q?: string } }>('/platform/places', superadmin, async (req, reply) => {
    const status = String(req.query.status ?? 'ALL');
    const q = (req.query.q ?? '').trim();
    let query = db.selectFrom('places').leftJoin('users', 'users.id', 'places.created_by')
      .select([
        'places.id', 'places.name', 'places.area', 'places.address', 'places.wilaya', 'places.lat', 'places.lng', 'places.status',
        'places.source', 'places.on_osm', 'places.created_at', 'places.verified_at', 'users.name as creator_name',
        sql<number>`(SELECT count(*)::int FROM place_reports pr WHERE pr.place_id = places.id AND pr.status = 'OPEN')`.as('open_reports'),
        sql<number>`(SELECT count(*)::int FROM matches m WHERE m.place_id = places.id AND m.status <> 'CANCELLED')`.as('match_count'),
        sql<number>`(SELECT count(DISTINCT m.organizer_id)::int FROM matches m WHERE m.place_id = places.id)`.as('organizer_count'),
      ])
      .where('places.merged_into', 'is', null);
    if (status === 'PENDING' || status === 'VERIFIED' || status === 'HIDDEN') query = query.where('places.status', '=', status);
    else if (status === 'REPORTED') query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM place_reports pr WHERE pr.place_id = places.id AND pr.status = 'OPEN')`);
    else query = query.where('places.status', '<>', 'HIDDEN');
    if (q) query = query.where('places.name_key', 'like', `%${placeNameKey(q).replace(/[%_]/g, '')}%`);
    const rows = await query.orderBy(sql`places.status = 'PENDING'`, 'desc').orderBy('places.created_at', 'desc').limit(500).execute();

    const ids = rows.map((r) => r.id);
    const reports = ids.length === 0 ? [] : await db.selectFrom('place_reports').select(['id', 'place_id', 'reason', 'note', 'created_at'])
      .where('place_id', 'in', ids).where('status', '=', 'OPEN').orderBy('created_at', 'asc').execute();
    const counts = await db.selectFrom('places').select([
      sql<number>`count(*) FILTER (WHERE status <> 'HIDDEN' AND merged_into IS NULL)::int`.as('all'),
      sql<number>`count(*) FILTER (WHERE status = 'PENDING')::int`.as('pending'),
      sql<number>`count(*) FILTER (WHERE status = 'VERIFIED')::int`.as('verified'),
      sql<number>`count(*) FILTER (WHERE status = 'HIDDEN' AND merged_into IS NULL)::int`.as('hidden'),
      sql<number>`(SELECT count(DISTINCT place_id)::int FROM place_reports WHERE status = 'OPEN')`.as('reported'),
    ]).executeTakeFirstOrThrow();
    return reply.send({
      counts,
      places: rows.map((r) => ({
        id: r.id, name: r.name, area: r.area, address: r.address, wilaya: r.wilaya, lat: r.lat, lng: r.lng, status: r.status,
        source: r.source, onOsm: r.on_osm, createdAt: r.created_at, verifiedAt: r.verified_at, creatorName: r.creator_name,
        matchCount: r.match_count, organizerCount: r.organizer_count,
        reports: reports.filter((x) => x.place_id === r.id).map((x) => ({ id: x.id, reason: x.reason, note: x.note, createdAt: x.created_at })),
      })),
    });
  });

  /** Ajouter un lieu à la main : vérifié d'office. */
  app.post<{ Body: Record<string, unknown> }>('/platform/places', superadmin, async (req, reply) => {
    const parsed = parsePlaceInput(req.body ?? {});
    if (!parsed.ok) throw badRequest(parsed.message, 'PLACE_INVALID');
    const p = parsed.place;
    assertCleanText(contentFilter, p.name, p.area, p.address);
    const dup = await findDuplicate(db, p);
    if (dup) throw new ApiError(409, 'PLACE_DUPLICATE', 'Un lieu du même nom existe déjà à moins de 150 m.', { id: dup.id });
    const row = await db.insertInto('places').values({
      ...p, name_key: placeNameKey(p.name), status: 'VERIFIED', source: 'CONSOLE', created_by: null, verified_at: new Date(),
    }).returning(['id', 'name']).executeTakeFirstOrThrow();
    await writeAudit(db, { actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN', action: 'PLACE_CREATED', objectType: 'place', objectId: row.id, summary: `a ajouté le lieu ${row.name}` });
    return reply.code(201).send({ place: { id: row.id } });
  });

  /** Corriger un lieu (nom, quartier, adresse, wilaya, position) ou noter qu'il a été ajouté à OpenStreetMap. */
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/platform/places/:id', superadmin, async (req, reply) => {
    if (!isUuid(req.params.id)) throw notFound('Lieu introuvable.');
    const row = await db.selectFrom('places').selectAll().where('id', '=', req.params.id).executeTakeFirst();
    if (!row) throw notFound('Lieu introuvable.');
    const body = req.body ?? {};
    const merged = { name: row.name, area: row.area, address: row.address, wilaya: row.wilaya, lat: row.lat, lng: row.lng, ...body };
    const parsed = parsePlaceInput(merged);
    if (!parsed.ok) throw badRequest(parsed.message, 'PLACE_INVALID');
    const p = parsed.place;
    assertCleanText(contentFilter, p.name, p.area, p.address);
    await db.updateTable('places').set({
      ...p, name_key: placeNameKey(p.name), updated_at: new Date(),
      ...(typeof body.onOsm === 'boolean' ? { on_osm: body.onOsm } : {}),
    }).where('id', '=', row.id).execute();
    await writeAudit(db, {
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN', action: 'PLACE_UPDATED', objectType: 'place', objectId: row.id,
      summary: typeof body.onOsm === 'boolean' && Object.keys(body).length === 1
        ? `a marqué le lieu ${row.name} ${body.onOsm ? 'comme ajouté à' : 'comme absent de'} OpenStreetMap`
        : `a corrigé le lieu ${row.name}`,
      before: `${row.name} · ${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`, after: `${p.name} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
    });
    return reply.send({ ok: true });
  });

  async function setStatus(id: string, status: Status, accountId: string): Promise<string> {
    if (!isUuid(id)) throw notFound('Lieu introuvable.');
    const row = await db.selectFrom('places').select(['id', 'name', 'merged_into']).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Lieu introuvable.');
    if (row.merged_into) throw new ApiError(409, 'PLACE_MERGED', 'Ce lieu a été fusionné avec un autre.');
    await db.updateTable('places').set({ status, updated_at: new Date(), ...(status === 'VERIFIED' ? { verified_at: new Date() } : {}) }).where('id', '=', id).execute();
    await writeAudit(db, {
      actorId: accountId, actorRole: 'SUPERADMIN', action: status === 'VERIFIED' ? 'PLACE_VERIFIED' : 'PLACE_HIDDEN', objectType: 'place', objectId: id,
      summary: status === 'VERIFIED' ? `a vérifié le lieu ${row.name}` : status === 'HIDDEN' ? `a masqué le lieu ${row.name}` : `a remis le lieu ${row.name} à vérifier`,
    });
    return row.name;
  }
  app.post<{ Params: { id: string } }>('/platform/places/:id/verify', superadmin, async (req, reply) => {
    await setStatus(req.params.id, 'VERIFIED', req.platformAuth!.accountId);
    return reply.send({ ok: true });
  });
  app.post<{ Params: { id: string } }>('/platform/places/:id/hide', superadmin, async (req, reply) => {
    await setStatus(req.params.id, 'HIDDEN', req.platformAuth!.accountId);
    return reply.send({ ok: true });
  });
  app.post<{ Params: { id: string } }>('/platform/places/:id/unhide', superadmin, async (req, reply) => {
    await setStatus(req.params.id, 'PENDING', req.platformAuth!.accountId);
    return reply.send({ ok: true });
  });

  /** Les signalements ouverts d'un lieu sont traités (le lieu a été corrigé, ou rien à faire). */
  app.post<{ Params: { id: string } }>('/platform/places/:id/reports/handle', superadmin, async (req, reply) => {
    if (!isUuid(req.params.id)) throw notFound('Lieu introuvable.');
    await db.updateTable('place_reports').set({ status: 'HANDLED', handled_at: new Date() })
      .where('place_id', '=', req.params.id).where('status', '=', 'OPEN').execute();
    return reply.send({ ok: true });
  });

  /** Fusionner : la fiche `id` rejoint `intoId` — ses matchs et ses signalements ouverts suivent, elle est masquée. */
  app.post<{ Params: { id: string }; Body: { intoId?: string } }>('/platform/places/:id/merge', superadmin, async (req, reply) => {
    const intoId = String(req.body?.intoId ?? '');
    if (!isUuid(req.params.id) || !isUuid(intoId) || intoId === req.params.id) throw badRequest('Choisis un autre lieu.', 'PLACE_INVALID');
    const names = await db.transaction().execute(async (trx) => {
      const rows = await trx.selectFrom('places').select(['id', 'name', 'merged_into', 'status']).where('id', 'in', [req.params.id, intoId]).forUpdate().execute();
      const from = rows.find((r) => r.id === req.params.id);
      const into = rows.find((r) => r.id === intoId);
      if (!from || !into) throw notFound('Lieu introuvable.');
      if (from.merged_into || into.merged_into || into.status === 'HIDDEN') throw new ApiError(409, 'PLACE_MERGED', 'Ces deux lieux ne peuvent pas être fusionnés.');
      await trx.updateTable('matches').set({ place_id: intoId }).where('place_id', '=', from.id).execute();
      await trx.updateTable('place_reports').set({ place_id: intoId }).where('place_id', '=', from.id).where('status', '=', 'OPEN')
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('place_reports as o').select('o.id')
          .whereRef('o.reporter_id', '=', 'place_reports.reporter_id').where('o.place_id', '=', intoId).where('o.status', '=', 'OPEN'))))
        .execute();
      await trx.updateTable('places').set({ status: 'HIDDEN', merged_into: intoId, updated_at: new Date() }).where('id', '=', from.id).execute();
      return { from: from.name, into: into.name };
    });
    await writeAudit(db, {
      actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN', action: 'PLACE_MERGED', objectType: 'place', objectId: intoId,
      summary: `a fusionné le lieu ${names.from} avec ${names.into}`,
    });
    return reply.send({ ok: true });
  });

  /** Importer une liste (lignes déjà lues par la console depuis un fichier Excel ou CSV) : chaque ligne valide arrive « À vérifier » ;
      les doublons (même nom à moins de 150 m) sont ignorés. 2 000 lignes au plus par envoi. */
  app.post<{ Body: { rows?: unknown; file?: unknown; filename?: unknown } }>('/platform/places/import', { ...superadmin, bodyLimit: 4_000_000 }, async (req, reply) => {
    let rows: unknown[] | null = Array.isArray(req.body?.rows) ? (req.body!.rows as unknown[]) : null;
    if (!rows && typeof req.body?.file === 'string') {
      const filename = String(req.body.filename ?? 'lieux.xlsx');
      if (!/\.(xlsx|csv|txt)$/i.test(filename)) throw badRequest('Fichier Excel (.xlsx) ou CSV seulement.', 'IMPORT_FORMAT');
      try { rows = await rowsFromFile(filename, Buffer.from(req.body.file, 'base64')); }
      catch { throw badRequest('Ce fichier ne se lit pas. Enregistre-le en .xlsx ou en .csv.', 'IMPORT_FORMAT'); }
    }
    if (!rows || rows.length === 0) throw badRequest('Le fichier ne contient aucune ligne.', 'IMPORT_EMPTY');
    if (rows.length > 2000) throw badRequest('2 000 lignes au plus par fichier.', 'IMPORT_TOO_LARGE');
    let created = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const parsed = raw && typeof raw === 'object' ? parsePlaceInput(raw as Record<string, unknown>) : { ok: false as const, message: 'Ligne vide.' };
      if (!parsed.ok) { errors.push({ row: i + 2, message: parsed.message }); continue; }
      if (await findDuplicate(db, parsed.place)) { skipped += 1; continue; }
      await db.insertInto('places').values({ ...parsed.place, name_key: placeNameKey(parsed.place.name), source: 'IMPORT', created_by: null }).execute();
      created += 1;
    }
    if (created > 0) {
      await writeAudit(db, {
        actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN', action: 'PLACES_IMPORTED', objectType: 'place', objectId: 'import',
        summary: `a importé ${created} lieu${created > 1 ? 'x' : ''} à vérifier`,
      });
    }
    return reply.send({ created, skipped, errors: errors.slice(0, 50), errorCount: errors.length });
  });
}
