/* =============================================================================
   RÈGLES — CRM CENTRE (Phase 11).
   Le CRM hérite de l'intégrité de l'app : tout chiffre est dérivé des statuts,
   tout signal est explicable. Pas de probabilité sans données, pas de score
   opaque. Trois rôles côté centre, une matrice, et des dérivations.
   ========================================================================== */

import type { Booking } from '../entities.js';
import { fail, ok, type RuleResult } from '../result.js';

/* --- Rôles & permissions (décision §24, révocable) -------------------------- */

export type CenterRole = 'OWNER' | 'MANAGER' | 'RECEPTION' | 'STAFF';

export type CenterAction =
  | 'VIEW_PLANNING' | 'CREATE_BOOKING' | 'CONFIRM_EXTERNAL' | 'SET_CASH_STATUS' | 'BLOCK_SLOT'
  | 'CANCEL_BOOKING' | 'EDIT_PRICING' | 'EDIT_HOURS' | 'EDIT_FIELDS' | 'VIEW_ANALYTICS' | 'VIEW_CLIENTS'
  | 'EDIT_PROFILE' | 'MANAGE_PROMOS' | 'MANAGE_SUBSCRIPTIONS'
  | 'MODIFY_BOOKING' | 'SET_ATTENDANCE' | 'CASH_SESSION' | 'VIEW_AUDIT_LOG'
  | 'MANAGE_STAFF'
  /** Audit final 26/10/2026 (P1-3, GO d'Aymen) : corriger un « no-show » posé par erreur (manager et propriétaire). */
  | 'REVERT_NO_SHOW';

const STAFF_ACTIONS: readonly CenterAction[] = [
  'VIEW_PLANNING', 'SET_ATTENDANCE',
];
/* CRM-4 (audit pré-lancement, lot 7, 27/09/2026, GO explicite d'Aymen — décision consignée dans
   docs/DECISIONS.md, § Revue des P1) : CANCEL_BOOKING descend de Manager+ à Réception+. Le comptoir
   annule déjà de fait (au téléphone, en salle) sans pouvoir le faire dans l'outil — obligé de chercher
   un manager ou de laisser la réservation traîner. Le motif d'annulation reste OBLIGATOIRE quel que soit
   le rôle (bookings/routes.ts, `CANCEL_REASON_REQUIRED`, jamais un défaut silencieux) et tracé (Journal) —
   c'est ce filet, pas le rôle, qui protège contre une annulation arbitraire. */
const RECEPTION_ACTIONS: readonly CenterAction[] = [
  ...STAFF_ACTIONS,
  'CREATE_BOOKING', 'MODIFY_BOOKING', 'CONFIRM_EXTERNAL', 'SET_CASH_STATUS', 'BLOCK_SLOT',
  'CASH_SESSION', 'VIEW_CLIENTS', 'CANCEL_BOOKING',
];
const MANAGER_ACTIONS: readonly CenterAction[] = [
  ...RECEPTION_ACTIONS,
  'EDIT_PRICING', 'EDIT_HOURS', 'EDIT_FIELDS', 'VIEW_ANALYTICS',
  'EDIT_PROFILE', 'MANAGE_PROMOS', 'MANAGE_SUBSCRIPTIONS', 'VIEW_AUDIT_LOG', 'REVERT_NO_SHOW',
];
export const CENTER_PERMISSIONS: Record<CenterRole, readonly CenterAction[]> = {
  STAFF: STAFF_ACTIONS,             // lecture du planning + présence, rien d'autre
  RECEPTION: RECEPTION_ACTIONS,     // le comptoir : encaisse, confirme, bloque, caisse
  MANAGER: MANAGER_ACTIONS,
  OWNER: [...MANAGER_ACTIONS, 'MANAGE_STAFF'],
};

export function canCenterAct(role: CenterRole, action: CenterAction): RuleResult {
  if (CENTER_PERMISSIONS[role].includes(action)) return ok;
  const need = action === 'MANAGE_STAFF' ? 'propriétaire'
    : CENTER_PERMISSIONS.RECEPTION.includes(action) ? 'personnel d’accueil (Réception)'
    : 'manager';
  return fail('FORBIDDEN', `Action réservée au ${need} du centre.`);
}

/* --- Blocage de créneau (maintenance, privatisation, événement) -------------- */

export type BlockReason = 'MAINTENANCE' | 'PRIVATIZATION' | 'EVENT' | 'OTHER';

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  MAINTENANCE: 'Maintenance',
  PRIVATIZATION: 'Privatisation',
  EVENT: 'Événement',
  OTHER: 'Autre',
};

