import { sql } from 'kysely';
import { cancellationKind, clientReliabilityV1, type ReliabilityV1 } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { encodeCursor, isoMicros, pageOf, type CursorValue } from '../../lib/cursor.js';
import { accentInsensitiveRegex } from '../../lib/search.js';
import { phoneSearchPatterns } from '../../lib/phone-search.js';
import { operatingDateOf } from '../../lib/algiers.js';

export interface ClientSummary {
  /** P0-2 (audit stratégique CRM, 15/11/2026, choix d'Aymen « regrouper par numéro ») : deux sortes de clients.
      APP — un compte joueur (`userId`) ; COUNTER — un client du comptoir ou du téléphone, saisi par le centre, sans compte
      Moubarat : toutes ses réservations portent le MÊME numéro (`userId` null). `clientKey` identifie la carte dans les
      deux cas : l'identifiant du compte, ou `tel:` suivi du numéro sans indicatif (`tel:555123456`). */
  clientKey: string;
  kind: 'APP' | 'COUNTER';
  userId: string | null;
  name: string;
  phone: string;
  bookingsCount: number;
  totalSpentDa: number;
  reliability: ReliabilityV1;
  /** Chantier CRM — écran Clients (06/09/2026) : le détail par statut, déjà
      calculé pour nourrir `reliability` ci-dessous, était jusqu'ici jeté
      avant la réponse — l'écran ne pouvait montrer que le score, jamais la
      phrase « X honorées · Y annulées tôt… » qu'il affiche pourtant. */
  honored: number;
  paid: number;
  cancelledEarly: number;
  cancelledLate: number;
  noShow: number;
}

/* MS-071 (audit final, Lot 2b, 18/11/2026) — la fiabilité d'un client ne charge plus TOUT son historique : un club qui réserve
   chaque semaine depuis des années (mesuré : 5 000 réservations) occupait une connexion et le processus à chaque ouverture de
   sa fiche. Les comptes par statut et la dépense sont calculés EN BASE ; seules ses ANNULATIONS remontent, parce que « tôt » ou
   « tard » est une règle du core (`cancellationKind`) qu'on ne recopie jamais en SQL ; le score sort toujours du core
   (`clientReliabilityV1`). Mêmes règles qu'avant, inchangées :
   - périmètre d'un joueur de l'app : ni blocage (CENTER), ni comptoir (WALK_IN), ni réservation posée par un compte PLATEFORME
     (téléphone saisi par le staff, by_user_id = son compte : jamais le client réel — Lot 3, 15/09/2026) ;
   - une annulation STAFF_ERROR disparaît ENTIÈREMENT (ni pénalité, ni comptée dans bookingsCount) — ce n'est pas l'erreur du
     client (15/09/2026, confirmé par Aymen) ;
   - cancelled_at inconnue (annulations antérieures à la migration 0002) : « tôt » par défaut, jamais une pénalité sur une
     donnée absente (docs/DECISIONS.md). */
const KEEP = sql`NOT (b.status = 'CANCELLED' AND b.cancel_reason IS NOT DISTINCT FROM 'STAFF_ERROR')`;
const COUNTS = sql`count(*) FILTER (WHERE ${KEEP})::int AS bookings,
  count(*) FILTER (WHERE b.status = 'HONORED')::int AS honored,
  count(*) FILTER (WHERE b.status = 'PAID')::int AS paid,
  count(*) FILTER (WHERE b.status = 'NO_SHOW')::int AS no_show,
  COALESCE(sum(b.price_total_da) FILTER (WHERE b.status = 'PAID'), 0)::bigint AS spent`;
const appScope = (venueId: string) => sql`f.venue_id = ${venueId}::uuid
  AND b.source NOT IN ('CENTER', 'WALK_IN')
  AND NOT EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.id = b.by_user_id)`;

interface ClientAgg { key: string; name: string; phone: string; bookings: number; honored: number; paid: number; no_show: number; spent: string | number }
interface CancelRow { key: string; time_range: string; cancelled_at: Date | null }
type ClientIdentity = Pick<ClientSummary, 'clientKey' | 'kind' | 'userId'>;
const appIdentity = (userId: string): ClientIdentity => ({ clientKey: userId, kind: 'APP', userId });

