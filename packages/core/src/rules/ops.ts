/* =============================================================================
   RÈGLES — OPÉRATIONS CENTRE (Lot A, Phase 11-OPS).
   Réponse au MASTER SPEC CRM V1 : les extensions qui font passer le CRM de
   « montrer » à « piloter ». Tout est déterministe, explicable et testé —
   chaque score liste ses raisons, chaque mouvement a un auteur.
   ========================================================================== */

import type { Booking } from '../entities.js';
import { fail, ok, type RuleResult } from '../result.js';
import { CANCEL_FREE_BEFORE_MS, overlaps, type TimeRange } from '../time.js';
import { DAY_MIN, MIN, recurringOccurrence, weekdayOfDayStart, type RecurringBooking } from './availability.js';
import type { CenterRole } from './crm.js';

/* --- Fermetures exceptionnelles (§9) : fériés, événements, travaux ----------- */

export type ClosureReason = 'HOLIDAY' | 'EVENT' | 'MAINTENANCE' | 'OTHER';

/** Chantier arabe RTL (18/10/2026, lot 1) : était défini deux fois indépendamment côté
    CRM (Centre.tsx ET Planning.tsx, mêmes valeurs, deux sources) — unifié ici, à côté
    du type qu'il libelle, pour qu'une future traduction n'ait qu'un seul endroit à toucher. */
export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  HOLIDAY: 'Jour férié', EVENT: 'Événement', MAINTENANCE: 'Maintenance', OTHER: 'Autre',
};

/** Message de repli générique (jamais une règle métier) — avant le 18/10/2026, retapé
    en dur ~55 fois dans 18 fichiers à travers les trois apps, toujours identique au
    caractère. Un seul endroit désormais ; utilisé quand une erreur n'a pas de message
    serveur exploitable (réseau coupé, réponse non JSON…). */
export const GENERIC_ERROR_MESSAGE = 'Une erreur est survenue. Réessaie.';

export interface Closure {
  id: string;
  venueId: string;
  /** null = tout le centre est fermé ; sinon un seul terrain. */
  fieldId: string | null;
  range: TimeRange;
  reason: ClosureReason;
  label?: string;             // « Aïd », « Tournoi privé »…
}

export function validateClosure(c: Pick<Closure, 'range'>): RuleResult {
  if (c.range.end <= c.range.start) return fail('HOURS_INVALID', 'La fin de la fermeture doit suivre son début.');
  return ok;
}

/** Les fermetures qui bloquent CE terrain sur CETTE plage (centre entier inclus). */
export function closureBlockers(closures: readonly Closure[], fieldId: string, day: TimeRange): TimeRange[] {
  return closures
    .filter((c) => (c.fieldId === null || c.fieldId === fieldId) && overlaps(c.range, day))
    .map((c) => c.range);
}

/* --- Statut de terrain (§35) : on archive, on ne supprime jamais ------------- */

export type FieldStatus = 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED';

export function assertFieldBookable(status: FieldStatus): RuleResult {
  if (status === 'ACTIVE') return ok;
  return fail('INVALID_TARGET', status === 'MAINTENANCE'
    ? 'Ce terrain est en maintenance — créneau indisponible.'
    : 'Ce terrain est archivé. Son historique est conservé, mais il ne se réserve plus.');
}

/* --- Modifier / déplacer une réservation (§10) ------------------------------- */

/** Le déplacement ne réécrit pas l'histoire : même id, même source, même nom.
    Seuls RESERVED se déplacent (un client arrivé, payé ou absent, c'est du passé).
    La revérification de conflit sur la cible est faite par l'appelant avec le
    même moteur que la création (fieldAvailability / contrainte d'exclusion). */
export function rescheduleBooking(p: {
  booking: Booking;
  newFieldId?: string;
  newRange?: TimeRange;
  newPriceTotalDa?: number;   // requoté par l'appelant via quoteRange
  byRole: CenterRole;
  now: number;
}): { result: RuleResult; booking?: Booking } {
  if (p.booking.status !== 'RESERVED') {
    return { result: fail('INVALID_TARGET', 'Seule une réservation encore à venir (réservée) peut être modifiée.') };
  }
  if (p.booking.source === 'CENTER') {
    return { result: fail('INVALID_TARGET', 'Un blocage se débloque et se recrée — il ne se déplace pas.') };
  }
  const range = p.newRange ?? p.booking.range;
  if (range.end <= range.start) return { result: fail('HOURS_INVALID', 'La fin doit suivre le début.') };
  if (range.start <= p.now) return { result: fail('HOURS_INVALID', 'On ne déplace pas une réservation vers le passé.') };
  return {
    result: ok,
    booking: {
      ...p.booking,
      fieldId: p.newFieldId ?? p.booking.fieldId,
      range,
      priceTotal: p.newPriceTotalDa != null
        ? { ...p.booking.priceTotal, amount: p.newPriceTotalDa }
        : p.booking.priceTotal,
    },
  };
}