/** Un blocage est une réservation source CENTER, à 0 DA, vérifiée d'office.
    Elle bloque le créneau exactement comme une réservation — même contrainte
    d'exclusion en base — mais ne compte ni dans le cash ni dans l'occupation. */
export function blockSlot(p: {
  id: string; role: CenterRole; fieldId: string;
  range: { start: number; end: number }; reason: BlockReason; byUserId: string; now: number;
}): { result: RuleResult; booking?: Booking } {
  const perm = canCenterAct(p.role, 'BLOCK_SLOT');
  if (!perm.ok) return { result: perm };
  if (p.range.end <= p.range.start) {
    return { result: fail('HOURS_INVALID', 'La fin du blocage doit suivre son début.') };
  }
  return {
    result: ok,
    booking: {
      id: p.id, fieldId: p.fieldId, range: p.range, status: 'RESERVED',
      source: 'CENTER', blockReason: p.reason, verifiedByCenter: true,
      byUserId: p.byUserId, priceTotal: { amount: 0, currency: 'DZD', unit: 'TOTAL' },
      createdAt: p.now,
    },
  };
}

/* --- Matchs à risque : des drapeaux EXPLICABLES, pas une probabilité --------- */

export interface RiskFlag { code: 'UNDERFILLED' | 'ORGANIZER_UNRELIABLE' | 'UNCONFIRMED_EXTERNAL'; label: string; }

export function matchRiskFlags(p: {
  capacity: number; joinedCount: number; startMs: number; now: number;
  organizerNoShows?: number; externalUnverified?: boolean;
}): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const soon = p.startMs > p.now && p.startMs - p.now <= 24 * 3_600_000;
  if (soon && p.joinedCount / p.capacity < 0.6) {
    flags.push({ code: 'UNDERFILLED', label: `Effectif ${p.joinedCount}/${p.capacity}` });
  }
  if ((p.organizerNoShows ?? 0) >= 2) {
    flags.push({ code: 'ORGANIZER_UNRELIABLE', label: `Organisateur : ${p.organizerNoShows} no-shows` });
  }
  if (p.externalUnverified) {
    flags.push({ code: 'UNCONFIRMED_EXTERNAL', label: 'Réservation téléphonique non confirmée' });
  }
  return flags;
}

/* --- Fiabilité client : transparente, décomposée, réservée au centre --------- */

export const RELIABILITY_VISIBLE_MIN = 3;   // en dessous : « Nouveau », pas de score

export interface Reliability {
  visible: boolean;
  score: number | null;
  band: 'TRES_FIABLE' | 'CORRECT' | 'A_SURVEILLER' | 'RISQUE' | null;
  kept: number; cancelled: number; noShow: number; total: number;
}

/** score = 100 × (honorées / total) − 20 par no-show, borné [0, 100].
    L'annulation pèse par le ratio ; le no-show coûte en plus — ne pas venir
    sans prévenir n'est pas annuler à temps. La décomposition est affichée. */
export function clientReliability(p: {
  honored: number; paid: number; cancelled: number; noShow: number;
}): Reliability {
  const kept = p.honored + p.paid;
  const total = kept + p.cancelled + p.noShow;
  if (total < RELIABILITY_VISIBLE_MIN) {
    return { visible: false, score: null, band: null, kept, cancelled: p.cancelled, noShow: p.noShow, total };
  }
  const score = Math.max(0, Math.min(100, Math.round((kept / total) * 100) - 20 * p.noShow));
  const band = score >= 90 ? 'TRES_FIABLE' : score >= 70 ? 'CORRECT' : score >= 50 ? 'A_SURVEILLER' : 'RISQUE';
  return { visible: true, score, band, kept, cancelled: p.cancelled, noShow: p.noShow, total };
}

export const RELIABILITY_BAND_LABELS: Record<NonNullable<Reliability['band']>, string> = {
  TRES_FIABLE: 'Très fiable', CORRECT: 'Correct', A_SURVEILLER: 'À surveiller', RISQUE: 'Risqué',
};

/* --- Comptabilité & occupation : tout dérivé, rien de déclaratif -------------- */

export interface CashReport { collected: number; engaged: number; lostCancelled: number; lostNoShow: number; }