function summarizeAgg(who: ClientIdentity, name: string, phone: string, agg: ClientAgg, cancels: readonly CancelRow[]): ClientSummary {
  let cancelledEarly = 0, cancelledLate = 0;
  for (const c of cancels) {
    const kind = c.cancelled_at ? cancellationKind(fromPgRange(c.time_range).start, c.cancelled_at.getTime()) : 'EARLY';
    if (kind === 'LATE') cancelledLate++; else cancelledEarly++;
  }
  const honored = agg.honored, paid = agg.paid, noShow = agg.no_show;
  return {
    ...who, name, phone, bookingsCount: agg.bookings, totalSpentDa: Number(agg.spent),
    honored, paid, cancelledEarly, cancelledLate, noShow,
    reliability: clientReliabilityV1({ honored, paid, cancelledEarly, cancelledLate, noShow }),
  };
}

function groupCancels(rows: readonly CancelRow[]): Map<string, CancelRow[]> {
  const out = new Map<string, CancelRow[]>();
  for (const r of rows) { const l = out.get(r.key); if (l) l.push(r); else out.set(r.key, [r]); }
  return out;
}

/** Le résumé des joueurs de l'app donnés (un compte sans réservation retenue sur ce centre est absent de la réponse). */
async function loadAppClients(db: Db, venueId: string, userIds: readonly string[]): Promise<Map<string, ClientSummary>> {
  const out = new Map<string, ClientSummary>();
  if (userIds.length === 0) return out;
  const ids = [...userIds];
  // Trois lectures indépendantes. Le nom et le numéro sont lus À PART, sur les seuls comptes demandés : joints à l'agrégat,
  // le planificateur (qui sous-estime le nombre de groupes) parcourait les 100 000 joueurs pour en retrouver un — mesuré
  // 50 ms sur 60 pour la fiche d'un seul client. Un compte absent de `users` reste hors du résultat, comme avant (jointure).
  const [aggs, cancels, people] = await Promise.all([
    sql<Omit<ClientAgg, 'name' | 'phone'>>`
      SELECT b.by_user_id::text AS key, ${COUNTS}
      FROM bookings b JOIN fields f ON f.id = b.field_id
      WHERE ${appScope(venueId)} AND b.by_user_id = ANY(${ids}::uuid[])
      GROUP BY b.by_user_id`.execute(db),
    sql<CancelRow>`
      SELECT b.by_user_id::text AS key, b.time_range, b.cancelled_at
      FROM bookings b JOIN fields f ON f.id = b.field_id
      WHERE ${appScope(venueId)} AND b.by_user_id = ANY(${ids}::uuid[])
        AND b.status = 'CANCELLED' AND b.cancel_reason IS DISTINCT FROM 'STAFF_ERROR'`.execute(db),
    db.selectFrom('users').select(['id', 'name', 'phone']).where('id', 'in', ids).execute(),
  ]);
  const who = new Map(people.map((p) => [p.id, p]));
  const byKey = groupCancels(cancels.rows);
  for (const a of aggs.rows) {
    const person = who.get(a.key);
    if (person) out.set(a.key, summarizeAgg(appIdentity(a.key), person.name, person.phone, { ...a, name: person.name, phone: person.phone }, byKey.get(a.key) ?? []));
  }
  return out;
}

/** MS-073 (Lot 2b) : la fiabilité de plusieurs joueurs en UN appel (Dashboard : un par organisateur de match du jour, jusqu'ici
    un appel HTTP chacun). Mêmes règles que la fiche client. */
export async function loadClientsReliability(db: Db, venueId: string, userIds: readonly string[]): Promise<Record<string, ReliabilityV1>> {
  const map = await loadAppClients(db, venueId, userIds);
  return Object.fromEntries([...map].map(([k, v]) => [k, v.reliability]));
}

/* --- Clients du comptoir et du téléphone (P0-2, audit stratégique CRM, 15/11/2026 — choix d'Aymen : « regrouper par numéro ») ---
   Une réservation Comptoir ou Téléphone saisie au CRM porte le compte du MEMBRE DU PERSONNEL qui l'a posée (`by_user_id`), et le
   client n'existe que par le texte saisi : `reservation_name` et `customer_phone` (texte libre : « 0555 12 34 56 »,
   « +213 555… »). Sans compte, aucun client à afficher : l'écran Clients ne montrait que les joueurs de l'app.
   Règle : toutes les réservations Comptoir/Téléphone du centre qui portent le MÊME numéro forment UN client du centre — le
   numéro réduit à ses chiffres, sans indicatif ni zéro initial (`0555 12 34 56` = `+213555123456` = `555123456`). Une
   réservation sans numéro (ou de moins de 8 chiffres) reste hors du fichier : rien ne dit à qui elle appartient. Le nom et le
   numéro affichés sont ceux de la réservation la plus récente. Fiabilité : EXACTEMENT la même règle que pour un joueur
   (`summarizeAgg`, core `clientReliabilityV1`) — même exclusion des erreurs de saisie du centre. Une réservation rattachée puis
   confirmée par un joueur (« C'est moi », règle 21) passe à son compte (`by_user_id`) et quitte ce regroupement d'elle-même.
   Aucune table, aucune migration : le regroupement se calcule à la lecture. */