/* --- Annulation : anticipée ou tardive (§18 modifiée, §19 nouvelle) ---------- */

/** Même seuil que la fenêtre H-2 (`CANCEL_FREE_BEFORE_MS`, time.ts — toujours utilisée telle quelle
    par `canLeaveMatch`, match.ts) — plus deux constantes séparées à faire dériver : passé 24 h,
    Aymen a ramené ce seuil à 2 h (25/10/2026) pour que « annulation tardive » veuille dire la même
    chose que « H-2 ». */
export const CANCEL_LATE_THRESHOLD_MS = CANCEL_FREE_BEFORE_MS;

export function cancellationKind(bookingStartMs: number, cancelledAtMs: number): 'EARLY' | 'LATE' {
  return bookingStartMs - cancelledAtMs >= CANCEL_LATE_THRESHOLD_MS ? 'EARLY' : 'LATE';
}

/* --- Fiabilité pondérée + confiance (§17) ------------------------------------ */

export const RELIABILITY_MIN_VISIBLE = 3;

export interface ReliabilityV1 {
  visible: boolean;
  score: number | null;
  band: 'TRES_FIABLE' | 'CORRECT' | 'A_SURVEILLER' | 'RISQUE' | null;
  confidence: 'FAIBLE' | 'MOYENNE' | 'ELEVEE' | null;
  total: number;
}

/** points = honorées×(+1) + annulées>24h×(0) + annulées<24h×(−0,5) + no-shows×(−2)
    score  = clamp(0, 100, 100 × points ÷ total).
    Ne pas venir sans prévenir coûte 4× plus qu'annuler la veille au soir. */
export function clientReliabilityV1(p: {
  honored: number; paid: number; cancelledEarly: number; cancelledLate: number; noShow: number;
}): ReliabilityV1 {
  const kept = p.honored + p.paid;
  const total = kept + p.cancelledEarly + p.cancelledLate + p.noShow;
  if (total < RELIABILITY_MIN_VISIBLE) {
    return { visible: false, score: null, band: null, confidence: null, total };
  }
  const points = kept - 0.5 * p.cancelledLate - 2 * p.noShow;
  const score = Math.max(0, Math.min(100, Math.round((points / total) * 100)));
  const band = score >= 90 ? 'TRES_FIABLE' : score >= 70 ? 'CORRECT' : score >= 50 ? 'A_SURVEILLER' : 'RISQUE';
  const confidence = total >= 20 ? 'ELEVEE' : total >= 5 ? 'MOYENNE' : 'FAIBLE';
  return { visible: true, score, band, confidence, total };
}

export const CONFIDENCE_LABELS: Record<NonNullable<ReliabilityV1['confidence']>, string> = {
  FAIBLE: 'Confiance faible', MOYENNE: 'Confiance moyenne', ELEVEE: 'Confiance élevée',
};

/* --- Match Health (§7) : un %, mais déterministe et qui dit pourquoi ---------- */

export interface HealthPenalty { label: string; points: number; }
export interface MatchHealth {
  score: number;
  band: 'FAIBLE_RISQUE' | 'A_SURVEILLER' | 'RISQUE_ELEVE';
  penalties: HealthPenalty[];
}