/** Les blocages CENTER (0 DA) sont exclus : ils ne sont pas du chiffre. */
export function cashReport(bookings: readonly Booking[]): CashReport {
  const r: CashReport = { collected: 0, engaged: 0, lostCancelled: 0, lostNoShow: 0 };
  for (const b of bookings) {
    if (b.source === 'CENTER') continue;
    if (b.status === 'PAID') r.collected += b.priceTotal.amount;
    else if (b.status === 'RESERVED' || b.status === 'HONORED') r.engaged += b.priceTotal.amount;
    else if (b.status === 'CANCELLED') r.lostCancelled += b.priceTotal.amount;
    else if (b.status === 'NO_SHOW') r.lostNoShow += b.priceTotal.amount;
  }
  return r;
}

/** Occupation d'une journée : minutes réservées (hors blocages et annulations)
    ÷ minutes d'ouverture, sur l'ensemble des terrains fournis. */
export function occupancyRate(p: {
  openMinutesPerField: number; fieldCount: number;
  bookings: readonly Pick<Booking, 'status' | 'source' | 'range'>[];
}): number {
  const open = p.openMinutesPerField * p.fieldCount;
  if (open <= 0) return 0;
  const booked = p.bookings
    .filter((b) => b.source !== 'CENTER' && (b.status === 'RESERVED' || b.status === 'HONORED' || b.status === 'PAID'))
    .reduce((s, b) => s + (b.range.end - b.range.start) / 60_000, 0);
  return Math.min(1, booked / open);
}

/* --- Occupation par terrain : « le T1 performe à 80 %, le T5 à 10 % » -------- */

export function occupancyByField(p: {
  fieldIds: readonly string[]; openMinutesPerField: number;
  bookings: readonly Pick<Booking, 'fieldId' | 'status' | 'source' | 'range'>[];
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of p.fieldIds) {
    out[f] = occupancyRate({
      openMinutesPerField: p.openMinutesPerField, fieldCount: 1,
      bookings: p.bookings.filter((b) => b.fieldId === f),
    });
  }
  return out;
}

/* --- Suivi du paramétrage : la fiche du centre est-elle prête pour l'app ? ---- */

export interface SetupItem { key: string; label: string; ok: boolean; }

export function setupChecklist(c: {
  photoCount: number; descriptionLength: number; hasLocation: boolean;
  hasHours: boolean; fieldsConfigured: number; equipmentCount: number;
}): { items: SetupItem[]; percent: number } {
  const items: SetupItem[] = [
    { key: 'photos', label: 'Au moins 1 photo du centre', ok: c.photoCount >= 1 },
    { key: 'description', label: 'Description (40 caractères min.)', ok: c.descriptionLength >= 40 },
    { key: 'location', label: 'Localisation sur la carte', ok: c.hasLocation },
    { key: 'hours', label: 'Horaires d’ouverture', ok: c.hasHours },
    { key: 'fields', label: 'Au moins 1 terrain configuré (sport, formats, tarif)', ok: c.fieldsConfigured >= 1 },
    { key: 'equipments', label: 'Équipements renseignés', ok: c.equipmentCount >= 1 },
  ];
  const percent = Math.round(100 * items.filter((i) => i.ok).length / items.length);
  return { items, percent };
}

/* --- Codes promo (avancés de V1.5 → V1 à la demande d'Aymen) ------------------ */

export interface PromoCode {
  id: string;
  venueId: string;
  code: string;                 // « TUESDAY15 »
  label: string;                // « Mardi après-midi »
  percentOff: number;           // 5–50
  weekdays: readonly number[];  // 0 = dimanche (JS)
  startMin: number;             // le créneau doit DÉMARRER dans la bande
  endMin: number;
  validFromMs: number;
  validUntilMs: number;
  fieldIds?: readonly string[]; // absent = tous les terrains
  sports?: readonly string[];   // absent = tous les sports
  exclusions?: readonly ('SUBSCRIPTION' | 'EXTERNAL' | 'TOURNAMENT')[];
  maxUses?: number;             // absent = illimité
  usedCount: number;
  minDurationMin?: number;
  priority: number;             // plus haut = gagne (non-cumul, décision §4-A)
  active: boolean;
}