/** Le numéro d'une réservation réduit à sa forme de regroupement (SQL) : chiffres seuls, sans 00213 / 213 / 0 initial. */
const COUNTER_KEY = sql`(CASE
  WHEN regexp_replace(b.customer_phone, '\\D', '', 'g') LIKE '00213%' THEN substr(regexp_replace(b.customer_phone, '\\D', '', 'g'), 6)
  WHEN regexp_replace(b.customer_phone, '\\D', '', 'g') LIKE '213%' THEN substr(regexp_replace(b.customer_phone, '\\D', '', 'g'), 4)
  WHEN regexp_replace(b.customer_phone, '\\D', '', 'g') LIKE '0%' THEN substr(regexp_replace(b.customer_phone, '\\D', '', 'g'), 2)
  ELSE regexp_replace(b.customer_phone, '\\D', '', 'g') END)`;

/** Les réservations qui comptent pour un client du comptoir (alias `b` sur bookings, `f` sur fields). */
const counterScope = (venueId: string) => sql`f.venue_id = ${venueId}::uuid
  AND b.source IN ('WALK_IN', 'PHONE')
  AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.id = b.by_user_id)
  AND b.customer_phone IS NOT NULL
  AND length(${COUNTER_KEY}) >= 8`;

/** `tel:555123456` → `555123456` ; `null` si la clé n'est pas celle d'un client du comptoir. */
export function counterPhoneKey(clientKey: string): string | null {
  const m = /^tel:(\d{8,12})$/.exec(clientKey);
  return m ? m[1]! : null;
}

/** Le résumé des clients du comptoir donnés (numéros réduits). Nom et numéro affichés : ceux de la réservation la plus récente
    (le dernier nom non vide saisi), y compris une annulation STAFF_ERROR — seule sa place dans le score disparaît. */
async function loadCounterClients(db: Db, venueId: string, keys: readonly string[]): Promise<Map<string, ClientSummary>> {
  const out = new Map<string, ClientSummary>();
  if (keys.length === 0) return out;
  const ks = [...keys];
  const [aggs, cancels] = await Promise.all([
    sql<ClientAgg>`
      SELECT ${COUNTER_KEY} AS key,
        (array_agg(b.reservation_name ORDER BY lower(b.time_range) DESC, b.id DESC) FILTER (WHERE b.reservation_name ~ '\\S'))[1] AS name,
        (array_agg(b.customer_phone ORDER BY lower(b.time_range) DESC, b.id DESC))[1] AS phone,
        ${COUNTS}
      FROM bookings b JOIN fields f ON f.id = b.field_id
      WHERE ${counterScope(venueId)} AND ${COUNTER_KEY} = ANY(${ks}::text[])
      GROUP BY ${COUNTER_KEY}`.execute(db),
    sql<CancelRow>`
      SELECT ${COUNTER_KEY} AS key, b.time_range, b.cancelled_at
      FROM bookings b JOIN fields f ON f.id = b.field_id
      WHERE ${counterScope(venueId)} AND ${COUNTER_KEY} = ANY(${ks}::text[])
        AND b.status = 'CANCELLED' AND b.cancel_reason IS DISTINCT FROM 'STAFF_ERROR'`.execute(db),
  ]);
  const byKey = groupCancels(cancels.rows);
  for (const a of aggs.rows) {
    const name = a.name?.trim() || 'Client du comptoir';
    out.set(a.key, summarizeAgg({ clientKey: `tel:${a.key}`, kind: 'COUNTER', userId: null }, name, a.phone.trim(), a, byKey.get(a.key) ?? []));
  }
  return out;
}

export type ClientSort = 'bookings' | 'spent';