export function matchHealth(p: {
  capacity: number;
  joinedCount: number;
  startMs: number;
  now: number;
  captainReliability?: number | null;      // 0–100, null = inconnue
  avgPlayerReliability?: number | null;    // 0–100 sur les inscrits connus
  unconfirmedCount?: number;
}): MatchHealth {
  const pen: HealthPenalty[] = [];
  const missing = Math.max(0, p.capacity - p.joinedCount);
  const fillGap = missing / p.capacity;
  if (missing > 0) {
    pen.push({ label: `Effectif ${p.joinedCount}/${p.capacity}`, points: Math.round(fillGap * 40) });
    const hoursLeft = (p.startMs - p.now) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft <= 2) pen.push({ label: 'Début dans moins de 2 h, incomplet', points: 15 });
    else if (hoursLeft > 2 && hoursLeft <= 6) pen.push({ label: 'Début dans moins de 6 h, incomplet', points: 8 });
  }
  if (p.captainReliability != null && p.captainReliability < 90) {
    pen.push({ label: `Fiabilité du capitaine ${p.captainReliability}/100`, points: Math.round((100 - p.captainReliability) * 0.2) });
  }
  if (p.avgPlayerReliability != null && p.avgPlayerReliability < 90) {
    pen.push({ label: `Fiabilité moyenne des inscrits ${p.avgPlayerReliability}/100`, points: Math.round((100 - p.avgPlayerReliability) * 0.15) });
  }
  if ((p.unconfirmedCount ?? 0) > 0) {
    pen.push({ label: `${p.unconfirmedCount} inscrit(s) non confirmé(s)`, points: Math.min(10, (p.unconfirmedCount ?? 0) * 3) });
  }
  const score = Math.max(0, Math.min(100, 100 - pen.reduce((s, x) => s + x.points, 0)));
  const band = score >= 70 ? 'FAIBLE_RISQUE' : score >= 40 ? 'A_SURVEILLER' : 'RISQUE_ELEVE';
  return { score, band, penalties: pen };
}

/* --- Présence par joueur (§16) ------------------------------------------------ */

export type AttendanceStatus = 'EXPECTED' | 'CONFIRMED' | 'ARRIVED' | 'NO_SHOW';

export interface MatchAttendance {
  matchId: string;
  userId: string;
  status: AttendanceStatus;
  updatedAt: number;
  updatedBy: string;
}

