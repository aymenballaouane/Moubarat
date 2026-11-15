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

interface ClientBookingRow {
  user_id: string;
  name: string;
  phone: string;
  status: string;
  price_total_da: number;
  time_range: string;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

async function loadClientBookingRows(db: Db, venueId: string, userIds?: string | readonly string[]): Promise<ClientBookingRow[]> {
  if (Array.isArray(userIds) && userIds.length === 0) return [];
  let q = db.selectFrom('bookings')
    .innerJoin('fields', 'fields.id', 'bookings.field_id')
    .innerJoin('users', 'users.id', 'bookings.by_user_id')
    .select([
      'bookings.by_user_id as user_id', 'users.name as name', 'users.phone as phone',
      'bookings.status as status', 'bookings.price_total_da as price_total_da',
      'bookings.time_range as time_range', 'bookings.cancelled_at as cancelled_at',
      'bookings.cancel_reason as cancel_reason',
    ])
    .where('fields.venue_id', '=', venueId)
    // `CENTER` (blocage) et `WALK_IN` (comptoir) : bug de données réel,
    // trouvé en câblant l'écran Clients (06/09/2026) — `by_user_id` y est le
    // compte PLATEFORME du membre du staff qui a créé la réservation
    // (modules/bookings/routes.ts, POST /bookings), jamais le client réel
    // (aucune identité comptoir n'existe dans ce modèle au-delà du texte
    // libre `reservation_name`/`customer_phone`). Sans cette exclusion, un
    // membre du staff dont l'id `platform_accounts` coïncide avec une vraie
    // ligne `users` (constaté sur le centre pilote) apparaîtrait comme un
    // client — score de fiabilité inclus — pour des réservations qu'il a
    // lui-même saisies, jamais faites en son nom.
    // Lot 3 (15/09/2026, signalé par Aymen) : le canal Téléphone créé depuis
    // le CRM (source PHONE, forceVerified) a EXACTEMENT le même défaut, et
    // `source not in (...)` ne peut pas l'exclure sans exclure AUSSI le
    // PHONE déclaré par un vrai joueur (qui doit, lui, compter). Exclusion
    // structurelle à la place : `by_user_id` est un compte plateforme
    // (jamais un vrai joueur) → NOT EXISTS sur platform_accounts, qui
    // couvre CENTER/WALK_IN/PHONE-staff en une seule règle générale, plutôt
    // que trois cas particuliers qui dérivent à chaque nouveau canal staff.
    .where('bookings.source', 'not in', ['CENTER', 'WALK_IN'])
    .where(({ not, exists, selectFrom }) => not(exists(
      selectFrom('platform_accounts').select('id').whereRef('platform_accounts.id', '=', 'bookings.by_user_id'),
    )));
  if (typeof userIds === 'string') q = q.where('bookings.by_user_id', '=', userIds);
  else if (userIds) q = q.where('bookings.by_user_id', 'in', [...userIds]);
  return q.execute();
}

/** Agrège la fiabilité pondérée (core `clientReliabilityV1`, ops.ts) d'UN
    client à partir de son historique réel de réservations sur ce centre.
    `cancelled_at` inconnue (réservations annulées avant l'ajout de la colonne,
    migration 0002) : traitée comme EARLY par défaut — décision documentée
    (docs/DECISIONS.md), on ne pénalise jamais sur une donnée absente.

    Motif d'annulation (15/09/2026, prérequis avant le premier centre réel,
    confirmé par Aymen) : une annulation STAFF_ERROR disparaît ENTIÈREMENT
    de cet historique — ni pénalité, ni comptée dans `bookingsCount` — filtrée
    ici, avant toute agrégation, jamais dans `clientReliabilityV1` (core,
    gelé, intouché) ni `cancellationKind`. Ce n'est pas l'erreur du client :
    un total gonflé par une faute qui n'est pas la sienne ne serait pas plus
    honnête qu'une pénalité injustifiée. */
type ScoredRow = Pick<ClientBookingRow, 'status' | 'price_total_da' | 'time_range' | 'cancelled_at' | 'cancel_reason'>;
type ClientIdentity = Pick<ClientSummary, 'clientKey' | 'kind' | 'userId'>;
const appIdentity = (userId: string): ClientIdentity => ({ clientKey: userId, kind: 'APP', userId });

function summarize(who: ClientIdentity, name: string, phone: string, allRows: readonly ScoredRow[]): ClientSummary {
  const rows = allRows.filter((r) => !(r.status === 'CANCELLED' && r.cancel_reason === 'STAFF_ERROR'));
  let honored = 0, paid = 0, cancelledEarly = 0, cancelledLate = 0, noShow = 0, totalSpentDa = 0;
  for (const r of rows) {
    if (r.status === 'HONORED') honored++;
    else if (r.status === 'PAID') { paid++; totalSpentDa += r.price_total_da; }
    else if (r.status === 'NO_SHOW') noShow++;
    else if (r.status === 'CANCELLED') {
      const kind = r.cancelled_at
        ? cancellationKind(fromPgRange(r.time_range).start, r.cancelled_at.getTime())
        : 'EARLY';
      if (kind === 'LATE') cancelledLate++; else cancelledEarly++;
    }
  }
  return {
    ...who, name, phone, bookingsCount: rows.length, totalSpentDa,
    honored, paid, cancelledEarly, cancelledLate, noShow,
    reliability: clientReliabilityV1({ honored, paid, cancelledEarly, cancelledLate, noShow }),
  };
}

/* --- Clients du comptoir et du téléphone (P0-2, audit stratégique CRM, 15/11/2026 — choix d'Aymen : « regrouper par numéro ») ---
   Une réservation Comptoir ou Téléphone saisie au CRM porte le compte du MEMBRE DU PERSONNEL qui l'a posée (`by_user_id`), et le
   client n'existe que par le texte saisi : `reservation_name` et `customer_phone` (texte libre : « 0555 12 34 56 »,
   « +213 555… »). Sans compte, aucun client à afficher : l'écran Clients ne montrait que les joueurs de l'app.
   Règle : toutes les réservations Comptoir/Téléphone du centre qui portent le MÊME numéro forment UN client du centre — le
   numéro réduit à ses chiffres, sans indicatif ni zéro initial (`0555 12 34 56` = `+213555123456` = `555123456`). Une
   réservation sans numéro (ou de moins de 8 chiffres) reste hors du fichier : rien ne dit à qui elle appartient. Le nom et le
   numéro affichés sont ceux de la réservation la plus récente. Fiabilité : EXACTEMENT la même règle que pour un joueur
   (`summarize`, core `clientReliabilityV1`) — même exclusion des erreurs de saisie du centre. Une réservation rattachée puis
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

interface CounterRow extends ScoredRow { pk: string; reservation_name: string | null; customer_phone: string }

async function loadCounterRows(db: Db, venueId: string, keys: readonly string[]): Promise<CounterRow[]> {
  if (keys.length === 0) return [];
  const res = await sql<CounterRow>`
    SELECT ${COUNTER_KEY} AS pk, b.reservation_name, b.customer_phone, b.status, b.price_total_da, b.time_range,
           b.cancelled_at, b.cancel_reason
    FROM bookings b JOIN fields f ON f.id = b.field_id
    WHERE ${counterScope(venueId)} AND ${COUNTER_KEY} = ANY(${[...keys]}::text[])
    ORDER BY lower(b.time_range) DESC, b.id DESC`.execute(db);
  return res.rows;
}

function summarizeCounter(pk: string, rows: readonly CounterRow[]): ClientSummary {
  // Lignes triées de la plus récente à la plus ancienne : le nom et le numéro affichés sont les derniers saisis.
  const latest = rows[0]!;
  const name = rows.find((r) => r.reservation_name && r.reservation_name.trim() !== '')?.reservation_name?.trim() ?? 'Client du comptoir';
  return summarize({ clientKey: `tel:${pk}`, kind: 'COUNTER', userId: null }, name, latest.customer_phone.trim(), rows);
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
  const [appRows, counterRows] = await Promise.all([
    loadClientBookingRows(db, venueId, appIds),
    loadCounterRows(db, venueId, counterKeys),
  ]);
  const byUser = new Map<string, ClientBookingRow[]>();
  for (const r of appRows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const byPhone = new Map<string, CounterRow[]>();
  for (const r of counterRows) byPhone.set(r.pk, [...(byPhone.get(r.pk) ?? []), r]);
  const clients = pageRows.flatMap(({ key, kind }) => {
    if (kind === 'COUNTER') {
      const rs = byPhone.get(key.slice(4));
      return rs ? [summarizeCounter(key.slice(4), rs)] : [];
    }
    const rs = byUser.get(key);
    return rs ? [summarize(appIdentity(key), rs[0]!.name, rs[0]!.phone, rs)] : [];
  });
  return { clients, nextCursor };
}

/** P0-2 : la carte d'un client du comptoir (`pk` = numéro réduit), ou `null` s'il n'a aucune réservation retenue sur ce centre. */
export async function loadCounterClient(db: Db, venueId: string, pk: string): Promise<ClientSummary | null> {
  const rows = await loadCounterRows(db, venueId, [pk]);
  return rows.length === 0 ? null : summarizeCounter(pk, rows);
}

export async function loadClient(db: Db, venueId: string, userId: string): Promise<ClientSummary | null> {
  const rows = await loadClientBookingRows(db, venueId, userId);
  if (rows.length === 0) return null;
  return summarize(appIdentity(userId), rows[0]!.name, rows[0]!.phone, rows);
}

/** Une ligne de l'historique d'un client sur ce centre (CRM-3). `date` = jour d'EXPLOITATION (BUG-9) : celui que le
    CRM ouvre dans Réservations pour retrouver la fiche. */
export interface ClientBookingHistoryRow {
  id: string; date: string; start: number; end: number;
  status: string; source: string; reference: string | null; fieldName: string;
  priceTotalDa: number; cancelReason: string | null; matchId: string | null;
}

/** Historique des réservations d'UN client sur ce centre, les plus récentes d'abord (heure de début décroissante),
    paginé par curseur [début ISO µs, id]. EXACTEMENT le même périmètre que `loadClientBookingRows` (ce qui compte dans
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