/** Liste des clients du centre, PAGINÉE (mise à l'échelle L3, 25/09/2026 — avant : TOUTES les réservations du centre
    chargées et agrégées en JavaScript, 255 ms et 2,1 Mo pour un centre de 9 500 clients, sans aucune borne).
    Deux temps, pour que la règle de fiabilité reste UNE SEULE, celle du core :
    1. une agrégation SQL par client (nombre de réservations retenues, dépense) sert UNIQUEMENT à ordonner et à borner
       la page — mêmes exclusions que le détail : blocages écartés, annulations STAFF_ERROR ne comptent pas ;
    2. seules les lignes des clients de la page sont chargées, et `summarize` (core : `clientReliabilityV1`,
       `cancellationKind`) en tire le résumé — jamais une pénalité recalculée en SQL.
    P0-2 (15/11/2026) : deux sources dans la même liste, triées ensemble — les joueurs de l'app (par compte) et les clients
    du comptoir et du téléphone (par numéro, voir plus haut). Tri : `bookings` (les habitués d'abord) ou `spent` (dépense
    décroissante, pour « Top clients »), départagé par la clé de la carte (`clientKey`, ordre binaire — pour un joueur,
    le même ordre que son identifiant). Curseur : [métrique, clientKey]. `q` : nom, sans accents ni casse — OU numéro de
    téléphone dès 4 chiffres (CRM-3, 27/09/2026), pour les deux sources. */
export async function listClients(
  db: Db, venueId: string,
  opts: { limit: number; cursor: readonly CursorValue[] | null; q?: string; sort?: ClientSort },
): Promise<{ clients: ClientSummary[]; nextCursor: string | null }> {
  const sort: ClientSort = opts.sort ?? 'bookings';
  const metric = sort === 'spent' ? sql`COALESCE(sum(b.price_total_da) FILTER (WHERE b.status = 'PAID'), 0)` : sql`count(*) FILTER (WHERE NOT (b.status = 'CANCELLED' AND b.cancel_reason = 'STAFF_ERROR'))`;
  const nameRe = opts.q ? accentInsensitiveRegex(opts.q) : null;
  const phones = opts.q ? phoneSearchPatterns(opts.q) : null;
  const appMatch = nameRe
    ? (phones
      ? sql`(u.name ~* ${nameRe} OR regexp_replace(u.phone, '\\D', '', 'g') LIKE ANY(${phones}::text[]))`
      : sql`u.name ~* ${nameRe}`)
    : null;
  // Comptoir : un nom saisi sur l'une de ses réservations, ou son numéro (écrit national ou international).
  const counterMatch = nameRe
    ? (phones
      ? sql`bool_or(coalesce(b.reservation_name, '') ~* ${nameRe} OR ('0' || ${COUNTER_KEY}) LIKE ANY(${phones}::text[]) OR ('213' || ${COUNTER_KEY}) LIKE ANY(${phones}::text[]))`
      : sql`bool_or(coalesce(b.reservation_name, '') ~* ${nameRe})`)
    : null;

  // Agrégat par joueur du centre d'abord (aucune jointure sur `users` : le nom ne sert qu'à filtrer), PUIS jointure
  // sur les seuls joueurs agrégés pour la recherche par nom et le curseur — mesuré le 25/09/2026 (100 000 joueurs,
  // centre de 9 500 réservations) : 755 ms quand la recherche par nom précédait l'agrégat (le planificateur
  // évaluait `translate(name)` sur les 100 000 joueurs), 136 ms quand elle le suit.
  const res = await sql<{ ckey: string; kind: 'APP' | 'COUNTER'; metric: number }>`
    WITH app AS (
      SELECT b.by_user_id AS user_id, (${metric})::bigint AS metric
      FROM bookings b
      JOIN fields f ON f.id = b.field_id
      WHERE f.venue_id = ${venueId}::uuid
        AND b.source NOT IN ('CENTER', 'WALK_IN')
        AND NOT EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.id = b.by_user_id)
      GROUP BY b.by_user_id
    ), counter AS (
      SELECT 'tel:' || ${COUNTER_KEY} AS ckey, (${metric})::bigint AS metric
      FROM bookings b
      JOIN fields f ON f.id = b.field_id
      WHERE ${counterScope(venueId)}
      GROUP BY ${COUNTER_KEY}
      ${counterMatch ? sql`HAVING ${counterMatch}` : sql``}
    ), every_client AS (
      SELECT app.user_id::text AS ckey, 'APP' AS kind, app.metric FROM app
      ${appMatch ? sql`JOIN users u ON u.id = app.user_id WHERE ${appMatch}` : sql``}
      UNION ALL
      SELECT counter.ckey, 'COUNTER' AS kind, counter.metric FROM counter
    )
    SELECT ckey, kind, metric FROM every_client
    ${opts.cursor
      ? sql`WHERE (metric < ${opts.cursor[0]}::bigint OR (metric = ${opts.cursor[0]}::bigint AND ckey COLLATE "C" > ${opts.cursor[1]}::text COLLATE "C"))`
      : sql``}
    ORDER BY metric DESC, ckey COLLATE "C" ASC
    LIMIT ${opts.limit + 1}`.execute(db);
  const ranked = res.rows.map((r) => ({ key: r.ckey, kind: r.kind, metric: Number(r.metric) }));
  const pageRows = ranked.slice(0, opts.limit);
  const nextCursor = ranked.length > opts.limit
    ? encodeCursor([pageRows[pageRows.length - 1]!.metric, pageRows[pageRows.length - 1]!.key])
    : null;

  const appIds = pageRows.filter((r) => r.kind === 'APP').map((r) => r.key);
  const counterKeys = pageRows.filter((r) => r.kind === 'COUNTER').map((r) => r.key.slice(4));
  const [apps, counters] = await Promise.all([loadAppClients(db, venueId, appIds), loadCounterClients(db, venueId, counterKeys)]);
  const clients = pageRows.flatMap(({ key, kind }) => {
    const found = kind === 'COUNTER' ? counters.get(key.slice(4)) : apps.get(key);
    return found ? [found] : [];
  });
  return { clients, nextCursor };
}

