import { sql, type Selectable } from 'kysely';
import {
  MATCH_TRANSITIONS, canTransition, isLockedNow, perPlayer, type Match, type MatchPlayer,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { MatchesTable, MatchPlayersTable } from '../../db/types.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { ApiError, notFound } from '../../lib/http.js';

export type MatchRow = Selectable<MatchesTable>;
export type MatchPlayerRow = Selectable<MatchPlayersTable>;

export function rowToMatch(row: MatchRow): Match {
  return {
    id: row.id, sport: row.sport, format: row.format, level: row.level, title: row.title,
    venueId: row.venue_id, fieldId: row.field_id, range: fromPgRange(row.time_range),
    capacity: row.capacity, pricePerPlayer: perPlayer(row.price_per_player_da),
    visibility: row.visibility, status: row.status, organizerId: row.organizer_id,
    coordination: row.coordination === 'WHATSAPP'
      ? { kind: 'WHATSAPP' as const, ...(row.whatsapp_url !== null ? { url: row.whatsapp_url } : {}) }
      : { kind: 'IN_APP' as const },
    createdAt: row.created_at.getTime(),
    ...(row.booking_id !== null ? { bookingId: row.booking_id } : {}),
    ...(row.challenge_id !== null ? { challengeId: row.challenge_id } : {}),
  };
}

export function rowToMatchPlayer(row: MatchPlayerRow): MatchPlayer {
  return {
    matchId: row.match_id, userId: row.user_id, status: row.status, joinedAt: row.joined_at.getTime(),
    ...(row.team !== null ? { team: row.team } : {}),
  };
}

/** `opts.group` : le lien d'invitation du groupe WhatsApp (règle 10) n'est montré qu'à l'organisateur et aux inscrits — jamais dans une liste ni à un visiteur :
    quiconque le lit entre dans le groupe et y voit les numéros de tous les membres. `opts.code` : le code du lien d'un match sur invitation. */
export function publicMatch(row: MatchRow, opts: { group?: boolean; code?: boolean } = {}): Record<string, unknown> {
  const range = fromPgRange(row.time_range);
  return {
    id: row.id, sport: row.sport, format: row.format, level: row.level, title: row.title,
    venueId: row.venue_id, fieldId: row.field_id, start: range.start, end: range.end,
    capacity: row.capacity, pricePerPlayerDa: row.price_per_player_da,
    visibility: row.visibility, status: row.status, organizerId: row.organizer_id,
    coordination: row.coordination, whatsappUrl: opts.group ? row.whatsapp_url : null, hasGroup: row.whatsapp_url !== null, note: row.note,
    // Le code du lien : public pour un match ouvert à tous (il se partage), secret pour un match sur invitation (seulement à qui l'a déjà : organisateur, inscrits, ou via le lien).
    code: row.visibility === 'OPEN' || opts.code ? row.code : null,
    createdAt: row.created_at.getTime(),
  };
}

/** Augmente une liste de PublicMatch avec un compte d'inscrits et, si un
    appelant identifié est fourni, s'il en fait partie — sans quoi un client
    liste (Explorer, Mes matchs) ne peut ni afficher la jauge de capacité ni
    l'état « Inscrit », les deux dérivés de `activePlayers()` (core) côté
    apps/player. Un seul aller-retour supplémentaire (pas de N+1 par match) ;
    GET /matches/:id reste la seule route à exposer le roster nominatif
    complet (`players: [{userId,name,joinedAt}]`), délibérément absent ici. */
export async function withRosterCounts(
  db: Db, rows: MatchRow[], viewerId?: string,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const playerRows = await db.selectFrom('match_players').select(['match_id', 'user_id', 'team'])
    .where('match_id', 'in', ids).where('status', '=', 'JOINED').execute();
  const byMatch = new Map<string, string[]>();
  for (const p of playerRows) {
    const list = byMatch.get(p.match_id) ?? [];
    list.push(p.user_id);
    byMatch.set(p.match_id, list);
  }
  return rows.map((row) => {
    const joined = byMatch.get(row.id) ?? [];
    return {
      ...publicMatch(row),
      joinedCount: joined.length,
      viewerJoined: viewerId !== undefined && joined.includes(viewerId),
      // Règle 3 : MON équipe (jamais celle d'un autre) — de quoi écrire « TU JOUES · ÉQUIPE A » dans Mes matchs sans ouvrir chaque fiche.
      viewerTeam: viewerId === undefined ? null : (playerRows.find((p) => p.match_id === row.id && p.user_id === viewerId)?.team ?? null),
    };
  });
}

/** Verrou d'agrégat, même discipline que les réservations et les équipes :
    toute décision (rejoindre/quitter/retirer/annuler) se prend avec la ligne
    du match verrouillée, pour toute la transaction. */
export async function loadMatchForUpdate(db: Db, id: string): Promise<MatchRow> {
  const row = await db.selectFrom('matches').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw notFound('Match introuvable.');
  return row;
}

export async function loadMatch(db: Db, id: string): Promise<MatchRow> {
  const row = await db.selectFrom('matches').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Match introuvable.');
  return row;
}

/** Fait avancer paresseusement OPEN/FULL → LOCKED → PLAYED selon le temps
    écoulé, en respectant STRICTEMENT la table de transitions du core (jamais
    un saut direct OPEN→PLAYED). Nécessaire car `submitResult`/`canRate` lisent
    le statut STOCKÉ (comparaison littérale), contrairement au verrou
    d'inscription qui dérive `isLockedNow` du temps sans toucher la base.
    Sans ce correctif, aucun match ne devient jamais LOCKED ni PLAYED en base,
    quel que soit le temps écoulé — la Phase 1 n'avait câblé aucune tâche
    planifiée (décision assumée, voir docs/DECISIONS.md) ; ceci en est le
    même principe, appliqué au point de contact plutôt qu'en tâche de fond.
    Idempotent et sans verrou de ligne dédié : appelé depuis un contexte déjà
    verrouillé (soumission de résultat) ou en lecture simple (GET), où une
    réécriture concurrente redondante ne risque aucune incohérence — la
    valeur cible ne dépend que de `now` et de l'horaire fixe du match. */
export async function syncMatchLifecycle(db: Db, row: MatchRow, now: number): Promise<MatchRow> {
  if (row.status !== 'OPEN' && row.status !== 'FULL' && row.status !== 'LOCKED') return row;
  const match = rowToMatch(row);
  let next = row;
  if ((next.status === 'OPEN' || next.status === 'FULL') && isLockedNow(match, now)
    && canTransition(MATCH_TRANSITIONS, next.status, 'LOCKED')) {
    next = await db.updateTable('matches').set({ status: 'LOCKED' })
      .where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
  }
  if (next.status === 'LOCKED' && now >= match.range.end
    && canTransition(MATCH_TRANSITIONS, next.status, 'PLAYED')) {
    next = await db.updateTable('matches').set({ status: 'PLAYED' })
      .where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
  }
  return next;
}

/** Audit final 26/10/2026 (P1-1, MET-2) — `myPlayedMatchIds` lit le statut STOCKÉ, or `syncMatchLifecycle` ne le fait avancer
    qu'à l'ouverture d'UN match précis : trois matchs finis hier, jamais rouverts, laissaient « Joués 0 » au Profil (et vidaient
    « Tes terrains », « tes potes », « Tes amis jouent bientôt »). Même transition que `syncMatchLifecycle` (OPEN/FULL → LOCKED →
    PLAYED, aucun saut interdit : le match est fini, les deux étapes sont franchies), mais EN LOT : tout match non annulé dont
    l'heure de fin est passée devient PLAYED. `userId` borne le travail à ses matchs (appel au contact) ; absent = tous (balayage).
    Idempotent, sans verrou : la valeur cible ne dépend que de `now` et de l'horaire fixe du match. */
export async function markEndedMatchesPlayed(db: Db, now: number, userId?: string): Promise<number> {
  let q = db.updateTable('matches').set({ status: 'PLAYED' })
    .where('status', 'in', ['OPEN', 'FULL', 'LOCKED'])
    .where(sql<boolean>`upper(matches.time_range) <= ${new Date(now)}`);
  if (userId !== undefined) {
    q = q.where((eb) => eb.or([
      eb('matches.organizer_id', '=', userId),
      eb('matches.id', 'in', eb.selectFrom('match_players').select('match_players.match_id')
        .where('match_players.user_id', '=', userId).where('match_players.status', '=', 'JOINED')),
    ]));
  }
  const res = await q.executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function loadPlayers(db: Db, matchId: string): Promise<MatchPlayerRow[]> {
  return db.selectFrom('match_players').selectAll().where('match_id', '=', matchId).execute();
}

/** Tout ce à quoi un joueur est déjà engagé : matchs rejoints (hors annulés)
    + réservations personnelles vivantes — l'un et l'autre bloquent un
    nouveau rejoint sur un créneau qui chevauche (règle core `hasScheduleConflict`). */
export async function userCommitments(db: Db, userId: string, excludeMatchId?: string) {
  const matchRows = await db.selectFrom('match_players')
    .innerJoin('matches', 'matches.id', 'match_players.match_id')
    .select(['matches.id as match_id', 'matches.time_range as time_range'])
    .where('match_players.user_id', '=', userId)
    .where('match_players.status', '=', 'JOINED')
    .where('matches.status', '!=', 'CANCELLED')
    .execute();
  const bookingRows = await db.selectFrom('bookings')
    .select('time_range')
    .where('by_user_id', '=', userId)
    .where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
    .execute();
  return [
    ...matchRows.filter((m) => m.match_id !== excludeMatchId).map((m) => fromPgRange(m.time_range)),
    ...bookingRows.map((b) => fromPgRange(b.time_range)),
  ];
}

/** Le premier engagement du joueur qui chevauche `range` — de quoi écrire « Tu joues déjà à cette heure-là : {centre}, {jour} de {début} à {fin} »
    (règle 24, fenêtre PasPossibleChevauchement). Mêmes engagements que `userCommitments` ; `null` si rien ne chevauche. */
export async function describeConflict(db: Db, userId: string, range: { start: number; end: number }, excludeMatchId?: string):
  Promise<{ venueName: string; start: number; end: number } | null> {
  const matchRows = await db.selectFrom('match_players')
    .innerJoin('matches', 'matches.id', 'match_players.match_id')
    .innerJoin('venues', 'venues.id', 'matches.venue_id')
    .select(['matches.id as match_id', 'matches.time_range as time_range', 'venues.name as venue_name'])
    .where('match_players.user_id', '=', userId).where('match_players.status', '=', 'JOINED')
    .where('matches.status', '!=', 'CANCELLED').execute();
  const bookingRows = await db.selectFrom('bookings')
    .innerJoin('fields', 'fields.id', 'bookings.field_id')
    .innerJoin('venues', 'venues.id', 'fields.venue_id')
    .select(['bookings.time_range as time_range', 'venues.name as venue_name'])
    .where('bookings.by_user_id', '=', userId).where('bookings.status', 'in', ['RESERVED', 'HONORED', 'PAID']).execute();
  const all = [
    ...matchRows.filter((m) => m.match_id !== excludeMatchId).map((m) => ({ ...fromPgRange(m.time_range), venueName: m.venue_name })),
    ...bookingRows.map((b) => ({ ...fromPgRange(b.time_range), venueName: b.venue_name })),
  ];
  const hit = all.find((c) => c.start < range.end && range.start < c.end);
  return hit ? { venueName: hit.venueName, start: hit.start, end: hit.end } : null;
}

/** Règle 32 (Lot 9) : le joueur qui a retiré l'accord « numéro visible » ne peut ni rejoindre un match ni réserver — ce qu'il a déjà pris reste.
    Seul un `false` explicite bloque (un compte sans profil, antérieur aux accords, n'a rien retiré). `403 PHONE_VISIBLE_OFF`. */
export async function assertPhoneVisible(db: Db, userId: string): Promise<void> {
  const p = await db.selectFrom('profiles').select('phone_visible').where('user_id', '=', userId).executeTakeFirst();
  if (p && p.phone_visible === false) {
    throw new ApiError(403, 'PHONE_VISIBLE_OFF',
      'Pour rejoindre un match ou réserver, ton numéro doit être visible par l’organisateur et le centre. Réactive cet accord dans « Mes accords ».');
  }
}

/** Ids des matchs JOUÉS où l'appelant est organisateur ou inscrit — même prédicat que /me/matches,
    filtré au statut PLAYED. Extrait pour être réutilisé par le chargement en lot des résultats/notes
    (F3, cadrage multi-centre/scalabilité 22/09/2026) : avant, le démarrage de l'app faisait un aller-
    retour /matches/:id/result + /matches/:id/my-rating PAR match joué (un joueur à 50 matchs
    déclenchait plus de 100 requêtes) ; voir modules/results/routes.ts GET /me/match-results. */
export async function myPlayedMatchIds(db: Db, userId: string, now: number = Date.now()): Promise<string[]> {
  await markEndedMatchesPlayed(db, now, userId);
  const rows = await db.selectFrom('matches')
    .leftJoin('match_players', (join) => join
      .onRef('match_players.match_id', '=', 'matches.id')
      .on('match_players.user_id', '=', userId)
      .on('match_players.status', '=', 'JOINED'))
    .select('matches.id')
    .where('matches.status', '=', 'PLAYED')
    .where((eb) => eb.or([
      eb('matches.organizer_id', '=', userId),
      eb('match_players.user_id', '=', userId),
    ]))
    .execute();
  return rows.map((r) => r.id);
}

/** Home « Tes amis jouent bientôt » (règle 40, refonte-app-joueur/docs/regles.md, GO d'Aymen
    25/10/2026) — AUCUN système d'amis explicite, AUCUNE nouvelle table : les « potes » sont
    dérivés des matchs déjà JOUÉS ensemble (plus on a joué avec quelqu'un, plus il compte),
    purement en lecture, hors packages/core (gelé — ceci n'est qu'une projection de l'historique
    des rosters, pas une règle métier). */
export async function friendsUpcomingMatches(
  db: Db, viewerId: string, now: Date, opts: { maxFriends?: number; windowMs?: number } = {},
): Promise<Record<string, unknown>[]> {
  const maxFriends = opts.maxFriends ?? 10;
  const windowMs = opts.windowMs ?? 7 * 86_400_000;

  const playedIds = await myPlayedMatchIds(db, viewerId);
  if (playedIds.length === 0) return [];

  // Coéquipiers des matchs joués : organisateur + inscrits (JOINED), comptés par nombre de
  // matchs partagés avec le joueur — pas par nombre de lignes (un même match ne compte qu'une
  // fois par coéquipier, même s'il apparaît à la fois comme organisateur et comme inscrit).
  const organizerRows = await db.selectFrom('matches').select(['id', 'organizer_id'])
    .where('id', 'in', playedIds).execute();
  const playerRows = await db.selectFrom('match_players').select(['match_id', 'user_id'])
    .where('match_id', 'in', playedIds).where('status', '=', 'JOINED').execute();
  const sharedByUser = new Map<string, Set<string>>();
  const addShared = (userId: string, matchId: string) => {
    if (userId === viewerId) return;
    const set = sharedByUser.get(userId) ?? new Set<string>();
    set.add(matchId);
    sharedByUser.set(userId, set);
  };
  for (const r of organizerRows) addShared(r.organizer_id, r.id);
  for (const r of playerRows) addShared(r.user_id, r.match_id);

  const ranked = [...sharedByUser.entries()]
    .map(([userId, matchIds]) => ({ userId, n: matchIds.size }))
    .sort((a, b) => b.n - a.n || a.userId.localeCompare(b.userId))
    .slice(0, maxFriends);
  const coPlayerIds = ranked.map((r) => r.userId);
  if (coPlayerIds.length === 0) return [];

  // Leurs matchs à venir (browsables, pas encore terminés, dans la fenêtre) où au moins un
  // coéquipier organise ou est inscrit — mêmes conditions que le fil Explorer (feed.ts).
  const windowEnd = new Date(now.getTime() + windowMs);
  const idRows = await db.selectFrom('matches')
    .leftJoin('match_players', (join) => join
      .onRef('match_players.match_id', '=', 'matches.id')
      .on('match_players.user_id', 'in', coPlayerIds)
      .on('match_players.status', '=', 'JOINED'))
    .select('matches.id').distinct()
    .where('matches.visibility', '=', 'OPEN')
    .where('matches.status', 'in', ['OPEN', 'FULL', 'LOCKED'])
    .where(sql<boolean>`upper(matches.time_range) > ${now}`)
    .where(sql<boolean>`lower(matches.time_range) <= ${windowEnd}`)
    .where((eb) => eb.or([
      eb('matches.organizer_id', 'in', coPlayerIds),
      eb('match_players.user_id', 'in', coPlayerIds),
    ]))
    .execute();
  const matchIds = idRows.map((r) => r.id);
  if (matchIds.length === 0) return [];

  const rows = await db.selectFrom('matches').selectAll().where('id', 'in', matchIds).execute();
  rows.sort((a, b) => fromPgRange(a.time_range).start - fromPgRange(b.time_range).start || a.id.localeCompare(b.id));

  const friendPlayerRows = await db.selectFrom('match_players').select(['match_id', 'user_id'])
    .where('match_id', 'in', matchIds).where('status', '=', 'JOINED').where('user_id', 'in', coPlayerIds).execute();
  const friendsByMatch = new Map<string, Set<string>>();
  for (const row of rows) {
    if (coPlayerIds.includes(row.organizer_id)) {
      friendsByMatch.set(row.id, new Set([row.organizer_id]));
    }
  }
  for (const r of friendPlayerRows) {
    const set = friendsByMatch.get(r.match_id) ?? new Set<string>();
    set.add(r.user_id);
    friendsByMatch.set(r.match_id, set);
  }

  const users = await db.selectFrom('users').select(['id', 'name']).where('id', 'in', coPlayerIds).execute();
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const withCounts = await withRosterCounts(db, rows, viewerId);
  return withCounts.map((m) => {
    const matchId = m.id as string;
    const friendIds = ranked.map((r) => r.userId).filter((id) => friendsByMatch.get(matchId)?.has(id));
    return { ...m, friends: friendIds.map((id) => ({ userId: id, name: nameById.get(id) ?? '?' })) };
  });
}
