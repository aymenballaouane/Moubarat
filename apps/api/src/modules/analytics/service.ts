import { sql } from 'kysely';
import {
  DAY_MIN, MIN, bookingOriginShare, cashReport, occupancyRate, recurringOccurrence,
  weekdayOfDayStart, type Booking, type CashReport, type OriginShare,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { badRequest } from '../../lib/http.js';
import { algiersDateOf, dayStartMs, operatingPeriodWindow } from '../../lib/algiers.js';
import { fromPgRange, toPgRange } from '../../lib/pgrange.js';
import { rowToBooking } from '../bookings/service.js';
import { rowToRecurringBooking } from '../recurring-bookings/service.js';

const DAY_MS = DAY_MIN * MIN;
/** Sources vendues (hors CENTER, un blocage — 0 DA, jamais du chiffre). */
type Source = 'MOUBARAT' | 'PHONE' | 'WALK_IN';
const SOURCES: readonly Source[] = ['MOUBARAT', 'PHONE', 'WALK_IN'];

export interface Period { fromDay: string; toDay: string; }

/** Parse et valide `from`/`to` (YYYY-MM-DD, Alger) — bornes INCLUSIVES. */
export function parsePeriod(from?: string, to?: string): Period {
  const fromDay = String(from ?? '');
  const toDay = String(to ?? '');
  let fromMs: number, toMs: number;
  try { fromMs = dayStartMs(fromDay); toMs = dayStartMs(toDay); }
  catch { throw badRequest('Paramètres from/to attendus au format YYYY-MM-DD.'); }
  if (toMs < fromMs) throw badRequest('to doit être postérieur ou égal à from.');
  if (toMs - fromMs > 366 * DAY_MS) throw badRequest('La période ne peut pas dépasser 366 jours.');
  return { fromDay, toDay };
}

/** La période immédiatement précédente, de même durée — base des tendances. */
export function previousPeriod(p: Period): Period {
  const from = dayStartMs(p.fromDay);
  const to = dayStartMs(p.toDay);
  const spanDays = Math.round((to - from) / DAY_MS) + 1;
  const prevToMs = from - DAY_MS;
  const prevFromMs = prevToMs - (spanDays - 1) * DAY_MS;
  return { fromDay: algiersDateOf(prevFromMs), toDay: algiersDateOf(prevToMs) };
}

/** `Booking` (core, gelé) n'a pas de motif d'annulation — jamais ajouté là,
    juste porté en plus ICI (couche API) pour que `buildRevenueReport` sache
    exclure une annulation STAFF_ERROR du CA perdu sans toucher `cashReport`
    ni le type core (15/09/2026, prérequis avant le premier centre réel). */
export type BookingWithCancelReason = Booking & { cancelReason: 'STAFF_ERROR' | 'CLIENT' | null };

/** Réservations du centre dont le DÉBUT tombe dans les jours d'exploitation de la période (bornes incluses — voir
    lib/algiers.ts, BUG-9 27/09/2026), éventuellement restreintes à un terrain. Avant : recouvrement des jours civils,
    qui comptait une réservation 23:30 → 01:00 dans le CA de DEUX périodes quand la borne tombait sur cette nuit. */
export async function loadPeriodBookings(
  db: Db, venueId: string, period: Period, fieldId?: string,
): Promise<BookingWithCancelReason[]> {
  const win = operatingPeriodWindow(period.fromDay, period.toDay);
  let q = db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
    .selectAll('bookings')
    .where('fields.venue_id', '=', venueId)
    .where(sql<boolean>`lower(bookings.time_range) >= ${new Date(win.start)} AND lower(bookings.time_range) < ${new Date(win.end)}`);
  if (fieldId) q = q.where('bookings.field_id', '=', fieldId);
  const rows = await q.execute();
  return rows.map((row) => ({ ...rowToBooking(row), cancelReason: row.cancel_reason }));
}

/** Chantier CRM — écran Analytics (06/09/2026) : décompte par statut à côté
    du montant — `cashReport` ne renvoie que des DA, jamais de nombre de
    résas, or le taux de no-show et le panier moyen ont besoin d'un
    dénominateur en NOMBRE de résas, pas en DA. Simple regroupement par
    statut des mêmes réservations déjà chargées — aucune règle recalculée
    (RESERVED n'est compté nulle part : ni honoré/payé/no-show, ni annulé —
    une résa encore en attente n'est ni un succès ni un échec, donc exclue
    de toute base de calcul ici, comme `cashReport` l'exclut déjà de
    « collecté »/« perdu »). */
export interface BookingCounts { honored: number; paid: number; noShow: number; cancelled: number; }

/** Compteur brut — décision confirmée d'Aymen (15/09/2026) : compte TOUTE
    annulation, STAFF_ERROR comprise. C'est une mesure opérationnelle
    (« combien de fois le centre se trompe en saisissant ») distincte du CA
    perdu — jamais d'exclusion implicite ici, seul `cashReport` (plus bas,
    via `excludeStaffErrorCancellations`) exclut STAFF_ERROR. */
function bookingCounts(bookings: readonly Booking[]): BookingCounts {
  const c: BookingCounts = { honored: 0, paid: 0, noShow: 0, cancelled: 0 };
  for (const b of bookings) {
    if (b.source === 'CENTER') continue; // un blocage centre n'est pas une résa
    if (b.status === 'HONORED') c.honored++;
    else if (b.status === 'PAID') c.paid++;
    else if (b.status === 'NO_SHOW') c.noShow++;
    else if (b.status === 'CANCELLED') c.cancelled++;
  }
  return c;
}

/** Exclusion du CA perdu (15/09/2026, prérequis avant le premier centre
    réel, confirmé par Aymen) : une annulation STAFF_ERROR (erreur de saisie
    du centre) ne doit jamais compter comme du chiffre perdu — jamais dans
    `cashReport` (core, gelé, intouché) lui-même : on retire ces lignes du
    tableau AVANT de le lui passer, à chaque appel. `bookingCounts`, lui,
    n'est PAS filtré ici (décision explicite ci-dessus). */
function excludeStaffErrorCancellations(bookings: readonly BookingWithCancelReason[]): Booking[] {
  return bookings.filter((b) => !(b.status === 'CANCELLED' && b.cancelReason === 'STAFF_ERROR'));
}

export interface RevenueReport {
  overall: CashReport;
  bySource: Record<Source, CashReport>;
  byField: Record<string, CashReport>;
  counts: { overall: BookingCounts; bySource: Record<Source, BookingCounts>; byField: Record<string, BookingCounts> };
}

/** `cashReport` (core, crm.ts) est LE canonique pour un tableau financier
    centre — exclut déjà les blocages CENTER. Les répartitions source/terrain
    sont de simples regroupements des mêmes réservations avant le même appel,
    jamais un recalcul maison de ce que « collecté »/« engagé »/« perdu » veut dire. */
export function buildRevenueReport(bookings: readonly BookingWithCancelReason[]): RevenueReport {
  const bySource = Object.fromEntries(
    SOURCES.map((s) => [s, cashReport(excludeStaffErrorCancellations(bookings.filter((b) => b.source === s)))]),
  ) as Record<Source, CashReport>;
  const fieldIds = [...new Set(bookings.map((b) => b.fieldId))];
  const byField = Object.fromEntries(
    fieldIds.map((f) => [f, cashReport(excludeStaffErrorCancellations(bookings.filter((b) => b.fieldId === f)))]),
  );
  const countsBySource = Object.fromEntries(
    SOURCES.map((s) => [s, bookingCounts(bookings.filter((b) => b.source === s))]),
  ) as Record<Source, BookingCounts>;
  const countsByField = Object.fromEntries(
    fieldIds.map((f) => [f, bookingCounts(bookings.filter((b) => b.fieldId === f))]),
  );
  return {
    overall: cashReport(excludeStaffErrorCancellations(bookings)), bySource, byField,
    counts: { overall: bookingCounts(bookings), bySource: countsBySource, byField: countsByField },
  };
}

export interface OccupancyReport { overall: number; byField: Record<string, number>; openMinutesPerField: number; }

/** Minutes d'ouverture cumulées sur la période — `opening_hours` est par
    JOUR DE SEMAINE (pas par date), donc on énumère chaque jour de la période
    et on additionne son quota. Identique pour tous les terrains du centre
    (une seule table `opening_hours`, pas de variante par terrain). */
export async function openMinutesForPeriod(db: Db, venueId: string, period: Period): Promise<number> {
  const hours = await db.selectFrom('opening_hours').selectAll().where('venue_id', '=', venueId).execute();
  const byWeekday = new Map(hours.map((h) => [h.weekday, h.end_min - h.start_min]));
  const from = dayStartMs(period.fromDay);
  const to = dayStartMs(period.toDay);
  let total = 0;
  for (let d = from; d <= to; d += DAY_MS) total += byWeekday.get(weekdayOfDayStart(d)) ?? 0;
  return total;
}

/** Chantier CRM Abonnements (06/09/2026) : un abonné occupe réellement le
    terrain — l'ignorer sous-estimerait le remplissage, précisément pour les
    centres qui ont le plus de succès (décision d'Aymen). On synthétise ICI,
    côté appelant, des entrées à la forme déjà attendue par occupancyRate/
    occupancyByField (status/source/range) — jamais en touchant ces deux
    fonctions ni leur signature. `status:'RESERVED'`/`source:'WALK_IN'` sont
    des valeurs de forme, jamais exposées : une occurrence d'abonnement n'a
    ni statut de paiement réel ni origine de vente (V1.5), et n'entre JAMAIS
    dans buildRevenueReport/buildOriginReport (seul `bookings`, jamais ce
    tableau synthétique, y alimente ces deux-là). */
async function subscriptionOccupancyBookings(
  db: Db, venueId: string, period: Period, activeFieldIds: readonly string[],
): Promise<Pick<Booking, 'fieldId' | 'status' | 'source' | 'range'>[]> {
  if (activeFieldIds.length === 0) return [];
  const recurringRows = await db.selectFrom('recurring_bookings')
    .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
    .select([
      'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday',
      'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'recurring_bookings.holder_name',
      'recurring_bookings.active_from', 'recurring_bookings.active_until', 'recurring_bookings.status',
    ])
    .where('fields.venue_id', '=', venueId)
    .where('recurring_bookings.status', '=', 'ACTIVE')
    .where('recurring_bookings.field_id', 'in', activeFieldIds)
    .execute();
  if (recurringRows.length === 0) return [];
  const recs = recurringRows.map(rowToRecurringBooking);

  const from = dayStartMs(period.fromDay);
  const to = dayStartMs(period.toDay);
  const out: Pick<Booking, 'fieldId' | 'status' | 'source' | 'range'>[] = [];
  for (let d = from; d <= to; d += DAY_MS) {
    const weekday = weekdayOfDayStart(d);
    for (const rec of recs) {
      const occ = recurringOccurrence(rec, weekday, d);
      if (occ) out.push({ fieldId: rec.fieldId, status: 'RESERVED', source: 'WALK_IN', range: occ });
    }
  }
  return out;
}

/** Chantier fermetures exceptionnelles (§5.6, demande d'Aymen 15/09/2026,
    exigence n°4) : les heures fermées sortent du dénominateur d'occupation —
    un jour férié ne doit jamais faire chuter le taux (le centre n'était pas
    ouvert à réserver, ce n'est pas de l'inoccupation). Calculé PAR TERRAIN,
    jamais un seul nombre partagé (une fermeture peut ne viser qu'un seul
    terrain) : même principe que `subscriptionOccupancyBookings` juste au-
    dessus — on synthétise le correctif côté appelant, jamais en touchant
    `occupancyRate`/`occupancyByField` (core, gelé). Même convention
    « journée d'exploitation » que `openMinutesForPeriod` et la création
    d'une fermeture (`closures/service.ts`, exigence n°2) : chaque jour de la
    période reçoit les horaires RÉELS de son jour de semaine (queue après
    minuit comprise), et seule la portion de la fermeture qui recoupe CETTE
    fenêtre d'ouverture est retirée — jamais 00:00→24:00 calendaire. */
async function closurePenaltyMinutesByField(
  db: Db, venueId: string, period: Period, fieldIds: readonly string[],
): Promise<Record<string, number>> {
  const penalty: Record<string, number> = {};
  for (const f of fieldIds) penalty[f] = 0;
  if (fieldIds.length === 0) return penalty;

  const from = dayStartMs(period.fromDay);
  const to = dayStartMs(period.toDay);
  const windowRange = toPgRange({ start: from, end: to + DAY_MS });
  const [hoursRows, closureRows] = await Promise.all([
    db.selectFrom('opening_hours').selectAll().where('venue_id', '=', venueId).execute(),
    db.selectFrom('closures').selectAll().where('venue_id', '=', venueId)
      .where(sql<boolean>`during && ${windowRange}::tstzrange`).execute(),
  ]);
  const hoursByWeekday = new Map<number, { start: number; end: number }[]>();
  for (const h of hoursRows) {
    const arr = hoursByWeekday.get(h.weekday) ?? [];
    arr.push({ start: h.start_min, end: h.end_min });
    hoursByWeekday.set(h.weekday, arr);
  }
  const closures = closureRows.map((c) => ({ fieldId: c.field_id, range: fromPgRange(c.during) }));
  if (closures.length === 0) return penalty; // pas de fermeture sur la période : rien à recalculer

  for (let d = from; d <= to; d += DAY_MS) {
    const dayHours = hoursByWeekday.get(weekdayOfDayStart(d)) ?? [];
    for (const oh of dayHours) {
      const opRange = { start: d + oh.start * MIN, end: d + oh.end * MIN };
      for (const c of closures) {
        if (c.fieldId !== null && !fieldIds.includes(c.fieldId)) continue;
        const overlapStart = Math.max(opRange.start, c.range.start);
        const overlapEnd = Math.min(opRange.end, c.range.end);
        if (overlapEnd <= overlapStart) continue;
        const minutes = (overlapEnd - overlapStart) / MIN;
        for (const f of (c.fieldId !== null ? [c.fieldId] : fieldIds)) penalty[f] = (penalty[f] ?? 0) + minutes;
      }
    }
  }
  return penalty;
}

export async function buildOccupancyReport(
  db: Db, venueId: string, period: Period, bookings: readonly Booking[],
): Promise<OccupancyReport> {
  const openMinutesPerField = await openMinutesForPeriod(db, venueId, period);
  const fieldRows = await db.selectFrom('fields').select('id')
    .where('venue_id', '=', venueId)
    .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'ARCHIVED')]))
    .execute();
  const fieldIds = fieldRows.map((f) => f.id);
  // `bookings` peut inclure l'historique d'un terrain désormais ARCHIVED (la
  // requête d'appel ne filtre pas par terrain actif) — sans ce filtre, ces
  // minutes gonfleraient le numérateur de `overall` alors que son terrain est
  // déjà exclu du dénominateur (fieldCount) ET de `byField` (occupancyByField
  // n'itère que fieldIds) : `overall` ne se reconstituerait plus depuis
  // `byField`. Trouvé en revue.
  const activeFieldIds = new Set(fieldIds);
  const activeBookings = bookings.filter((b) => activeFieldIds.has(b.fieldId));
  const subscriptionBookings = await subscriptionOccupancyBookings(db, venueId, period, fieldIds);
  const occupancyBookings = [...activeBookings, ...subscriptionBookings];

  const penalty = await closurePenaltyMinutesByField(db, venueId, period, fieldIds);
  const byField: Record<string, number> = {};
  for (const f of fieldIds) {
    byField[f] = occupancyRate({
      openMinutesPerField: Math.max(0, openMinutesPerField - (penalty[f] ?? 0)), fieldCount: 1,
      bookings: occupancyBookings.filter((b) => b.fieldId === f),
    });
  }
  // `overall` recalculé à la main (jamais via occupancyRate(fieldCount:N)) dès
  // qu'une fermeture existe : ses terrains peuvent avoir des dénominateurs
  // différents (une fermeture par terrain, pas forcément tout le centre) —
  // même filtre que le core (occupancyRate), juste sommé ici sur des minutes
  // d'ouverture qui ne sont plus uniformes.
  const totalOpen = fieldIds.reduce((s, f) => s + Math.max(0, openMinutesPerField - (penalty[f] ?? 0)), 0);
  const totalBooked = occupancyBookings
    .filter((b) => b.source !== 'CENTER' && (b.status === 'RESERVED' || b.status === 'HONORED' || b.status === 'PAID'))
    .reduce((s, b) => s + (b.range.end - b.range.start) / 60_000, 0);
  return {
    overall: totalOpen <= 0 ? 0 : Math.min(1, totalBooked / totalOpen),
    byField,
    // Chantier CRM — écran Analytics (06/09/2026) : déjà calculé ci-dessus,
    // juste jamais renvoyé — nécessaire pour un revenu PAR HEURE D'OUVERTURE
    // (rentabilité de la capacité), volontairement PAS par heure réellement
    // réservée (qui ne serait qu'un tarif moyen déguisé) — décision d'Aymen.
    // Reste le total AVANT déduction des fermetures : c'est l'ouverture
    // contractuelle du centre, le revenu/heure d'ouverture n'a pas à baisser
    // artificiellement un jour férié plus qu'un jour normal creux.
    openMinutesPerField,
  };
}

export function buildOriginReport(bookings: readonly Booking[]): OriginShare {
  return bookingOriginShare(bookings);
}
