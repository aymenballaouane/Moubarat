/* =============================================================================
   RÈGLES — DÉFI ENTRE ÉQUIPES.
   Capitaine uniquement, expiration 48 h, l'acceptation PRODUIT le match et
   pose Challenge.matchId (audit I4 — sans quoi Mes Matchs ne peut pas l'afficher).
   ========================================================================== */

import type { Booking, Challenge, Match, TeamMember } from '../entities.js';
import { CHALLENGE_TTL_MS } from '../time.js';
import { FORMAT_CAPACITY } from '../entities.js';
import { splitPerPlayer } from '../money.js';
import { fail, ok, type RuleResult } from '../result.js';

/** Décision n°5 de l'audit : le montant de mise en espèces reste désactivé tant
    que la qualification juridique n'est pas rendue. L'enjeu (Amical / Classement)
    reste, le montant attend. Un seul endroit à changer le jour où c'est tranché. */
export const STAKE_AMOUNT_ENABLED = false;

export function isCaptain(members: readonly TeamMember[], teamId: string, userId: string): boolean {
  return members.some(
    (m) => m.teamId === teamId && m.userId === userId && m.role === 'CAPTAIN' && m.status === 'ACTIVE',
  );
}

export function canSendChallenge(
  c: Pick<Challenge, 'fromTeamId' | 'toTeamId'> & { stakeAmount?: Challenge['stakeAmount'] },
  senderId: string,
  members: readonly TeamMember[],
): RuleResult {
  if (c.fromTeamId === c.toTeamId) return fail('SELF_CHALLENGE', 'Une équipe ne peut pas se défier elle-même.');
  if (!isCaptain(members, c.fromTeamId, senderId)) {
    return fail('NOT_CAPTAIN', 'Seul le capitaine de l’équipe peut envoyer un défi.');
  }
  if (c.stakeAmount && !STAKE_AMOUNT_ENABLED) {
    return fail('STAKE_DISABLED', 'La mise en espèces n’est pas disponible pour le moment.');
  }
  return ok;
}

export function newChallenge(
  input: Omit<Challenge, 'status' | 'expiresAt' | 'matchId'>,
): Challenge {
  return { ...input, status: 'PENDING', expiresAt: input.createdAt + CHALLENGE_TTL_MS };
}

export function isExpired(c: Challenge, now: number): boolean {
  return c.status === 'PENDING' && now >= c.expiresAt;
}

export function canRespond(
  c: Challenge,
  responderId: string,
  members: readonly TeamMember[],
  now: number,
): RuleResult {
  if (isExpired(c, now) || c.status === 'EXPIRED') {
    return fail('CHALLENGE_EXPIRED', 'Ce défi a expiré (48 h sans réponse).');
  }
  if (c.status !== 'PENDING') {
    return fail('CHALLENGE_NOT_PENDING', 'Ce défi a déjà reçu une réponse.');
  }
  if (!isCaptain(members, c.toTeamId, responderId)) {
    return fail('NOT_CAPTAIN', 'Seul le capitaine de l’équipe défiée peut répondre.');
  }
  return ok;
}

/** L'acceptation crée le match confirmé entre les deux équipes et referme la boucle
    des deux côtés (émetteur ET récepteur voient le même objet).
    `booking` est une réservation RÉELLE, déjà passée par les mêmes garanties que
    toute autre (canReserve/isBlocking, via prepareBooking côté appelant) — jamais
    un prix figé à 0 DA : le prix par joueur dérive de cette réservation, comme
    partout ailleurs (cf. createMatch, match-flow.ts). `title` vient de l'appelant
    (qui a les noms d'équipe en main) plutôt que d'un libellé générique. */
