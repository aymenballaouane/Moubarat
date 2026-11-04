/* =============================================================================
   RÈGLES — RÉSULTAT & OVR.
   Décision n°2 de l'audit, appliquée : l'OVR a une formule EXPLICITE, et il
   n'existe pas tant qu'il n'est pas calculable — jamais un nombre inventé.
   Décision n°3 : l'organisateur saisit le résultat, l'adversaire confirme sous 24 h.
   ========================================================================== */

import type { Match, MatchResult } from '../entities.js';
import { RESULT_CONFIRM_TTL_MS } from '../time.js';
import { fail, ok, type RuleResult } from '../result.js';

/* --- Saisie et confirmation du résultat ----------------------------------- */

export function canReportResult(m: Match, reporterId: string): RuleResult {
  if (m.status !== 'PLAYED' && m.status !== 'LOCKED') {
    return fail('MATCH_NOT_OPEN', 'Le résultat se saisit après le coup d’envoi.');
  }
  if (m.organizerId !== reporterId) {
    return fail('NOT_ORGANIZER', 'Seul l’organisateur saisit le résultat ; l’adversaire le confirme.');
  }
  return ok;
}

export function canConfirmResult(r: MatchResult, confirmerId: string): RuleResult {
  if (r.status !== 'PENDING_CONFIRMATION') {
    return fail('RESULT_ALREADY_CONFIRMED', 'Ce résultat a déjà été traité.');
  }
  if (confirmerId === r.reportedBy) {
    return fail('NOT_OPPONENT', 'La confirmation vient de l’équipe adverse, pas de celui qui a saisi.');
  }
  return ok;
}

/** Sans confirmation sous 24 h, le résultat est validé tel que saisi (anti-blocage) ;
    une contestation dans la fenêtre le passe en DISPUTED. */
export function autoConfirmDue(r: MatchResult, now: number): boolean {
  return r.status === 'PENDING_CONFIRMATION' && now >= r.reportedAt + RESULT_CONFIRM_TTL_MS;
}

/* --- OVR — formule V1, explicable en une phrase --------------------------- */

export interface OvrInputs {
  ratedMatches: number;   // matchs joués ET notés par des coéquipiers
  avgRating: number;      // note moyenne reçue, 1 à 5
  winRate: number;        // 0 à 1, sur résultats CONFIRMÉS uniquement
  matchesPlayed: number;  // volume total de matchs joués (statut PLAYED)
}

/** Seuil de calculabilité : en dessous, l'OVR n'existe pas (badge provisoire « — »). */
export const OVR_MIN_RATED_MATCHES = 3;

/** OVR = 40 de base + note des coéquipiers (jusqu'à 35) + taux de victoire
    (jusqu'à 15) + volume de matchs (jusqu'à 9, plafonné à 30 matchs). Max 99. */
export function computeOvr(i: OvrInputs): number | null {
  if (i.ratedMatches < OVR_MIN_RATED_MATCHES) return null;
  const rating = ((Math.min(Math.max(i.avgRating, 1), 5) - 1) / 4) * 35;
  const wins = Math.min(Math.max(i.winRate, 0), 1) * 15;
  const volume = Math.min(i.matchesPlayed, 30) / 30 * 9;
  return Math.min(99, Math.round(40 + rating + wins + volume));
}

/** L'explication affichable — la spec §15 exige que l'OVR soit explicable. */
export function explainOvr(i: OvrInputs): string {
  if (computeOvr(i) === null) {
    return `Ton OVR apparaîtra après ${OVR_MIN_RATED_MATCHES} matchs notés par tes coéquipiers.`;
  }
  return 'Ton OVR = 40 de base + la note de tes coéquipiers (jusqu’à 35) + ton taux de victoire (jusqu’à 15) + ton volume de matchs (jusqu’à 9).';
}
