/* =============================================================================
   MACHINES À ÉTATS — les transitions légales, et rien d'autre.
   Une transition hors table est refusée par le serveur, pas « évitée » par l'UI.
   ========================================================================== */

import type { BookingStatus, ChallengeStatus, MatchStatus } from './entities.js';

export const MATCH_TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  DRAFT:     ['OPEN', 'CANCELLED'],
  OPEN:      ['FULL', 'LOCKED', 'CANCELLED'],
  FULL:      ['OPEN', 'LOCKED', 'CANCELLED'],   // FULL → OPEN quand un joueur se désinscrit
  LOCKED:    ['PLAYED', 'CANCELLED'],
  PLAYED:    [],
  CANCELLED: [],
};

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  RESERVED:  ['HONORED', 'NO_SHOW', 'CANCELLED'],
  HONORED:   ['PAID'],
  NO_SHOW:   [],
  PAID:      [],
  CANCELLED: [],
};

export const CHALLENGE_TRANSITIONS: Record<ChallengeStatus, readonly ChallengeStatus[]> = {
  PENDING:   ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED:  [],
  REJECTED:  [],
  EXPIRED:   [],
  CANCELLED: [],
};

export function canTransition<S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}