export function acceptChallenge(
  c: Challenge,
  matchId: string,
  booking: Booking,
  title: string,
  now: number,
): { challenge: Challenge; match: Match } {
  const capacity = FORMAT_CAPACITY[c.format];
  const match: Match = {
    id: matchId,
    sport: c.sport,
    format: c.format,
    level: 'COMPETITION',
    title,
    venueId: c.venueId ?? '',
    fieldId: c.fieldId ?? '',
    range: c.proposedRange,
    capacity,
    pricePerPlayer: splitPerPlayer(booking.priceTotal, capacity),
    visibility: 'PRIVATE',
    status: 'OPEN',
    organizerId: '',            // posé par l'appelant : capitaine émetteur
    bookingId: booking.id,
    challengeId: c.id,
    coordination: { kind: 'WHATSAPP' },
    createdAt: now,
  };
  return { challenge: { ...c, status: 'ACCEPTED', matchId }, match };
}

/** Construit un titre de match lisible à partir des deux noms d'équipe,
    jamais un libellé générique — borné à la même limite que createMatch()
    (match-flow.ts, NAME_INVALID : 3 à 40 caractères) puisque ce titre suit
    ensuite exactement le même chemin d'affichage qu'un match créé normalement. */
export function challengeMatchTitle(fromTeamName: string, toTeamName: string): string {
  const full = `${fromTeamName} vs ${toTeamName}`;
  return full.length <= 40 ? full : `${full.slice(0, 39)}…`;
}

/* --- Fermeture du cycle (Phase 8) ------------------------------------------ */

/** Refus par le capitaine défié : le défi se termine, aucun match n'est créé. */
export function rejectChallenge(
  c: Challenge, responderId: string, members: readonly TeamMember[], now: number,
): { result: RuleResult; challenge?: Challenge } {
  const check = canRespond(c, responderId, members, now);
  if (!check.ok) return { result: check };
  return { result: ok, challenge: { ...c, status: 'REJECTED' } };
}

/** L'émetteur (capitaine) peut retirer un défi tant qu'il est en attente. */
export function cancelChallenge(
  c: Challenge, byUserId: string, members: readonly TeamMember[],
): { result: RuleResult; challenge?: Challenge } {
  if (!isCaptain(members, c.fromTeamId, byUserId)) {
    return { result: fail('NOT_CAPTAIN', 'Seul le capitaine émetteur retire son défi.') };
  }
  if (c.status !== 'PENDING') {
    return { result: fail('CHALLENGE_NOT_PENDING', 'Ce défi a déjà reçu une réponse.') };
  }
  return { result: ok, challenge: { ...c, status: 'CANCELLED' } };
}

/** Balayage d'expiration (tâche serveur) : les PENDING dépassés passent EXPIRED,
    et l'émetteur est enfin prévenu — plus jamais « en attente pour toujours ». */
export function expireChallenges(
  cs: readonly Challenge[], now: number,
): { challenges: Challenge[]; expiredIds: string[] } {
  const expiredIds: string[] = [];
  const challenges = cs.map((c) => {
    if (isExpired(c, now)) { expiredIds.push(c.id); return { ...c, status: 'EXPIRED' as const }; }
    return c;
  });
  return { challenges, expiredIds };
}

/** La boîte du Notification Center : Reçus / Envoyés, pour une équipe donnée. */
export function challengeInbox(cs: readonly Challenge[], teamId: string): {
  received: Challenge[]; sent: Challenge[];
} {
  const byDate = (a: Challenge, b: Challenge) => b.createdAt - a.createdAt;
  return {
    received: cs.filter((c) => c.toTeamId === teamId).sort(byDate),
    sent: cs.filter((c) => c.fromTeamId === teamId).sort(byDate),
  };
}

/** Libellé de compte à rebours, côté UI : « Expire dans 47 h » / « … 35 min » / « Expiré ». */
export function timeLeftLabel(c: Challenge, now: number): string {
  const ms = c.expiresAt - now;
  if (c.status !== 'PENDING' || ms <= 0) return 'Expiré';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 2) return `Expire dans ${h} h`;
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return `Expire dans ${min} min`;
}
