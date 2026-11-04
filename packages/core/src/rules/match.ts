/* =============================================================================
   RÈGLES — MATCH.
   Rejoindre, se désinscrire, verrouiller à H-2, pouvoirs de l'organisateur.
   Tout est appliqué côté serveur ; l'UI ne fait que refléter ces réponses.
   ========================================================================== */

import { FORMAT_CAPACITY, type Field, type Match, type MatchPlayer, type MatchTeam } from '../entities.js';
import { MATCH_LOCK_BEFORE_MS, CANCEL_FREE_BEFORE_MS, overlaps, type TimeRange } from '../time.js';
import { MATCH_TRANSITIONS, canTransition } from '../states.js';
import { fail, ok, type RuleResult } from '../result.js';

export function activePlayers(players: readonly MatchPlayer[]): MatchPlayer[] {
  return players.filter((p) => p.status === 'JOINED');
}

/** Composition figée : à partir de H-1 (règle 4 modifiée, trois temps) — plus d'inscription, plus de désistement, plus de changement d'équipe. */
export function isLockedNow(m: Match, now: number): boolean {
  return now >= m.range.start - MATCH_LOCK_BEFORE_MS;
}

/** Les trois temps d'un match ouvert (règle 4, MODIFIÉE) : `FREE` jusqu'à H-2, `REPLACEMENT` de H-2 à H-1, `FROZEN` à partir de H-1.
    Ne regarde que l'horloge : le statut du match (annulé, joué) reste l'affaire de l'appelant. */
export type RegistrationPhase = 'FREE' | 'REPLACEMENT' | 'FROZEN';

export function registrationPhase(m: Pick<Match, 'range'>, now: number): RegistrationPhase {
  if (now >= m.range.start - MATCH_LOCK_BEFORE_MS) return 'FROZEN';
  if (now >= m.range.start - CANCEL_FREE_BEFORE_MS) return 'REPLACEMENT';
  return 'FREE';
}

/** Un départ à `leftAt` est-il une demi-absence ? Oui de H-2 à H-1 (règle 4) ; non avant H-2. Après H-1 on ne part plus (`canLeaveMatch`).
    Même coupe que l'annulation tardive d'une réservation (`cancellationKind`, §19). */
export function matchLeaveKind(m: Pick<Match, 'range'>, leftAt: number): 'EARLY' | 'LATE' {
  return leftAt >= m.range.start - CANCEL_FREE_BEFORE_MS ? 'LATE' : 'EARLY';
}

/** Capacité valide : bornée par le format, lui-même proposé par le terrain. */
export function validateCapacity(m: Pick<Match, 'format' | 'capacity' | 'fieldId'>, field: Field): RuleResult {
  if (!field.formats.includes(m.format)) {
    return fail('FORMAT_NOT_AVAILABLE', `Ce terrain ne propose pas le format ${m.format}.`);
  }
  const max = FORMAT_CAPACITY[m.format];
  if (m.capacity < 2 || m.capacity > max) {
    return fail('OVER_FIELD_CAPACITY', `Ce format accepte de 2 à ${max} joueurs.`);
  }
  return ok;
}

/** Un joueur ne peut pas être engagé sur deux créneaux qui se chevauchent
    (matchs rejoints + réservations personnelles). */
export function hasScheduleConflict(candidate: TimeRange, commitments: readonly TimeRange[]): boolean {
  return commitments.some((c) => overlaps(c, candidate));
}

export function canJoinMatch(
  m: Match,
  players: readonly MatchPlayer[],
  userId: string,
  userCommitments: readonly TimeRange[],
  now: number,
): RuleResult {
  if (m.status === 'CANCELLED') return fail('MATCH_CANCELLED', 'Ce match a été annulé.');
  if (m.status === 'PLAYED')    return fail('MATCH_PLAYED', 'Ce match est terminé.');
  if (m.status === 'LOCKED' || isLockedNow(m, now)) {
    return fail('MATCH_LOCKED', 'Les inscriptions sont fermées 1 h avant le coup d’envoi.');
  }
  if (m.status !== 'OPEN' && m.status !== 'FULL') {
    return fail('MATCH_NOT_OPEN', 'Ce match n’est pas ouvert aux inscriptions.');
  }
  if (players.some((p) => p.userId === userId && p.status === 'REMOVED')) {
    return fail('FORBIDDEN', 'Vous avez été retiré de ce match par l’organisateur.');
  }
  const joined = activePlayers(players);
  if (joined.some((p) => p.userId === userId)) {
    return fail('ALREADY_JOINED', 'Vous êtes déjà inscrit à ce match.'); // → état « Inscrit », CTA désactivé
  }
  if (joined.length >= m.capacity) {
    return fail('MATCH_FULL', 'Ce match est complet.');
  }
  if (hasScheduleConflict(m.range, userCommitments)) {
    return fail('SCHEDULE_CONFLICT', 'Vous avez déjà un match ou une réservation sur ce créneau.');
  }
  return ok;
}

/** Après un rejoint / départ réussi : le statut dérive du remplissage. */
export function derivedStatus(m: Match, joinedCount: number): Match['status'] {
  if (m.status === 'CANCELLED' || m.status === 'PLAYED' || m.status === 'LOCKED' || m.status === 'DRAFT') return m.status;
  return joinedCount >= m.capacity ? 'FULL' : 'OPEN';
}

/** Désinscription : libre jusqu'à H-2 ; de H-2 à H-1 elle reste possible mais compte comme une demi-absence (`matchLeaveKind`) et la place est
    reproposée ; à partir de H-1 la composition est figée (règle 4, MODIFIÉE, trois temps). */
