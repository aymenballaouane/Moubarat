import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../../db/client.js';
import { ALGIERS_OFFSET_MS, dayStartMs } from '../../lib/algiers.js';
import { badRequest } from '../../lib/http.js';
import { accentInsensitiveRegex } from '../../lib/search.js';

/* Fil des matchs à rejoindre (Explorer › Matchs) — filtres CÔTÉ SERVEUR (mise à l'échelle L3, 25/09/2026, décision
   d'Aymen : « filtres serveur + Afficher plus »).

   Avant : l'app chargeait les 50 matchs les plus proches et filtrait en mémoire (sport, jour, « ce soir », week-end,
   texte). À 15 centres, un filtre (un jour, un niveau, un centre) ne voyait jamais un match plus lointain que le 50ᵉ :
   des matchs existaient et n'apparaissaient nulle part. Désormais chaque filtre est une condition SQL, la liste est
   paginée par curseur, et le décompte par jour du bandeau de jours vient d'une route dédiée.

   Un match figure au fil s'il est PUBLIC, OUVERT ou COMPLET, et pas terminé (`upper(time_range) > now` — le statut
   stocké est mis à jour paresseusement, la vérité vient de l'horaire réel : voir F2, docs/DECISIONS.md, migration 0025).

   Heures et jours sont ceux d'ALGER (UTC+1 fixe, `ALGIERS_OFFSET_MS`), jamais ceux du serveur ni du navigateur. */

const SPORTS = ['FOOTBALL', 'PADEL', 'BASKET'] as const;
const LEVELS = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'] as const;
/** Villes du filtre « Où ? » de l'app (mêmes valeurs que `users.city`) ; AUTRE = aucune des six. */
const CITIES = ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF'] as const;
const CITY_FILTERS = [...CITIES, 'AUTRE'] as const;
const FORMATS_MAX = 8;
export type FeedSport = (typeof SPORTS)[number];

export interface FeedQuery {
  sport?: string; venueId?: string; day?: string; evening?: string; weekend?: string; q?: string;
  /** Filtres de la page « Filtres » (Lot 5) : niveaux et formats en liste séparée par des virgules, ville, « avec de la place ». */
  level?: string; format?: string; city?: string; spots?: string;
}

export interface FeedFilters {
  sport?: FeedSport;
  venueId?: string;
  /** Début (ms) du jour d'Alger demandé. */
  dayStart?: number;
  /** Début à 18 h d'Alger ou plus tard (« ce soir »). */
  evening: boolean;
  /** Samedi ou dimanche d'Alger — parité avec le filtre « week-end » historique de l'app (getDay() 6 ou 0). */
  weekend: boolean;
  /** Un des niveaux demandés (un match n'a qu'UN niveau : plusieurs valeurs = « l'un ou l'autre »). */
  levels?: string[];
  /** Un des formats demandés (« 5v5,7v7 »). */
  formats?: string[];
  /** Centre situé dans cette ville (wilaya du centre) ; `AUTRE` = hors des six villes proposées. */
  city?: (typeof CITY_FILTERS)[number];
  /** Seulement les matchs où il reste de la place (statut OUVERT — un match COMPLET reste dans le fil, pas ici). */
  spots: boolean;
  /** Texte cherché dans le titre et le format, insensible à la casse et aux accents. */
  q?: string;
}

export function parseFeedFilters(query: FeedQuery): FeedFilters {
  const filters: FeedFilters = { evening: query.evening === '1', weekend: query.weekend === '1', spots: query.spots === '1' };
  if (query.sport) {
    if (!(SPORTS as readonly string[]).includes(query.sport)) throw badRequest('Sport invalide.');
    filters.sport = query.sport as FeedSport;
  }
  if (query.venueId) filters.venueId = query.venueId;
  if (query.level) {
    const levels = [...new Set(query.level.split(',').map((x) => x.trim()).filter(Boolean))];
    if (!levels.every((l) => (LEVELS as readonly string[]).includes(l))) throw badRequest('Niveau invalide.');
    if (levels.length > 0) filters.levels = levels;
  }
  if (query.format) {
    const formats = [...new Set(query.format.split(',').map((x) => x.trim()).filter(Boolean))];
    if (formats.length > FORMATS_MAX || !formats.every((f) => /^[A-Za-z0-9]{2,12}$/.test(f))) throw badRequest('Format invalide.');
    if (formats.length > 0) filters.formats = formats;
  }
  if (query.city) {
    if (!(CITY_FILTERS as readonly string[]).includes(query.city)) throw badRequest('Ville invalide.');
    filters.city = query.city as (typeof CITY_FILTERS)[number];
  }
  if (query.day) {
    try { filters.dayStart = dayStartMs(query.day); }
    catch { throw badRequest('Paramètre day attendu au format YYYY-MM-DD.'); }
  }
  const q = (query.q ?? '').trim();
  if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
  if (q !== '') filters.q = q;
  return filters;
}

