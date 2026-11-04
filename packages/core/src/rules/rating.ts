/* =============================================================================
   RÈGLES — NOTATION & RÉSULTATS (Phase 10).
   Les règles fines, tranchées (révocables — voir la revue de risque) :
   R1  On ne note qu'après avoir joué : match PLAYED, noteur inscrit.
   R2  Cibles : les autres joueurs du match, le terrain, le match. Jamais soi.
   R3  Fenêtre : 72 h après le coup d'envoi. Modifiable dans la fenêtre
       (la nouvelle note remplace l'ancienne), verrouillée après.
   R4  Agrégation seulement : moyenne joueur affichée à partir de 3 notes
       (cohérent avec le seuil OVR), moyenne terrain à partir de 5 avis.
       Jamais de note individuelle exposée.
   R5  Seuls les résultats CONFIRMÉS comptent ; un nul ne compte ni victoire
       ni défaite dans le winRate.
   ========================================================================== */

import type { Match, MatchPlayer, MatchResult, Rating } from '../entities.js';
import { activePlayers } from './match.js';
import { fail, ok, type RuleResult } from '../result.js';

export const RATING_WINDOW_MS = 72 * 3_600_000;
export const PLAYER_RATING_MIN_COUNT = 3;   // aligné sur OVR_MIN_RATED_MATCHES
export const VENUE_RATING_MIN_COUNT = 5;

/* --- Noter ------------------------------------------------------------------- */

export function canRate(p: {
  match: Match;
  players: readonly MatchPlayer[];
  raterId: string;
  targetType: Rating['targetType'];
  targetId: string;
  now: number;
}): RuleResult {
  if (p.match.status !== 'PLAYED') {
    return fail('NOT_PLAYED', 'On note après avoir joué — pas avant.');
  }
  const joined = activePlayers(p.players);
  if (!joined.some((x) => x.userId === p.raterId)) {
    return fail('NOT_JOINED', 'Seuls les joueurs du match peuvent noter.');
  }
  if (p.now > p.match.range.start + RATING_WINDOW_MS) {
    return fail('RATING_WINDOW_CLOSED', 'La fenêtre de notation est fermée (72 h après le match).');
  }
  if (p.targetType === 'PLAYER') {
    if (p.targetId === p.raterId) return fail('SELF_RATING', 'On ne se note pas soi-même.');
    if (!joined.some((x) => x.userId === p.targetId)) {
      return fail('INVALID_TARGET', 'Ce joueur n’a pas joué ce match.');
    }
  }
  if (p.targetType === 'VENUE' && p.targetId !== p.match.venueId) {
    return fail('INVALID_TARGET', 'Le terrain noté n’est pas celui du match.');
  }
  if (p.targetType === 'MATCH' && p.targetId !== p.match.id) {
    return fail('INVALID_TARGET', 'Ce n’est pas ce match.');
  }
  return ok;
}

/** Une note par (noteur, cible, match) — la nouvelle remplace l'ancienne
    tant que la fenêtre est ouverte (l'unicité est aussi tenue par la base). */
export function applyRating(existing: readonly Rating[], r: Rating): Rating[] {
  const same = (x: Rating) =>
    x.raterId === r.raterId && x.targetType === r.targetType &&
    x.targetId === r.targetId && x.matchId === r.matchId;
  return existing.some(same)
    ? existing.map((x) => (same(x) ? r : x))
    : [...existing, r];
}

/** Agrégat affichable — jamais une note individuelle. */
export function ratingSummary(
  ratings: readonly Rating[], targetType: Rating['targetType'], targetId: string,
): { avg: number | null; count: number; visible: boolean } {
  const rs = ratings.filter((x) => x.targetType === targetType && x.targetId === targetId);
  const count = rs.length;
  if (count === 0) return { avg: null, count: 0, visible: false };
  const avg = Math.round((rs.reduce((s, x) => s + x.stars, 0) / count) * 10) / 10;
  const min = targetType === 'VENUE' ? VENUE_RATING_MIN_COUNT : PLAYER_RATING_MIN_COUNT;
  return { avg, count, visible: count >= min };
}

