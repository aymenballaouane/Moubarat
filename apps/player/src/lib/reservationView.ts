import { MATCH_OPEN_MIN_BEFORE_MS, cancellationKind, canCancelBooking, type Booking } from '@moubarat/core';

/* Mes réservations — BUG-2 / BUG-8 (audit pré-lancement, 26/09/2026). Présentation PURE d'une réservation (statut lisible,
   actions possibles, ordre d'affichage) — aucune règle réinventée : « annulable » EST la règle core `canCancelBooking`
   (RESERVED et pas déjà close — depuis le 25/10/2026, elle reste annulable après H-2, voir §18/§19 plus bas), le serveur
   la rejoue de toute façon. Testé isolément (tests/reservationView.test.ts). */

/** Tons du Design System : `open` vert (positif), `filling` or (en attente), `played` (fait), `cancelled` rouge danger
    (négatif), `expired` gris (éteint) — la même lecture que le CRM (Réservations.tsx, STATUS_PILL). */
export type ReservationTone = 'open' | 'filling' | 'played' | 'cancelled' | 'expired';

export interface ReservationStatusView { label: string; tone: ReservationTone }

export function reservationStatus(b: Pick<Booking, 'status' | 'source' | 'verifiedByCenter'>): ReservationStatusView {
  switch (b.status) {
    case 'RESERVED':
      return b.source === 'PHONE' && !b.verifiedByCenter
        ? { label: 'À confirmer par le centre', tone: 'filling' }
        : { label: 'Réservée', tone: 'open' };
    case 'HONORED': return { label: 'Honorée', tone: 'played' };
    case 'PAID': return { label: 'Payée', tone: 'played' };
    case 'NO_SHOW': return { label: 'No-show', tone: 'cancelled' };
    case 'CANCELLED': return { label: 'Annulée', tone: 'expired' };
  }
}

/** Annulable depuis l'app = la règle core, rien d'autre (le bouton n'apparaît que si le serveur dira oui). */
export function canCancelInApp(b: Booking, now: number): boolean {
  return canCancelBooking(b, now).ok;
}

/** §18/§19 (25/10/2026) : prévenir AVANT de confirmer, pas seulement après — le ticket doit le dire dans les deux sens.
    `null` = annulation gratuite (comme avant), sinon le texte à afficher. Même classifieur que la fiabilité CRM
    (`cancellationKind`, ops.ts) : jamais une deuxième règle qui pourrait diverger. */
export function lateCancelNotice(bookingStart: number, now: number): string | null {
  return cancellationKind(bookingStart, now) === 'LATE'
    ? 'À moins de 2 h du créneau, l’annulation compte comme une demi-absence.'
    : null;
}

/** « Créer un match » (BUG-8) : réservation vivante, à venir, sans match, et que le centre reconnaît — une réservation
    téléphonique non confirmée ne porte pas de match (le serveur le refuse depuis le lot BUG-4). */
export function canCreateMatchOn(b: Booking, now: number): boolean {
  /* À moins de 2 h du coup d'envoi (MATCH_OPEN_MIN_BEFORE_MS, le verrou des inscriptions — core createMatch) le serveur refuse d'ouvrir un match : ne pas proposer un bouton voué au refus (lot 8). */
  return b.status === 'RESERVED' && b.matchId === undefined && b.range.start - MATCH_OPEN_MIN_BEFORE_MS > now && (b.source !== 'PHONE' || b.verifiedByCenter);
}

/** À venir d'abord (la plus proche en tête), puis passées (la plus récente en tête) — l'API sert par date de création,
    ce n'est pas l'ordre dans lequel on cherche sa réservation. */
export function sortReservations<T extends { booking: Booking }>(rs: readonly T[], now: number): T[] {
  const upcoming = rs.filter((r) => r.booking.range.start > now).sort((a, b) => a.booking.range.start - b.booking.range.start);
  const past = rs.filter((r) => r.booking.range.start <= now).sort((a, b) => b.booking.range.start - a.booking.range.start);
  return [...upcoming, ...past];
}