/** P0-2 : la carte d'un client du comptoir (`pk` = numéro réduit), ou `null` s'il n'a aucune réservation retenue sur ce centre. */
export async function loadCounterClient(db: Db, venueId: string, pk: string): Promise<ClientSummary | null> {
  return (await loadCounterClients(db, venueId, [pk])).get(pk) ?? null;
}

export async function loadClient(db: Db, venueId: string, userId: string): Promise<ClientSummary | null> {
  return (await loadAppClients(db, venueId, [userId])).get(userId) ?? null;
}

/** Une ligne de l'historique d'un client sur ce centre (CRM-3). `date` = jour d'EXPLOITATION (BUG-9) : celui que le
    CRM ouvre dans Réservations pour retrouver la fiche. */
export interface ClientBookingHistoryRow {
  id: string; date: string; start: number; end: number;
  status: string; source: string; reference: string | null; fieldName: string;
  priceTotalDa: number; cancelReason: string | null; matchId: string | null;
}

/** Historique des réservations d'UN client sur ce centre, les plus récentes d'abord (heure de début décroissante),
    paginé par curseur [début ISO µs, id]. EXACTEMENT le même périmètre que `loadAppClients` (ce qui compte dans
    sa fiabilité) : jamais un blocage, jamais une résa comptoir/téléphone saisie par le staff dont `by_user_id` serait
    par coïncidence cet identifiant. Une annulation STAFF_ERROR EST listée (avec son motif) — elle n'entre pas dans le
    score, mais l'accueil doit pouvoir la voir. Une résa dont le client n'a rien sur ce centre : liste vide, pas 404 —
    l'écran l'ouvre depuis une carte qui existe déjà. */
