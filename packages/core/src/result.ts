/* =============================================================================
   RÉSULTAT DE RÈGLE — chaque règle répond OK ou un code + un message en clair.
   Les messages sont la voix de l'interface : ils expliquent, ne s'excusent pas.
   ========================================================================== */

export type RuleError =
  | 'MATCH_FULL' | 'MATCH_LOCKED' | 'MATCH_CANCELLED' | 'MATCH_PLAYED' | 'MATCH_NOT_OPEN'
  | 'ALREADY_JOINED' | 'NOT_JOINED' | 'SCHEDULE_CONFLICT'
  | 'SLOT_TAKEN' | 'OVER_FIELD_CAPACITY' | 'FORMAT_NOT_AVAILABLE'
  | 'CANCEL_WINDOW_PASSED' | 'INVALID_TRANSITION'
  | 'NOT_CAPTAIN' | 'SELF_CHALLENGE' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_PENDING'
  | 'TEAM_FULL' | 'ALREADY_MEMBER' | 'NOT_MEMBER' | 'NOT_INVITED' | 'LAST_CAPTAIN'
  | 'RATING_WINDOW_CLOSED' | 'SELF_RATING' | 'INVALID_TARGET' | 'NOT_PLAYED'
  | 'STAKE_DISABLED' | 'NOT_ORGANIZER' | 'RESULT_ALREADY_CONFIRMED' | 'NOT_OPPONENT'
  | 'FORMAT_SPORT_MISMATCH' | 'HOURS_INVALID' | 'BOOKING_HAS_MATCH'
  | 'PHONE_INVALID' | 'OTP_EXPIRED' | 'OTP_WRONG' | 'OTP_TOO_MANY_ATTEMPTS'
  | 'OTP_COOLDOWN' | 'OTP_QUOTA' | 'OTP_ALREADY_USED' | 'NAME_INVALID' | 'SESSION_REVOKED'
  | 'FORBIDDEN' | 'LOGIN_LOCKED' | 'SLOT_IN_PAST' | 'PASSWORD_INVALID'
  /** Audit pré-lancement (BUG-4, 27/09/2026) : un match ne se pose pas sur une réservation téléphonique que le centre
      n'a pas encore confirmée. */
  | 'BOOKING_NOT_VERIFIED'
  /** Règle 3 (26/10/2026) : l'équipe choisie n'a plus de place / c'est déjà l'équipe du joueur. */
  | 'MATCH_TEAM_FULL' | 'SAME_TEAM'
  /** Règle 23 (26/10/2026) : au plus 2 réservations par jour et 4 à venir, par joueur. */
  | 'BOOKING_LIMIT_DAY' | 'BOOKING_LIMIT_UPCOMING'
  /** Règle 25 (26/10/2026) : restriction après absences ; déclaration d'une absence refusée. */
  | 'PLAYER_RESTRICTED' | 'ABSENCE_NOT_ELIGIBLE' | 'ABSENCE_TOO_EARLY'
  /** Règle 21 (26/10/2026) : « C'est bien toi ? » — déjà répondu ; réservation annulée, honorée ou commencée. */
  | 'CLAIM_ALREADY_ANSWERED' | 'CLAIM_CLOSED';

export type RuleResult =
  | { ok: true }
  | { ok: false; code: RuleError; message: string; i18nKey?: string };

export const ok: RuleResult = { ok: true };

/** Chantier arabe RTL, lot 2 (18/10/2026, forme uniquement, GO d'Aymen) : `code` seul ne
    suffit plus de clé de traduction — l'audit a trouvé ~82 % des appels `fail()` où le MÊME
    code couvre plusieurs messages français distincts selon le site d'appel (ex: `SLOT_TAKEN`
    dit « ce créneau » ici, « cet horaire » là). `i18nKey`, optionnel, laisse un appelant
    distinguer ces cas sans rien changer pour les ~213 appels existants (absent par défaut —
    jamais `i18nKey: undefined` posé sur l'objet). Donner une vraie clé à chaque site d'appel
    est le travail du lot d'extraction i18n, pas celui-ci : ceci pose seulement la capacité. */
export function fail(code: RuleError, message: string, i18nKey?: string): RuleResult {
  return i18nKey === undefined ? { ok: false, code, message } : { ok: false, code, message, i18nKey };
}
