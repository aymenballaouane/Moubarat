/* =============================================================================
   RÈGLES — RÉSERVATION.
   La disponibilité d'un créneau n'a qu'UNE définition : aucun Booking actif
   ne chevauche l'intervalle sur ce terrain. App et CRM appellent la même
   fonction — c'est la garantie mécanique de la source de vérité unique.
   ========================================================================== */

import type { Booking, BookingStatus } from '../entities.js';
import { overlaps, type TimeRange } from '../time.js';
import { BOOKING_TRANSITIONS, canTransition } from '../states.js';
import { fail, ok, type RuleResult } from '../result.js';

/** Statuts qui occupent réellement le terrain. */
const BLOCKING: readonly BookingStatus[] = ['RESERVED', 'HONORED', 'PAID'];

export function isBlocking(b: Booking): boolean {
  return BLOCKING.includes(b.status);
}

/** Le créneau est-il libre sur ce terrain ? Une réservation EXTERNAL non vérifiée
    bloque AUSSI : c'est le point n°4 escaladé par l'audit, résolu dans ce sens. */
export function canReserve(
  fieldId: string,
  candidate: TimeRange,
  existing: readonly Booking[],
): RuleResult {
  const conflict = existing.find(
    (b) => b.fieldId === fieldId && isBlocking(b) && overlaps(b.range, candidate),
  );
  if (conflict) {
    return fail('SLOT_TAKEN', 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.');
  }
  return ok;
}

/** Chemin B — « J'ai déjà réservé par téléphone ». Crée une réservation EXTERNAL
    qui bloque le créneau côté CRM et doit être confirmée par le gérant. */
export function registerExternalBooking(
  input: Omit<Booking, 'status' | 'source' | 'verifiedByCenter'>,
  existing: readonly Booking[],
): { result: RuleResult; booking?: Booking; notifyCenter: boolean } {
  const free = canReserve(input.fieldId, input.range, existing);
  if (!free.ok) return { result: free, notifyCenter: false };
  return {
    result: ok,
    booking: { ...input, status: 'RESERVED', source: 'PHONE', verifiedByCenter: false },
    notifyCenter: true, // → Notification EXTERNAL_BOOKING_TO_VERIFY au gérant
  };
}

/** Annulation gratuite jusqu'à 2 h avant ; après, elle reste possible mais compte comme une
    demi-absence (§18 modifiée, §19 nouvelle — refonte-app-joueur/docs/regles.md, GO d'Aymen
    25/10/2026) — ce n'est plus cette fonction qui le dit : `cancellationKind` (ops.ts) classe
    EARLY/LATE après coup à partir de `cancelled_at`, pour l'app ET le CRM (§26, même formule).
    Seul reste ici le VRAI dernier mot : une réservation déjà close (HONORED/PAID/NO_SHOW/
    CANCELLED) ne s'annule jamais, quelle que soit l'heure. `now` ne sert qu'à refuser une réservation DÉJÀ COMMENCÉE (audit 26/10, P1-2) ; il reste
    dans la signature : tous les appelants le passent. */
export function canCancelBooking(b: Booking, now: number): RuleResult {
  if (!canTransition(BOOKING_TRANSITIONS, b.status, 'CANCELLED')) {
    return fail('INVALID_TRANSITION', 'Cette réservation ne peut plus être annulée.');
  }
  /* Audit final 26/10/2026 (P1-2, GO d'Aymen) : une fois le créneau COMMENCÉ, le joueur n'annule plus — le match terminé
     devenait « annulé », ses inscrits étaient prévenus, et un absent n'écopait que d'une demi-absence. Le centre garde la
     main sur le sort d'une réservation commencée (honorée / no-show) via `setBookingStatus`. */
  if (now >= b.range.start) {
    return fail('CANCEL_WINDOW_PASSED', 'Le créneau a commencé : cette réservation ne peut plus être annulée.');
  }
  return ok;
}

/** Cycle cash : RESERVED → HONORED → PAID, ou RESERVED → NO_SHOW.
    C'est ce qui rend mesurables le taux de no-show et le revenu réel du centre. */
export function setBookingStatus(b: Booking, to: BookingStatus): RuleResult {
  if (!canTransition(BOOKING_TRANSITIONS, b.status, to)) {
    return fail('INVALID_TRANSITION', `Passage ${b.status} → ${to} impossible.`);
  }
  return ok;
}

/* --- Règle 23 (refonte app joueur, 26/10/2026 — règle NOUVELLE) : plafonds de réservation par joueur -------------------------
   « Au plus 2 réservations par jour, au plus 4 réservations à venir, jamais deux qui se chevauchent. » Les deux plafonds sont
   ici ; le chevauchement est `hasScheduleConflict` (match.ts) — le même pour s'inscrire à un match et pour réserver (la
   fenêtre « Tu joues déjà à cette heure-là » est unique). Additif : aucune règle existante ne lit ces fonctions. Ne concerne
   que les réservations posées par un JOUEUR (le comptoir et le téléphone saisi au CRM n'ont pas de joueur derrière). */

export const MAX_BOOKINGS_PER_DAY = 2;
export const MAX_UPCOMING_BOOKINGS = 4;

export function checkBookingLimits(p: {
  candidate: TimeRange;
  /** Les réservations du joueur (n'importe quel statut : seules les réservations qui occupent encore un terrain comptent). */
  mine: readonly Pick<Booking, 'range' | 'status'>[];
  now: number;
  /** Le jour d'un instant, comme chaîne comparable (« AAAA-MM-JJ » à Alger) — le core ne connaît aucun fuseau. */
  dayOf: (epochMs: number) => string;
  maxPerDay?: number;
  maxUpcoming?: number;
}): RuleResult {
  const maxPerDay = p.maxPerDay ?? MAX_BOOKINGS_PER_DAY;
  const maxUpcoming = p.maxUpcoming ?? MAX_UPCOMING_BOOKINGS;
  const live = p.mine.filter((b) => b.status === 'RESERVED');
  const sameDay = live.filter((b) => p.dayOf(b.range.start) === p.dayOf(p.candidate.start)).length;
  if (sameDay >= maxPerDay) {
    return fail('BOOKING_LIMIT_DAY', `Tu as déjà ${maxPerDay} réservations ce jour-là. C’est le maximum, pour laisser des créneaux à tout le monde.`);
  }
  const upcoming = live.filter((b) => b.range.start > p.now).length;
  if (upcoming >= maxUpcoming) {
    return fail('BOOKING_LIMIT_UPCOMING', `Tu as déjà ${maxUpcoming} réservations à venir. Joue-en une, ou annule celle dont tu n’as plus besoin, et tu pourras en prendre une autre.`);
  }
  return ok;
}