/** Début du match en heure LOCALE d'Alger (`timestamp` sans fuseau) — la base de « ce soir », « week-end » et du jour. */
const startLocal = sql`((lower(matches.time_range) AT TIME ZONE 'UTC') + ${ALGIERS_OFFSET_MS / 1000}::int * interval '1 second')`;

/** Conditions SQL du fil, partagées par la liste, le total et les décomptes par jour. Colonnes qualifiées `matches.`. */
export function feedConditions(f: FeedFilters, now: Date): RawBuilder<boolean>[] {
  const conds: RawBuilder<boolean>[] = [
    sql<boolean>`matches.visibility = 'OPEN'`,
    sql<boolean>`matches.status IN ('OPEN', 'FULL')`,
    sql<boolean>`upper(matches.time_range) > ${now}`,
  ];
  if (f.sport) conds.push(sql<boolean>`matches.sport = ${f.sport}`);
  if (f.venueId) conds.push(sql<boolean>`matches.venue_id = ${f.venueId}::uuid`);
  if (f.dayStart !== undefined) {
    conds.push(sql<boolean>`lower(matches.time_range) >= ${new Date(f.dayStart)} AND lower(matches.time_range) < ${new Date(f.dayStart + 86_400_000)}`);
  }
  if (f.levels) conds.push(sql<boolean>`matches.level::text IN (${sql.join(f.levels)})`);
  if (f.formats) conds.push(sql<boolean>`matches.format::text IN (${sql.join(f.formats)})`);
  if (f.city) {
    // Ville du CENTRE (wilaya), insensible aux accents et à la casse (« Sétif » = « SETIF »), comme la recherche texte.
    const named = (c: string) => sql<boolean>`venues.wilaya ~* ${'^' + accentInsensitiveRegex(c === 'SETIF' ? 'Sétif' : c)}`;
    const where = f.city === 'AUTRE'
      ? sql<boolean>`NOT (${sql.join(CITIES.map(named), sql` OR `)})`
      : named(f.city);
    conds.push(sql<boolean>`matches.venue_id IN (SELECT venues.id FROM venues WHERE ${where})`);
  }
  if (f.spots) conds.push(sql<boolean>`matches.status = 'OPEN'`);
  if (f.evening) conds.push(sql<boolean>`extract(hour from ${startLocal}) >= 18`);
  if (f.weekend) conds.push(sql<boolean>`extract(dow from ${startLocal}) IN (0, 6)`);
  if (f.q) {
    const re = accentInsensitiveRegex(f.q);
    conds.push(sql<boolean>`(matches.title ~* ${re} OR matches.format::text ~* ${re})`);
  }
  return conds;
}

/** Nombre de matchs du fil PAR JOUR d'Alger, sur `days` jours à partir de `fromDayStart` (bandeau de jours de
    l'Explorer). Ne tient compte que du sport et du centre : le décompte d'un jour ne change pas quand on choisit
    « ce soir » ou qu'on tape un texte — comportement historique du bandeau. Les jours sans match sont absents. */
export async function feedDayCounts(
  db: Db, f: Pick<FeedFilters, 'sport' | 'venueId'>, fromDayStart: number, days: number, now: Date,
): Promise<Record<string, number>> {
  const conds = feedConditions({ ...f, evening: false, weekend: false, spots: false }, now);
  conds.push(sql<boolean>`lower(matches.time_range) >= ${new Date(fromDayStart)} AND lower(matches.time_range) < ${new Date(fromDayStart + days * 86_400_000)}`);
  let q = db.selectFrom('matches').select([
    sql<string>`to_char(${startLocal}::date, 'YYYY-MM-DD')`.as('day'),
    sql<string>`count(*)::text`.as('n'),
  ]);
  for (const c of conds) q = q.where(c);
  const rows = await q.groupBy(sql`1`).execute();
  return Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));
}