const ATTENDANCE_TRANSITIONS: Record<AttendanceStatus, readonly AttendanceStatus[]> = {
  EXPECTED: ['CONFIRMED', 'ARRIVED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'NO_SHOW'],
  ARRIVED: [],                 // arrivé, c'est arrivé — pas de no-show rétroactif
  NO_SHOW: ['ARRIVED'],        // il a fini par venir : la vérité corrige l'erreur
};

export function setAttendance(current: AttendanceStatus, next: AttendanceStatus): RuleResult {
  if (current === next) return ok;
  if (!ATTENDANCE_TRANSITIONS[current].includes(next)) {
    return fail('INVALID_TARGET', `Passage ${current} → ${next} impossible.`);
  }
  return ok;
}

/* --- Journal d'audit (§38) : « qui a bloqué le T2 mercredi ? » ---------------- */

export type AuditAction =
  | 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CASH_STATUS'
  | 'SLOT_BLOCKED' | 'SLOT_UNBLOCKED'
  | 'PRICE_RULE_CHANGED' | 'PROMO_CHANGED' | 'SUBSCRIPTION_CHANGED'
  | 'CASH_SESSION' | 'CASH_MOVEMENT'
  | 'ROLE_CHANGED' | 'CENTER_UPDATED' | 'FIELD_CHANGED' | 'ATTENDANCE_SET';

export interface AuditEvent {
  id: string;
  venueId: string;
  actorId: string;
  actorName: string;
  actorRole: CenterRole;
  action: AuditAction;
  objectType: string;         // 'booking', 'field', 'promo'…
  objectId: string;
  summary: string;            // « a bloqué T2 (maintenance) 18:00 → 20:00 »
  before?: string;
  after?: string;
  at: number;
}

export const ROLE_LABELS: Record<CenterRole, string> = {
  OWNER: 'Propriétaire', MANAGER: 'Manager', RECEPTION: 'Réception', STAFF: 'Staff',
};

export function auditEntry(p: Omit<AuditEvent, 'id'> & { id?: string }): AuditEvent {
  return { id: p.id ?? `${p.at}-${p.objectId}`, ...p } as AuditEvent;
}

/** « Nadia · Réception · 14:32 — a bloqué T2 (maintenance) » */
export function formatAuditLine(e: AuditEvent, hhmm: string): string {
  return `${e.actorName} · ${ROLE_LABELS[e.actorRole]} · ${hhmm} — ${e.summary}`;
}

/* --- Caisse opérationnelle (§31) ---------------------------------------------- */

export interface CashSession {
  id: string;
  venueId: string;
  openedBy: string;
  openedAt: number;
  openingFloatDa: number;
  status: 'OPEN' | 'CLOSED';
  closedBy?: string;
  closedAt?: number;
  declaredClosingDa?: number;
}

export interface CashMovement {
  id: string;
  sessionId: string;
  kind: 'COLLECTION' | 'PAYOUT';
  amountDa: number;           // toujours positif ; le sens vient de kind
  byUserId: string;
  at: number;
  ref?: string;               // « RYD-0484 »
  note?: string;
}

export function openCashSession(p: {
  id: string; venueId: string; by: string; at: number; openingFloatDa: number;
  hasOpenSession: boolean;
}): { result: RuleResult; session?: CashSession } {
  if (p.hasOpenSession) return { result: fail('INVALID_TARGET', 'Une caisse est déjà ouverte — clôture-la d’abord.') };
  if (p.openingFloatDa < 0) return { result: fail('INVALID_TARGET', 'Le fonds d’ouverture ne peut pas être négatif.') };
  return {
    result: ok,
    session: { id: p.id, venueId: p.venueId, openedBy: p.by, openedAt: p.at, openingFloatDa: p.openingFloatDa, status: 'OPEN' },
  };
}

export function addCashMovement(p: {
  id: string; session: CashSession; kind: CashMovement['kind'];
  amountDa: number; by: string; at: number; ref?: string; note?: string;
}): { result: RuleResult; movement?: CashMovement } {
  if (p.session.status !== 'OPEN') return { result: fail('INVALID_TARGET', 'La caisse est clôturée.') };
  if (p.amountDa <= 0) return { result: fail('INVALID_TARGET', 'Un mouvement de caisse est toujours strictement positif.') };
  const movement: CashMovement = { id: p.id, sessionId: p.session.id, kind: p.kind, amountDa: p.amountDa, byUserId: p.by, at: p.at };
  if (p.ref != null) movement.ref = p.ref;
  if (p.note != null) movement.note = p.note;
  return { result: ok, movement };
}

export function cashExpected(session: CashSession, movements: readonly CashMovement[]): number {
  return session.openingFloatDa + movements
    .filter((m) => m.sessionId === session.id)
    .reduce((s, m) => s + (m.kind === 'COLLECTION' ? m.amountDa : -m.amountDa), 0);
}

export function closeCashSession(p: {
  session: CashSession; movements: readonly CashMovement[];
  declaredClosingDa: number; by: string; at: number;
}): { result: RuleResult; session?: CashSession; expectedDa?: number; varianceDa?: number } {
  if (p.session.status !== 'OPEN') return { result: fail('INVALID_TARGET', 'Cette caisse est déjà clôturée.') };
  const expectedDa = cashExpected(p.session, p.movements);
  return {
    result: ok,
    session: { ...p.session, status: 'CLOSED', closedBy: p.by, closedAt: p.at, declaredClosingDa: p.declaredClosingDa },
    expectedDa,
    varianceDa: p.declaredClosingDa - expectedDa,   // 0 = caisse juste
  };
}

/* --- Conflit abonnement × occupation (§30) ------------------------------------ */

export function occurrenceRange(rec: RecurringBooking, dayStartMs: number): TimeRange | null {
  const weekday = weekdayOfDayStart(dayStartMs);
  return recurringOccurrence(rec, weekday, dayStartMs);
}

/** L'occurrence de l'abonnement ce jour-là entre-t-elle en collision avec une
    occupation bloquante du même terrain (blocage, résa, autre abonnement) ?
    Retourne le premier conflit — au gérant de trancher (déplacer / libérer). */
export function recurringConflict(
  rec: RecurringBooking, dayStartMs: number,
  blockers: readonly { fieldId: string; range: TimeRange }[],
): { conflict: boolean; with?: { fieldId: string; range: TimeRange } } {
  const range = occurrenceRange(rec, dayStartMs);
  if (!range) return { conflict: false };
  const hit = blockers.find((b) => b.fieldId === rec.fieldId && overlaps(b.range, range));
  return hit ? { conflict: true, with: hit } : { conflict: false };
}

/* --- Origine des réservations (§25) : part Moubarat vs téléphone vs comptoir --- */

export interface OriginShare {
  total: number;
  moubarat: number; phone: number; walkIn: number;
  moubaratPct: number; phonePct: number; walkInPct: number;
}

export function bookingOriginShare(bookings: readonly Pick<Booking, 'source' | 'status'>[]): OriginShare {
  const live = bookings.filter((b) => b.source !== 'CENTER' && b.status !== 'CANCELLED');
  const count = (s: Booking['source']) => live.filter((b) => b.source === s).length;
  const total = live.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const moubarat = count('MOUBARAT'), phone = count('PHONE'), walkIn = count('WALK_IN');
  return { total, moubarat, phone, walkIn, moubaratPct: pct(moubarat), phonePct: pct(phone), walkInPct: pct(walkIn) };
}

/* Réexport pratique pour les vues du jour. */
export const OPS_DAY_MS = DAY_MIN * MIN;
