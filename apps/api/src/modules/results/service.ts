import type { Selectable } from 'kysely';
import {
  OVR_MIN_RATED_MATCHES, PLAYER_RATING_MIN_COUNT, VENUE_RATING_MIN_COUNT,
  computeOvr, explainOvr, outcomeFor, ratingSummary, sweepAutoConfirm, winRateFrom, RECIPIENTS,
  type MatchResult, type OvrInputs, type Rating,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { MatchResultsTable, RatingsTable } from '../../db/types.js';
import { writeNotifications } from '../../notifications/write.js';

export type MatchResultRow = Selectable<MatchResultsTable>;
export type RatingRow = Selectable<RatingsTable>;

export function rowToMatchResult(row: MatchResultRow): MatchResult {
  return {
    matchId: row.match_id, homeScore: row.home_score, awayScore: row.away_score,
    reportedBy: row.reported_by, reportedAt: row.reported_at.getTime(), status: row.status,
    ...(row.confirmed_by !== null ? { confirmedBy: row.confirmed_by } : {}),
    ...(row.confirmed_at !== null ? { confirmedAt: row.confirmed_at.getTime() } : {}),
  };
}

export function publicResult(row: MatchResultRow): Record<string, unknown> {
  return {
    matchId: row.match_id, homeScore: row.home_score, awayScore: row.away_score,
    reportedBy: row.reported_by, reportedAt: row.reported_at.getTime(), status: row.status,
    confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at ? row.confirmed_at.getTime() : null,
  };
}

export function rowToRating(row: RatingRow): Rating {
  return {
    id: row.id, raterId: row.rater_id, targetType: row.target_type, targetId: row.target_id,
    matchId: row.match_id, stars: row.stars as Rating['stars'], createdAt: row.created_at.getTime(),
    ...(row.comment !== null ? { comment: row.comment } : {}),
  };
}

export async function loadResult(db: Db, matchId: string): Promise<MatchResultRow | undefined> {
  return db.selectFrom('match_results').selectAll().where('match_id', '=', matchId).executeTakeFirst();
}

export async function loadResultForUpdate(db: Db, matchId: string): Promise<MatchResultRow | undefined> {
  return db.selectFrom('match_results').selectAll().where('match_id', '=', matchId).forUpdate().executeTakeFirst();
}

/** Auto-confirmation paresseuse à 24 h — même discipline que l'expiration
    paresseuse des défis (docs/DECISIONS.md) : appliquée au point de contact,
    pas de tâche planifiée dans cette tranche. Passe TOUJOURS par le
    balayage canonique du core (`sweepAutoConfirm`, rating.ts) — jamais par
    un recalcul maison de l'échéance (les gardes autonomes de results.ts,
    `autoConfirmDue` incluse, sont dépréciées, voir docs/CANONICALISATION.md). */
export async function syncResultLifecycle(db: Db, row: MatchResultRow, now: number): Promise<MatchResultRow> {
  if (row.status !== 'PENDING_CONFIRMATION') return row;
  const { results } = sweepAutoConfirm([rowToMatchResult(row)], now);
  if (results[0]!.status !== 'CONFIRMED') return row;
  // Précondition explicite sur le statut lu (pas de verrou ici, ce chemin est
  // en lecture, GET) : sans elle, une confirmation/contestation concurrente
  // (route confirm/dispute, verrouillée, transactionnelle) pourrait committer
  // entre notre lecture et cette écriture — le blind UPDATE écraserait alors
  // un DISPUTED tout juste posé pour le renvoyer à CONFIRMED. Trouvé en revue.
  const updated = await db.updateTable('match_results').set({ status: 'CONFIRMED', confirmed_at: new Date(now) })
    .where('match_id', '=', row.match_id).where('status', '=', 'PENDING_CONFIRMATION')
    .returningAll().executeTakeFirst();
  /* Lot P1, point 4 (décision Aymen 04/09/2026) : le rapporteur apprend aussi
     que son score est devenu officiel quand c'est le SILENCE de l'adversaire
     qui l'a validé — même notification que la route confirm. `updated` n'est
     renvoyé que par la requête qui a réellement fait la transition : une
     seule écriture, jamais de doublon avec la route confirm (verrouillée,
     qui refuse RESULT_ALREADY_CONFIRMED si l'auto-confirmation a gagné). */
  if (updated) {
    await writeNotifications(db, RECIPIENTS.resultConfirmed(updated.reported_by), 'RESULT_CONFIRMED', updated.match_id, now);
  }
  return updated ?? (await loadResult(db, row.match_id))!;
}

/* P1-A (audit pré-lancement, lot 9, 27/09/2026) — le vrai correctif : `syncResultLifecycle` ci-dessus n'agit que
   sur le résultat que la requête en cours a déjà en main (un contact précis) ; un résultat jamais rouvert par
   personne après sa saisie restait PENDING_CONFIRMATION indéfiniment, jamais confirmé, jamais compté dans l'OVR
   ni le classement. Même transition que `syncResultLifecycle` (core `sweepAutoConfirm`, la même garde de statut
   pour ne jamais écraser une contestation posée entre la lecture et l'écriture), appliquée à TOUS les résultats
   en attente d'un coup, par le balayage périodique (jobs/periodic-sweep.ts, sous son verrou). */
export async function sweepResultAutoConfirm(db: Db, now: number): Promise<number> {
  const pending = await db.selectFrom('match_results').selectAll().where('status', '=', 'PENDING_CONFIRMATION').execute();
  if (pending.length === 0) return 0;
  const { confirmedIds } = sweepAutoConfirm(pending.map(rowToMatchResult), now);
  let confirmed = 0;
  for (const matchId of confirmedIds) {
    const updated = await db.updateTable('match_results').set({ status: 'CONFIRMED', confirmed_at: new Date(now) })
      .where('match_id', '=', matchId).where('status', '=', 'PENDING_CONFIRMATION')
      .returning('reported_by').executeTakeFirst();
    if (!updated) continue; // contestée entre-temps (course avec la route dispute) — rien à confirmer, rien à notifier
    await writeNotifications(db, RECIPIENTS.resultConfirmed(updated.reported_by), 'RESULT_CONFIRMED', matchId, now);
    confirmed++;
  }
  return confirmed;
}

/** `ratingSummary` (core) opère sur un tableau en mémoire — à l'échelle d'un
    centre pilote, charger les notes d'UNE cible reste trivial. À revisiter
    si un joueur/terrain accumule des milliers d'avis (agrégation SQL directe
    perdrait la garantie que le seuil de visibilité vient bien du core). */
export async function ratingSummaryFor(
  db: Db, targetType: Rating['targetType'], targetId: string,
): Promise<{ avg: number | null; count: number; visible: boolean }> {
  const rows = await db.selectFrom('ratings').selectAll()
    .where('target_type', '=', targetType).where('target_id', '=', targetId).execute();
  return ratingSummary(rows.map(rowToRating), targetType, targetId);
}

/** Même résultat que N appels à `ratingSummaryFor`, en UNE requête (A5, cadrage multi-centre/
    scalabilité 22/09/2026 : « note calculée en lot, pas un appel par centre »). Le core reste
    l'unique arbitre du calcul (`ratingSummary`) — juste appelé sur un sous-ensemble en mémoire
    par cible plutôt que sur une requête SQL par cible. Renvoie une entrée pour CHAQUE id demandé,
    y compris `{avg: null, count: 0, visible: false}` si personne n'a encore noté. */
export async function ratingSummaryForMany(
  db: Db, targetType: Rating['targetType'], targetIds: readonly string[],
): Promise<Map<string, { avg: number | null; count: number; visible: boolean }>> {
  const summaries = new Map<string, { avg: number | null; count: number; visible: boolean }>();
  if (targetIds.length === 0) return summaries;
  const rows = await db.selectFrom('ratings').selectAll()
    .where('target_type', '=', targetType).where('target_id', 'in', targetIds).execute();
  const all = rows.map(rowToRating);
  for (const id of targetIds) summaries.set(id, ratingSummary(all, targetType, id));
  return summaries;
}

export interface OvrResult {
  ovr: number | null;
  explanation: string;
  inputs: OvrInputs;
}

/** Le winRate individuel n'a de sens que pour un match à deux « camps »
    identifiables — le core n'a AUCUNE notion de camp pour un roster libre
    (gap documenté depuis l'audit initial, docs/CANONICALISATION.md). Seuls
    les matchs issus d'un défi en ont un, implicitement : l'organisateur
    (capitaine émetteur, HOME) et l'unique autre inscrit (capitaine défié,
    AWAY) — garanti par la garde `MATCH_PRIVATE` sur /join (aucun tiers ne
    peut s'y ajouter). Décision API documentée, pas une règle core. */
async function computeWinRateForUser(db: Db, userId: string): Promise<number> {
  const rows = await db.selectFrom('match_results')
    .innerJoin('matches', 'matches.id', 'match_results.match_id')
    .select(['match_results.home_score', 'match_results.away_score', 'matches.organizer_id', 'matches.id as match_id'])
    .where('match_results.status', '=', 'CONFIRMED')
    .where('matches.challenge_id', 'is not', null)
    .where((eb) => eb.exists(
      eb.selectFrom('match_players').select('user_id')
        .whereRef('match_players.match_id', '=', 'matches.id')
        .where('match_players.user_id', '=', userId)
        .where('match_players.status', '=', 'JOINED'),
    ))
    .execute();
  const outcomes = rows.map((r) => outcomeFor(
    {
      matchId: r.match_id, homeScore: r.home_score, awayScore: r.away_score,
      reportedBy: '', reportedAt: 0, status: 'CONFIRMED',
    },
    r.organizer_id === userId ? 'HOME' : 'AWAY',
  ));
  return winRateFrom(outcomes);
}

export async function computeOvrForUser(db: Db, userId: string): Promise<OvrResult> {
  const ratedRow = await db.selectFrom('ratings')
    .select((eb) => eb.fn.count<string>('match_id').distinct().as('n'))
    .where('target_type', '=', 'PLAYER').where('target_id', '=', userId)
    .executeTakeFirstOrThrow();
  const ratedMatches = Number(ratedRow.n);

  const playedRow = await db.selectFrom('match_players')
    .innerJoin('matches', 'matches.id', 'match_players.match_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('match_players.user_id', '=', userId)
    .where('match_players.status', '=', 'JOINED')
    .where('matches.status', '=', 'PLAYED')
    .executeTakeFirstOrThrow();
  const matchesPlayed = Number(playedRow.n);

  let avgRating = 0;
  if (ratedMatches >= OVR_MIN_RATED_MATCHES) {
    const summary = await ratingSummaryFor(db, 'PLAYER', userId);
    avgRating = summary.avg ?? 0;
  }
  const winRate = await computeWinRateForUser(db, userId);

  const inputs: OvrInputs = { ratedMatches, avgRating, winRate, matchesPlayed };
  return { ovr: computeOvr(inputs), explanation: explainOvr(inputs), inputs };
}

export { PLAYER_RATING_MIN_COUNT, VENUE_RATING_MIN_COUNT };