/* --- Résultats : appliers & balayage ------------------------------------------ */

export function submitResult(p: {
  match: Match; reporterId: string; homeScore: number; awayScore: number; now: number;
}): { result: RuleResult; matchResult?: MatchResult } {
  if (p.match.status !== 'PLAYED' && p.match.status !== 'LOCKED') {
    return { result: fail('MATCH_NOT_OPEN', 'Le résultat se saisit après le coup d’envoi.') };
  }
  if (p.match.organizerId !== p.reporterId) {
    return { result: fail('NOT_ORGANIZER', 'Seul l’organisateur saisit le résultat ; l’adversaire le confirme.') };
  }
  if (p.homeScore < 0 || p.awayScore < 0 || !Number.isInteger(p.homeScore) || !Number.isInteger(p.awayScore)) {
    return { result: fail('INVALID_TARGET', 'Un score est un entier positif.') };
  }
  return {
    result: ok,
    matchResult: {
      matchId: p.match.id, homeScore: p.homeScore, awayScore: p.awayScore,
      reportedBy: p.reporterId, reportedAt: p.now, status: 'PENDING_CONFIRMATION',
    },
  };
}

export function confirmResult(r: MatchResult, confirmerId: string, now: number):
  { result: RuleResult; matchResult?: MatchResult } {
  if (r.status !== 'PENDING_CONFIRMATION') {
    return { result: fail('RESULT_ALREADY_CONFIRMED', 'Ce résultat a déjà été traité.') };
  }
  if (confirmerId === r.reportedBy) {
    return { result: fail('NOT_OPPONENT', 'La confirmation vient de l’équipe adverse.') };
  }
  return { result: ok, matchResult: { ...r, status: 'CONFIRMED', confirmedBy: confirmerId, confirmedAt: now } };
}

export function disputeResult(r: MatchResult, disputerId: string):
  { result: RuleResult; matchResult?: MatchResult } {
  if (r.status !== 'PENDING_CONFIRMATION') {
    return { result: fail('RESULT_ALREADY_CONFIRMED', 'Ce résultat a déjà été traité.') };
  }
  if (disputerId === r.reportedBy) {
    return { result: fail('NOT_OPPONENT', 'On ne conteste pas son propre score.') };
  }
  return { result: ok, matchResult: { ...r, status: 'DISPUTED' } };
}

/** Balayage serveur : sans réponse sous 24 h, le score saisi devient officiel. */
export function sweepAutoConfirm(
  rs: readonly MatchResult[], now: number, ttlMs = 24 * 3_600_000,
): { results: MatchResult[]; confirmedIds: string[] } {
  const confirmedIds: string[] = [];
  const results = rs.map((r) => {
    if (r.status === 'PENDING_CONFIRMATION' && now >= r.reportedAt + ttlMs) {
      confirmedIds.push(r.matchId);
      return { ...r, status: 'CONFIRMED' as const, confirmedAt: now };
    }
    return r;
  });
  return { results, confirmedIds };
}

/** Issue d'un résultat pour un camp. Un nul ne compte ni victoire ni défaite (R5). */
export function outcomeFor(r: MatchResult, side: 'HOME' | 'AWAY'): 'WIN' | 'LOSS' | 'DRAW' {
  if (r.homeScore === r.awayScore) return 'DRAW';
  const homeWon = r.homeScore > r.awayScore;
  return (side === 'HOME') === homeWon ? 'WIN' : 'LOSS';
}

/** winRate pour l'OVR, sur résultats CONFIRMÉS uniquement, nuls exclus. */
export function winRateFrom(outcomes: readonly ('WIN' | 'LOSS' | 'DRAW')[]): number {
  const wins = outcomes.filter((o) => o === 'WIN').length;
  const losses = outcomes.filter((o) => o === 'LOSS').length;
  return wins + losses === 0 ? 0 : wins / (wins + losses);
}
