import { sql } from 'kysely';
import { recurringOccurrence, weekdayOfDayStart, type RecurringBooking } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { algiersDateOf, dayStartMs } from '../../lib/algiers.js';

/* ==========================================================================
   Occupation d'un terrain par les abonnements — par INSTANTS ABSOLUS (audit final, MS-002, 12/11/2026).

   Le core projette un abonnement sur UN jour civil (`recurringOccurrence(rec, weekday, dayStart)`) et le moteur
   de réservation ne compare que les abonnements du jour demandé. Or un centre ouvert après minuit exprime le même
   instant de deux façons (« J, 24:00 » et « J+1, 00:00 ») : un abonnement du lendemain 00:00 ne bloquait pas une
   réservation « J, startMin 1440 », ni un abonnement 23:00 × 2 h une réservation du lendemain 00:30. Ce module,
   hors core (gelé), complète la projection sans recoder la règle : il appelle `recurringOccurrence` lui-même, sur
   la veille et le lendemain, et compare des intervalles absolus.

   Le verrou `lockFieldSchedule` sérialise, terrain par terrain, tout ce qui pose une occupation qui ne passe pas
   par la contrainte d'exclusion de la base (abonnements) ou qui doit se mesurer à eux (réservation, déplacement) :
   contrôle et écriture dans la même transaction, sous ce verrou.
   ========================================================================== */

const MIN = 60_000;

/** Verrou transactionnel par terrain, partagé par la création d'abonnement, la création et le déplacement de
    réservation. Relâché à la fin de la transaction appelante — à n'appeler que dans une transaction. */
export async function lockFieldSchedule(trx: Db, fieldId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`field-schedule:${fieldId}`}))`.execute(trx);
}

/** Minuit d'Alger du jour civil voisin (`delta` = -1 la veille, +1 le lendemain). */
function neighbourDayStart(dayStart: number, delta: number): number {
  return dayStartMs(algiersDateOf(dayStart + delta * 86_400_000 + 12 * 3_600_000));
}

/** Les abonnements à passer au core pour le jour `dayStart` : ceux du jour (inchangés) PLUS, pour chaque
    occurrence de la veille ou du lendemain, un double exprimé sur ce jour (`startMin` négatif ou au-delà de 1440),
    valable ce jour-là seulement. Le core les projette comme les autres ; aucune règle n'est recodée. */
export function recurringForDay(recurring: readonly RecurringBooking[], dayStart: number): RecurringBooking[] {
  const weekday = weekdayOfDayStart(dayStart);
  const out: RecurringBooking[] = [...recurring];
  for (const delta of [-1, 1]) {
    const other = neighbourDayStart(dayStart, delta);
    const otherWeekday = weekdayOfDayStart(other);
    for (const rec of recurring) {
      const occ = recurringOccurrence(rec, otherWeekday, other);
      if (!occ) continue;
      out.push({
        id: rec.id, fieldId: rec.fieldId, holderName: rec.holderName, status: 'ACTIVE',
        weekday, startMin: Math.round((occ.start - dayStart) / MIN), durationMin: rec.durationMin,
        activeFrom: occ.start, activeUntil: dayStart,
      });
    }
  }
  return out;
}

/** Le premier abonnement dont une occurrence chevauche `range` (intervalles absolus, bornes exclusives), en
    examinant chaque jour civil de la veille du début au jour de la fin. */
export function recurringClash(
  recurring: readonly RecurringBooking[], range: { start: number; end: number },
): RecurringBooking | undefined {
  const first = neighbourDayStart(dayStartMs(algiersDateOf(range.start)), -1);
  const last = dayStartMs(algiersDateOf(range.end - 1));
  for (let d = first; d <= last; d = neighbourDayStart(d, 1)) {
    const weekday = weekdayOfDayStart(d);
    for (const rec of recurring) {
      const occ = recurringOccurrence(rec, weekday, d);
      if (occ && occ.start < range.end && range.start < occ.end) return rec;
    }
  }
  return undefined;
}

/** Les abonnements ACTIFS d'un terrain, au format du core — à lire sous `lockFieldSchedule`. */
export async function loadActiveRecurring(db: Db, fieldId: string): Promise<RecurringBooking[]> {
  const rows = await db.selectFrom('recurring_bookings').selectAll()
    .where('field_id', '=', fieldId).where('status', '=', 'ACTIVE').execute();
  return rows.map((r) => ({
    id: r.id, fieldId: r.field_id, weekday: r.weekday, startMin: r.start_min,
    durationMin: r.duration_min, holderName: r.holder_name,
    activeFrom: r.active_from.getTime(), status: r.status,
    ...(r.active_until !== null ? { activeUntil: r.active_until.getTime() } : {}),
  }));
}

/** Deux motifs hebdomadaires se recouvrent-ils, minuit et fin de semaine compris ? (minutes de la semaine,
    modulo 7 × 1 440). Les périodes d'activité ne sont pas comparées : même règle prudente qu'avant ce correctif. */
export function weeklyOverlap(
  a: { weekday: number; startMin: number; durationMin: number },
  b: { weekday: number; startMin: number; durationMin: number },
): boolean {
  const WEEK = 7 * 1440;
  const aStart = a.weekday * 1440 + a.startMin;
  const bStart = b.weekday * 1440 + b.startMin;
  return [-WEEK, 0, WEEK].some((shift) => aStart < bStart + shift + b.durationMin && bStart + shift < aStart + a.durationMin);
}
