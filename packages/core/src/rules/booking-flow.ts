/* =============================================================================
   RÈGLES — PARCOURS DE RÉSERVATION (Phase 5).
   Une seule fonction prépare une réservation : elle vérifie la disponibilité
   (réservations bloquantes + abonnements), chiffre le créneau au prorata des
   bandes tarifaires, et produit le Booking prêt à insérer. L'app (chemins
   MOUBARAT et EXTERNAL) et le CRM appellent la même fonction.
   ========================================================================== */

import type { Booking, Field, MatchFormat } from '../entities.js';
import type { Quote, OpeningHours, PricingRule, RecurringBooking } from './availability.js';
import { quoteRange, recurringOccurrence, MIN } from './availability.js';
import { isBlocking } from './booking.js';
import { overlaps, type TimeRange } from '../time.js';
import { fail, ok, type RuleResult } from '../result.js';

export interface PrepareBookingInput {
  id: string;
  field: Pick<Field, 'id' | 'hourlyRate' | 'formats'>;
  rules: readonly PricingRule[];
  hours?: readonly OpeningHours[];        // si fourni : le créneau doit tenir dans l'ouverture
  weekday: number;
  dayStartMs: number;                     // minuit local du jour choisi
  startMin: number;
  durationMin: number;
  /** 16/09/2026, demande d'Aymen : le prix (base ET bandes horaires) dépend
      du format choisi — fixé ici, jamais recalculé après coup (voir
      Booking.format, porté par l'appelant, pas par ce type gelé). */
  format: MatchFormat;
  existing: readonly Booking[];
  recurring?: readonly RecurringBooking[];
  byUserId: string;
  reservationName?: string;               // on réserve à son nom, en Algérie
  source?: 'MOUBARAT' | 'PHONE' | 'WALK_IN';
  now: number;
}

export interface PreparedBooking {
  result: RuleResult;
  booking?: Booking;
  quote?: Quote;
  /** PHONE déclaré → le gérant reçoit EXTERNAL_BOOKING_TO_VERIFY et doit confirmer. */
  notifyCenter: boolean;
}