export function validatePromoDefinition(p: Pick<PromoCode,
  'code' | 'percentOff' | 'startMin' | 'endMin' | 'validFromMs' | 'validUntilMs' | 'weekdays'>): RuleResult {
  if (!/^[A-Z0-9]{3,20}$/.test(p.code)) return fail('NAME_INVALID', 'Un code promo : 3 à 20 caractères, A–Z et chiffres.');
  if (p.percentOff < 5 || p.percentOff > 50) return fail('INVALID_TARGET', 'La remise va de 5 % à 50 %.');
  if (p.startMin < 0 || p.endMin <= p.startMin || p.endMin > 1440) return fail('HOURS_INVALID', 'La bande horaire de la promo est incohérente.');
  if (p.validUntilMs <= p.validFromMs) return fail('HOURS_INVALID', 'La fin de validité doit suivre le début.');
  if (p.weekdays.length === 0) return fail('INVALID_TARGET', 'Choisis au moins un jour.');
  return ok;
}

export function validatePromoLimits(p: Pick<PromoCode, 'maxUses' | 'minDurationMin' | 'priority'>): RuleResult {
  if (p.maxUses != null && p.maxUses < 1) return fail('INVALID_TARGET', 'Le plafond d’utilisations est d’au moins 1.');
  if (p.minDurationMin != null && p.minDurationMin < 30) return fail('INVALID_TARGET', 'La durée minimum est d’au moins 30 minutes.');
  if (p.priority < 0) return fail('INVALID_TARGET', 'La priorité ne peut pas être négative.');
  return ok;
}

/** Une promo s'applique si : active, date dans la validité, bon jour,
    le créneau DÉMARRE dans la bande, et le terrain est couvert. */
export interface PromoContext {
  weekday: number; startMin: number; dayMs: number; fieldId: string;
  sport?: string; durationMin?: number;
  isSubscription?: boolean; source?: 'MOUBARAT' | 'PHONE' | 'WALK_IN' | 'CENTER';
}

export function promoApplies(promo: PromoCode, ctx: PromoContext): boolean {
  if (!promo.active) return false;
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return false;
  if (ctx.dayMs < promo.validFromMs || ctx.dayMs > promo.validUntilMs) return false;
  if (!promo.weekdays.includes(ctx.weekday)) return false;
  if (ctx.startMin < promo.startMin || ctx.startMin >= promo.endMin) return false;
  if (promo.fieldIds && !promo.fieldIds.includes(ctx.fieldId)) return false;
  if (promo.sports && ctx.sport && !promo.sports.includes(ctx.sport)) return false;
  if (promo.minDurationMin != null && (ctx.durationMin ?? 0) < promo.minDurationMin) return false;
  const ex = promo.exclusions ?? [];
  if (ex.includes('SUBSCRIPTION') && ctx.isSubscription) return false;
  if (ex.includes('EXTERNAL') && ctx.source && ctx.source !== 'MOUBARAT') return false;
  return true;
}

/** Concurrence (décision §4-A) : NON-CUMUL. Parmi les promos applicables,
    la priorité la plus haute gagne ; à égalité, la meilleure remise client. */
export function bestPromo(promos: readonly PromoCode[], ctx: PromoContext): PromoCode | null {
  const ok = promos.filter((p) => promoApplies(p, ctx));
  if (ok.length === 0) return null;
  return [...ok].sort((a, b) => b.priority - a.priority || b.percentOff - a.percentOff)[0]!;
}

export function recordPromoUse(promo: PromoCode): PromoCode {
  return { ...promo, usedCount: promo.usedCount + 1 };
}

/** Un seul code par réservation — non cumulable. La remise s'applique au total. */
export function applyPromo(totalDa: number, promo: Pick<PromoCode, 'percentOff' | 'code'>): {
  discountDa: number; newTotalDa: number; line: string;
} {
  const discountDa = Math.round(totalDa * promo.percentOff / 100);
  return {
    discountDa,
    newTotalDa: totalDa - discountDa,
    line: `Code ${promo.code} · −${promo.percentOff} % = −${discountDa} DA`,
  };
}

/* --- Projection d'un abonnement : « chaque dimanche, sur un an, sans erreur » -- */

import { recurringOccurrence, weekdayOfDayStart, DAY_MIN, MIN as MINUTE_MS, type RecurringBooking } from './availability.js';

export function projectRecurring(
  rec: RecurringBooking, fromDayStartMs: number, count: number,
): number[] {
  const out: number[] = [];
  const DAY_MS = DAY_MIN * MINUTE_MS;
  for (let d = 0; d < 400 && out.length < count; d++) {
    const dayStart = fromDayStartMs + d * DAY_MS;
    const weekday = weekdayOfDayStart(dayStart);
    if (recurringOccurrence(rec, weekday, dayStart)) out.push(dayStart);
  }
  return out;
}
