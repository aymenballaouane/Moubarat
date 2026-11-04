/* =============================================================================
   RÈGLE 21 — RÉSERVATION PRISE PAR TÉLÉPHONE, « C'EST BIEN TOI ? » (précisée ; décisions d'Aymen du 26/10/2026).
   - Le centre saisit un nom et un numéro. Si ce numéro est celui d'un compte joueur, la réservation se RATTACHE à ce compte, EN ATTENTE : le joueur voit « C'est bien toi ? »
     (notification, Mes matchs, Créer) et répond « C'est moi » ou « Ce n'est pas moi ».
   - Elle ne compte pour lui qu'une fois CONFIRMÉE. Sans réponse, elle reste au nom du centre : un rappel la veille, et aucune absence ni annulation ne le concerne.
   - « Ce n'est pas moi » prévient le centre, et la réservation disparaît des matchs du joueur.
   Additif : aucune règle existante ne lit ce fichier. Pur : l'appelant fournit l'état de la réservation.
   ========================================================================== */

import { fail, ok, type RuleResult } from '../result.js';

export type ClaimStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

/** Le rappel part la veille du créneau (24 h avant le début) tant que le joueur n'a pas répondu. */
export const CLAIM_REMINDER_BEFORE_MS = 24 * 3_600_000;

export function claimReminderDueAt(bookingStart: number): number {
  return bookingStart - CLAIM_REMINDER_BEFORE_MS;
}

/** Le rappel est dû : sans réponse, le créneau est encore à venir, et l'on a passé « la veille ». Une seule fois (l'appelant retient l'envoi). */
export function isClaimReminderDue(claim: { status: ClaimStatus; start: number; remindedAt: number | null }, now: number): boolean {
  return claim.status === 'PENDING' && claim.remindedAt === null && now < claim.start && now >= claimReminderDueAt(claim.start);
}

export interface ClaimedBooking {
  /** Statut de la réservation (RESERVED, HONORED, PAID, NO_SHOW, CANCELLED). */
  status: string;
  start: number;
  claimStatus: ClaimStatus | null;
  /** Le compte rattaché par le numéro. */
  claimedUserId: string | null;
}

/** Le joueur peut répondre — « C'est moi » comme « Ce n'est pas moi » — à une réservation qui lui est rattachée, encore en attente, toujours vivante et à venir. */
export function canRespondToClaim(booking: ClaimedBooking, userId: string, now: number): RuleResult {
  if (booking.claimedUserId !== userId || booking.claimStatus === null) {
    return fail('FORBIDDEN', 'Cette réservation ne t’est pas rattachée.');
  }
  if (booking.claimStatus !== 'PENDING') return fail('CLAIM_ALREADY_ANSWERED', 'Tu as déjà répondu pour cette réservation.');
  if (booking.status !== 'RESERVED') return fail('CLAIM_CLOSED', 'Cette réservation n’est plus d’actualité.');
  if (now >= booking.start) return fail('CLAIM_CLOSED', 'Ce créneau a déjà commencé.');
  return ok;
}