export function prepareBooking(p: PrepareBookingInput): PreparedBooking {
  if (!p.field.formats.includes(p.format)) {
    return { result: fail('FORMAT_NOT_AVAILABLE', `Ce terrain ne propose pas le format ${p.format}.`), notifyCenter: false };
  }
  if (p.durationMin < 30 || p.durationMin > 360) {
    return { result: fail('HOURS_INVALID', 'Une réservation dure entre 30 minutes et 6 heures.'), notifyCenter: false };
  }
  const endMin = p.startMin + p.durationMin;
  // Lot P1 (03/09/2026) : un créneau dont le début est déjà passé ne se
  // réserve pas — la disponibilité (GET /fields/:id/availability) le filtrait
  // déjà, mais la création elle-même ne le revérifiait jamais : un appel
  // direct à l'API pouvait créer une réservation dans le passé. Testé avant
  // l'ouverture (un créneau passé « hors horaires » dirait le mauvais motif).
  // Comparaison en epoch absolu : indifférent au jour calendaire, donc
  // correct aussi pour un créneau après minuit (startMin > 1440).
  // Décision Aymen (04/09/2026) : un joueur (MOUBARAT) ne réserve jamais un
  // départ déjà passé ; une source centre (PHONE / WALK_IN) peut enregistrer
  // un créneau EN COURS — client en retard déclaré à l'accueil — tant qu'il
  // n'est pas terminé.
  const centerSource = p.source === 'PHONE' || p.source === 'WALK_IN';
  const startsAt = p.dayStartMs + p.startMin * MIN;
  const endsAt = p.dayStartMs + endMin * MIN;
  if (centerSource ? endsAt <= p.now : startsAt <= p.now) {
    return {
      result: fail('SLOT_IN_PAST', centerSource ? 'Ce créneau est déjà terminé.' : 'Ce créneau est déjà passé.'),
      notifyCenter: false,
    };
  }
  if (p.hours && !p.hours.some((h) => h.weekday === p.weekday && p.startMin >= h.startMin && endMin <= h.endMin)) {
    return { result: fail('HOURS_INVALID', 'Ce créneau sort des horaires d’ouverture du centre.'), notifyCenter: false };
  }

  const range: TimeRange = {
    start: p.dayStartMs + p.startMin * MIN,
    end: p.dayStartMs + endMin * MIN,
  };
  const blockers: TimeRange[] = [
    ...p.existing.filter((b) => b.fieldId === p.field.id && isBlocking(b)).map((b) => b.range),
    ...(p.recurring ?? [])
      .filter((r) => r.fieldId === p.field.id)
      .map((r) => recurringOccurrence(r, p.weekday, p.dayStartMs))
      .filter((r): r is TimeRange => r !== null),
  ];
  if (blockers.some((b) => overlaps(b, range))) {
    return { result: fail('SLOT_TAKEN', 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.'), notifyCenter: false };
  }

  const quote = quoteRange(p.rules, p.field.hourlyRate, p.weekday, p.startMin, endMin, p.format);
  const source = p.source ?? 'MOUBARAT';
  const booking: Booking = {
    id: p.id,
    fieldId: p.field.id,
    range,
    status: 'RESERVED',
    source,
    verifiedByCenter: source === 'MOUBARAT',
    byUserId: p.byUserId,
    priceTotal: quote.total,
    createdAt: p.now,
    ...(p.reservationName !== undefined ? { reservationName: p.reservationName } : {}),
  };
  /* PHONE déclaré par le joueur → à vérifier + alerte gérant.
     WALK_IN créé au comptoir → vérifié d'office (le centre EST la source). */
  if (source === 'WALK_IN') booking.verifiedByCenter = true;
  return { result: ok, booking, quote, notifyCenter: source === 'PHONE' && !booking.verifiedByCenter };
}

/* --- Référence de réservation ---------------------------------------------- */

/** « COM-000482 » : ce que le joueur donne à l'accueil avec son nom, en espèces.
    22/09/2026 (audit multi-centre, décision Aymen) : `prefix` est un CODE FIXE attribué une fois pour toutes
    à la création du centre (`venues.booking_prefix`, migration 0021) — jamais dérivé du nom à chaque appel
    comme avant. Renommer un centre ne change donc plus jamais ses références, passées ou futures. `prefix`
    doit déjà être 3 lettres majuscules valides (garanti par la contrainte de base et `deriveBookingPrefix`
    ci-dessous) : cette fonction ne le retouche pas. Numéro élargi à 6 chiffres (au lieu de 4) : à 50
    réservations/jour, 4 chiffres tenaient ~200 jours avant de reboucler sur une référence déjà utilisée,
    6 chiffres tiennent plus de 50 ans. */
export function bookingReference(prefix: string, seq: number): string {
  return `${prefix}-${String(seq % 1_000_000).padStart(6, '0')}`;
}

/** Préfixe candidat pour un NOUVEAU centre, dérivé de son nom — jamais rappelé après la création (le
    préfixe, une fois attribué, ne change plus). Fenêtre glissante de 3 lettres consécutives dans le nom :
    le premier candidat (`letters.slice(0,3)`) reproduit l'ancien comportement ; les suivants ne servent
    qu'en cas de collision avec un préfixe déjà pris par un autre centre (vérifié par l'appelant, qui a seul
    accès à la base). Moins de 3 lettres dans le nom → complété par des « X ». */
export function deriveBookingPrefixCandidates(venueName: string): string[] {
  const raw = venueName.normalize('NFD').replace(/[^a-zA-Z]/g, '').toUpperCase();
  const letters = raw.length >= 3 ? raw : raw.padEnd(3, 'X');
  const candidates: string[] = [];
  for (let i = 0; i + 3 <= letters.length; i++) candidates.push(letters.slice(i, i + 3));
  return candidates;
}

/* --- Le cash devient mesurable ---------------------------------------------
   C'est la promesse de la tarification SaaS : taux de no-show et revenu réel.
   Tout sort des statuts — rien n'est déclaratif. */

export interface BookingStats {
  reserved: number;
  honored: number;
  paid: number;
  noShow: number;
  cancelled: number;
  /** no-show / issues connues (honoré + payé + no-show). null tant qu'aucune issue. */
  noShowRate: number | null;
  cashCollected: number;     // DA encaissés (PAID)
  cashExpected: number;      // DA engagés non encaissés (RESERVED + HONORED)
}

export function bookingStats(bookings: readonly Booking[]): BookingStats {
  const s: BookingStats = {
    reserved: 0, honored: 0, paid: 0, noShow: 0, cancelled: 0,
    noShowRate: null, cashCollected: 0, cashExpected: 0,
  };
  for (const b of bookings) {
    if (b.status === 'RESERVED') { s.reserved++; s.cashExpected += b.priceTotal.amount; }
    else if (b.status === 'HONORED') { s.honored++; s.cashExpected += b.priceTotal.amount; }
    else if (b.status === 'PAID') { s.paid++; s.cashCollected += b.priceTotal.amount; }
    else if (b.status === 'NO_SHOW') s.noShow++;
    else s.cancelled++;
  }
  const outcomes = s.honored + s.paid + s.noShow;
  if (outcomes > 0) s.noShowRate = s.noShow / outcomes;
  return s;
}