export async function listClientBookings(
  db: Db, venueId: string, userId: string, opts: { limit: number; cursor: readonly CursorValue[] | null },
): Promise<{ bookings: ClientBookingHistoryRow[]; nextCursor: string | null }> {
  let q = db.selectFrom('bookings')
    .innerJoin('fields', 'fields.id', 'bookings.field_id')
    .select([
      'bookings.id', 'bookings.time_range', 'bookings.status', 'bookings.source', 'bookings.reference',
      'bookings.price_total_da', 'bookings.cancel_reason', 'bookings.match_id', 'fields.name as field_name',
    ])
    .select(isoMicros(sql`lower(bookings.time_range)`).as('start_cursor'))
    .where('fields.venue_id', '=', venueId)
    .where('bookings.by_user_id', '=', userId)
    .where('bookings.source', 'not in', ['CENTER', 'WALK_IN'])
    .where(({ not, exists, selectFrom }) => not(exists(
      selectFrom('platform_accounts').select('id').whereRef('platform_accounts.id', '=', 'bookings.by_user_id'),
    )))
    .orderBy(sql`lower(bookings.time_range)`, 'desc')
    .orderBy('bookings.id', 'desc')
    .limit(opts.limit + 1);
  if (opts.cursor) {
    q = q.where(sql<boolean>`(lower(bookings.time_range), bookings.id) < (${opts.cursor[0]}::timestamptz, ${opts.cursor[1]}::uuid)`);
  }
  const rows = await q.execute();
  const page = pageOf(rows, opts.limit, (r) => [r.start_cursor, r.id]);
  return {
    bookings: page.items.map((r) => {
      const range = fromPgRange(r.time_range);
      return {
        id: r.id, date: operatingDateOf(range.start), start: range.start, end: range.end,
        status: r.status, source: r.source, reference: r.reference, fieldName: r.field_name,
        priceTotalDa: r.price_total_da, cancelReason: r.cancel_reason, matchId: r.match_id,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

/** P0-2 (15/11/2026) : l'historique d'un client du COMPTOIR (`pk` = son numéro réduit, voir `COUNTER_KEY`) — même forme et
    même pagination que `listClientBookings`, même périmètre que son score (`counterScope`). */
export async function listCounterClientBookings(
  db: Db, venueId: string, pk: string, opts: { limit: number; cursor: readonly CursorValue[] | null },
): Promise<{ bookings: ClientBookingHistoryRow[]; nextCursor: string | null }> {
  const res = await sql<{
    id: string; time_range: string; status: string; source: string; reference: string | null; price_total_da: number;
    cancel_reason: string | null; match_id: string | null; field_name: string; start_cursor: string;
  }>`
    SELECT b.id, b.time_range, b.status, b.source, b.reference, b.price_total_da, b.cancel_reason, b.match_id,
           f.name AS field_name, ${isoMicros(sql`lower(b.time_range)`)} AS start_cursor
    FROM bookings b JOIN fields f ON f.id = b.field_id
    WHERE ${counterScope(venueId)} AND ${COUNTER_KEY} = ${pk}
      ${opts.cursor ? sql`AND (lower(b.time_range), b.id) < (${opts.cursor[0]}::timestamptz, ${opts.cursor[1]}::uuid)` : sql``}
    ORDER BY lower(b.time_range) DESC, b.id DESC
    LIMIT ${opts.limit + 1}`.execute(db);
  const page = pageOf(res.rows, opts.limit, (r) => [r.start_cursor, r.id]);
  return {
    bookings: page.items.map((r) => {
      const range = fromPgRange(r.time_range);
      return {
        id: r.id, date: operatingDateOf(range.start), start: range.start, end: range.end,
        status: r.status, source: r.source, reference: r.reference, fieldName: r.field_name,
        priceTotalDa: r.price_total_da, cancelReason: r.cancel_reason, matchId: r.match_id,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

export interface TeamAtVenue { teamId: string; name: string; crestUrl: string | null; matchesPlayed: number; activeMembers: number; }

/** Équipes ayant joué au moins un match ISSU D'UN DÉFI sur ce centre — un
    match booking-direct (challenge_id NULL) n'a aucune affiliation équipe
    dans le modèle (lacune déjà documentée, docs/CANONICALISATION.md), donc
    n'y contribue jamais. Aucune règle de score inventée — comptages bruts
    uniquement, rien que le core ne définit pas. */
export async function listTeamsAtVenue(db: Db, venueId: string): Promise<TeamAtVenue[]> {
  const rows = await db.selectFrom('matches')
    .innerJoin('challenges', 'challenges.id', 'matches.challenge_id')
    .select(['challenges.from_team_id as from_team_id', 'challenges.to_team_id as to_team_id'])
    .where('matches.venue_id', '=', venueId)
    .where('matches.status', '=', 'PLAYED')
    .execute();
  const matchCountByTeam = new Map<string, number>();
  for (const r of rows) {
    matchCountByTeam.set(r.from_team_id, (matchCountByTeam.get(r.from_team_id) ?? 0) + 1);
    matchCountByTeam.set(r.to_team_id, (matchCountByTeam.get(r.to_team_id) ?? 0) + 1);
  }
  const teamIds = [...matchCountByTeam.keys()];
  if (teamIds.length === 0) return [];
  const [teams, memberCounts] = await Promise.all([
    db.selectFrom('teams').select(['id', 'name', 'crest_url']).where('id', 'in', teamIds).execute(),
    db.selectFrom('team_members').select(['team_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('team_id', 'in', teamIds).where('status', '=', 'ACTIVE').groupBy('team_id').execute(),
  ]);
  const membersByTeam = new Map(memberCounts.map((m) => [m.team_id, Number(m.n)]));
  return teams
    .map((t) => ({
      teamId: t.id, name: t.name, crestUrl: t.crest_url,
      matchesPlayed: matchCountByTeam.get(t.id) ?? 0, activeMembers: membersByTeam.get(t.id) ?? 0,
    }))
    .sort((a, b) => b.matchesPlayed - a.matchesPlayed);
}
