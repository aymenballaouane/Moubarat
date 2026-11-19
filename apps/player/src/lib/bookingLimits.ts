/* « Limite atteinte » (lot « Match libre », phase 4, planche S3L, dossier §8) — présentation PURE, testée (tests/bookingLimits.test.ts).
   Les plafonds et les comptes viennent du serveur (GET /me/booking-limits) : c'est lui qui applique la règle 23 à la création ; l'écran
   ne fait que prévenir avant d'essayer. Mêmes comptes que le core (`checkBookingLimits`) : d'abord le jour, puis les réservations à venir. */

export interface BookingLimits {
  maxPerDay: number;
  maxUpcoming: number;
  /** Réservations vivantes pas encore commencées. */
  upcoming: number;
  /** Réservations vivantes par jour d'Alger (« AAAA-MM-JJ »). */
  perDay: Record<string, number>;
}

export type LimitReached = { kind: 'day'; max: number } | { kind: 'upcoming'; max: number } | null;

/** La limite qui bloque une nouvelle réservation le jour `date` (« AAAA-MM-JJ »), ou `null`. Sans plafonds connus : `null` (le serveur
    reste le juge). */
export function limitReached(limits: BookingLimits | null, date: string | null): LimitReached {
  if (!limits || !date) return null;
  if ((limits.perDay[date] ?? 0) >= limits.maxPerDay) return { kind: 'day', max: limits.maxPerDay };
  if (limits.upcoming >= limits.maxUpcoming) return { kind: 'upcoming', max: limits.maxUpcoming };
  return null;
}