export function canLeaveMatch(m: Match, players: readonly MatchPlayer[], userId: string, now: number): RuleResult {
  if (!activePlayers(players).some((p) => p.userId === userId)) {
    return fail('NOT_JOINED', 'Vous n’êtes pas inscrit à ce match.');
  }
  if (isLockedNow(m, now)) {
    return fail('CANCEL_WINDOW_PASSED', 'La composition est figée : on ne se désinscrit plus 1 h avant le coup d’envoi.');
  }
  return ok;
}

/* --- Pouvoirs de l'organisateur (audit D4 : le rôle affiché doit en donner) --- */

/* EDIT_TIME retire (decision produit d'Aymen, 29/08/2026) : un organisateur
   ne doit plus pouvoir deplacer l'horaire d'un match deja organise — ca
   bouleverse le programme des joueurs deja inscrits. Aucun remplacement,
   la seule action sur l'horaire reste l'annulation. */
export type OrganizerAction = 'REMOVE_PLAYER' | 'CLOSE_REGISTRATIONS' | 'REOPEN' | 'CANCEL_MATCH';

export function canOrganizerAct(m: Match, userId: string, action: OrganizerAction, now: number): RuleResult {
  if (m.organizerId !== userId) return fail('NOT_ORGANIZER', 'Seul l’organisateur peut faire cela.');
  const started = now >= m.range.start;
  if (started && action !== 'CANCEL_MATCH') {
    return fail('MATCH_LOCKED', 'Un match commencé ne se modifie plus.');
  }
  if (action === 'CANCEL_MATCH' && !canTransition(MATCH_TRANSITIONS, m.status, 'CANCELLED')) {
    return fail('INVALID_TRANSITION', 'Ce match ne peut plus être annulé.');
  }
  return ok;
}

/* --- Équipes (règle 3, 26/10/2026 — règle NOUVELLE de la refonte de l'app joueur) ----------------------------------------
   Une seule place par joueur ; il choisit son ÉQUIPE (sa paire au padel), jamais son poste. Chaque équipe a la moitié de la
   capacité. Le choix est libre tant que l'équipe a de la place, et se change tant que les inscriptions sont ouvertes (même
   verrou que s'inscrire : `isLockedNow`). Additif : aucune règle existante ne lit ces fonctions. */

export const MATCH_TEAMS: readonly MatchTeam[] = ['A', 'B'];

/** Places d'une équipe : la moitié de la capacité (arrondie au-dessus — la capacité totale reste plafonnée par `canJoinMatch`). */
export function teamCapacity(m: Pick<Match, 'capacity'>): number {
  return Math.ceil(m.capacity / 2);
}

/** Inscrits actifs par équipe (un inscrit sans équipe n'est dans aucune). */
export function teamCounts(players: readonly MatchPlayer[]): Record<MatchTeam, number> {
  const counts: Record<MatchTeam, number> = { A: 0, B: 0 };
  for (const p of activePlayers(players)) if (p.team) counts[p.team] += 1;
  return counts;
}

/** Places encore libres dans une équipe (jamais négatif, jamais plus que les places libres du match). */
export function teamFreePlaces(m: Pick<Match, 'capacity'>, players: readonly MatchPlayer[], team: MatchTeam): number {
  const inTeam = teamCapacity(m) - teamCounts(players)[team];
  const inMatch = m.capacity - activePlayers(players).length;
  return Math.max(0, Math.min(inTeam, inMatch));
}

/** Équipe proposée d'office dans « Choisis ton équipe » : celle qui a le plus de places (A à égalité) ; null si aucune n'en a. */
export function defaultTeam(m: Pick<Match, 'capacity'>, players: readonly MatchPlayer[]): MatchTeam | null {
  const a = teamFreePlaces(m, players, 'A');
  const b = teamFreePlaces(m, players, 'B');
  if (a === 0 && b === 0) return null;
  return b > a ? 'B' : 'A';
}

/** Rejoindre CETTE équipe : elle doit avoir de la place. (Le reste — match ouvert, pas complet, pas de conflit — est `canJoinMatch`.) */
export function canJoinTeam(m: Pick<Match, 'capacity'>, players: readonly MatchPlayer[], team: MatchTeam): RuleResult {
  if (teamFreePlaces(m, players, team) === 0) {
    return fail('MATCH_TEAM_FULL', 'Cette équipe est complète — choisis l’autre.');
  }
  return ok;
}

/** Changer d'équipe : inscrit, inscriptions encore ouvertes, l'autre équipe a une place. */
export function canChangeTeam(
  m: Match, players: readonly MatchPlayer[], userId: string, team: MatchTeam, now: number,
): RuleResult {
  if (m.status === 'CANCELLED') return fail('MATCH_CANCELLED', 'Ce match a été annulé.');
  if (m.status === 'PLAYED') return fail('MATCH_PLAYED', 'Ce match est terminé.');
  const me = activePlayers(players).find((p) => p.userId === userId);
  if (!me) return fail('NOT_JOINED', 'Vous n’êtes pas inscrit à ce match.');
  if (m.status === 'LOCKED' || isLockedNow(m, now)) {
    return fail('MATCH_LOCKED', 'La composition est figée : on ne change plus d’équipe.');
  }
  if (me.team === team) return fail('SAME_TEAM', 'Tu es déjà dans cette équipe.');
  return canJoinTeam(m, players, team);
}
