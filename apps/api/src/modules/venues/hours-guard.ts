import { sql } from 'kysely';
import { weekdayOfDayStart } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { algiersDateOf, dayStartMs, hhmm } from '../../lib/algiers.js';
import { fromPgRange } from '../../lib/pgrange.js';

/* Audit final, MS-015 (12/11/2026) — réduire les horaires d'un jour ou le fermer ne regardait pas les engagements : des
   réservations à venir se retrouvaient hors horaires (masquées du Planning d'un jour fermé), un client se présentait un jour
   « fermé ». Même patron que l'archivage d'un terrain (archive-guard.ts) : refus avec la liste.

   On ne refuse QUE ce que CE changement casse : un engagement qui tenait dans les horaires d'avant et n'y tient plus après.
   Un engagement déjà hors horaires avant (données anciennes) ne bloque pas un changement sans rapport. Une réservation après
   minuit se mesure aussi aux horaires de la veille (centre ouvert jusqu'à 01:00, endMin 1500). */

export interface HoursRange { weekday: number; startMin: number; endMin: number }
export interface HoursConflict { kind: 'BOOKING' | 'SUBSCRIPTION'; label: string }

const MIN = 60_000;
const DAY = 86_400_000;
const SHOWN = 20;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Une plage absolue tient-elle dans les horaires, rattachée à son jour civil ou à la veille ? */
function bookingFits(hours: readonly HoursRange[], range: { start: number; end: number }): boolean {
  const civil = dayStartMs(algiersDateOf(range.start));
  const previous = dayStartMs(algiersDateOf(civil - DAY + 12 * 3_600_000));
  return [civil, previous].some((d) => {
    const wd = weekdayOfDayStart(d);
    return hours.some((h) => h.weekday === wd && range.start >= d + h.startMin * MIN && range.end <= d + h.endMin * MIN);
  });
}

/** Un motif hebdomadaire tient-il dans les horaires de son jour, ou dans la soirée de la veille (après minuit) ? */
function subscriptionFits(hours: readonly HoursRange[], s: { weekday: number; startMin: number; durationMin: number }): boolean {
  const end = s.startMin + s.durationMin;
  if (hours.some((h) => h.weekday === s.weekday && s.startMin >= h.startMin && end <= h.endMin)) return true;
  const prev = (s.weekday + 6) % 7;
  return hours.some((h) => h.weekday === prev && s.startMin + 1440 >= h.startMin && end + 1440 <= h.endMin);
}

/** Engagements à venir du centre que le passage de `before` à `after` mettrait hors horaires. */
export async function findHoursConflicts(
  db: Db, venueId: string, before: readonly HoursRange[], after: readonly HoursRange[], now: number,
): Promise<{ conflicts: HoursConflict[]; bookings: number; subscriptions: number }> {
  const [bookingRows, recurringRows] = await Promise.all([
    db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
      .select(['bookings.reference', 'bookings.reservation_name', 'bookings.time_range', 'fields.name as field_name'])
      .where('fields.venue_id', '=', venueId)
      .where('bookings.status', 'in', ['RESERVED', 'HONORED', 'PAID'])
      .where(sql<boolean>`upper(bookings.time_range) > ${new Date(now)}`)
      .orderBy(sql`lower(bookings.time_range)`)
      .execute(),
    db.selectFrom('recurring_bookings').innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
      .select(['recurring_bookings.holder_name', 'recurring_bookings.weekday', 'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'fields.name as field_name'])
      .where('fields.venue_id', '=', venueId).where('recurring_bookings.status', '=', 'ACTIVE')
      .where((eb) => eb.or([eb('recurring_bookings.active_until', 'is', null), eb('recurring_bookings.active_until', '>=', new Date(now))]))
      .execute(),
  ]);
  const bookings = bookingRows.filter((r) => {
    const range = fromPgRange(r.time_range);
    return bookingFits(before, range) && !bookingFits(after, range);
  });
  const subscriptions = recurringRows.filter((r) => {
    const s = { weekday: r.weekday, startMin: r.start_min, durationMin: r.duration_min };
    return subscriptionFits(before, s) && !subscriptionFits(after, s);
  });
  const conflicts: HoursConflict[] = [
    ...bookings.map((r) => {
      const start = fromPgRange(r.time_range).start;
      const date = algiersDateOf(start);
      return {
        kind: 'BOOKING' as const,
        label: `${r.reference ?? 'Résa'} · ${r.reservation_name ?? '—'} · ${r.field_name} — ${date.slice(8, 10)}/${date.slice(5, 7)} ${hhmm(Math.round((start - dayStartMs(date)) / MIN))}`,
      };
    }),
    ...subscriptions.map((r) => ({
      kind: 'SUBSCRIPTION' as const,
      label: `${r.holder_name} · ${r.field_name} · chaque ${WEEKDAYS[r.weekday]} ${hhmm(r.start_min)}`,
    })),
  ];
  return { conflicts: conflicts.slice(0, SHOWN), bookings: bookings.length, subscriptions: subscriptions.length };
}

/** « 2 réservations à venir et 1 abonnement actif tomberaient hors horaires — … » (pluriels accordés). */
export function hoursRefusalMessage(c: { bookings: number; subscriptions: number }, closing: boolean): string {
  const parts: string[] = [];
  if (c.bookings > 0) parts.push(`${c.bookings} réservation${c.bookings > 1 ? 's' : ''} à venir`);
  if (c.subscriptions > 0) parts.push(`${c.subscriptions} abonnement${c.subscriptions > 1 ? 's' : ''} actif${c.subscriptions > 1 ? 's' : ''}`);
  const n = c.bookings + c.subscriptions;
  return `${parts.join(' et ')} ${n > 1 ? 'tomberaient' : 'tomberait'} hors horaires — à déplacer ou annuler avant de ${closing ? 'fermer ce jour' : 'réduire ces horaires'}.`;
}

/** Toutes les plages horaires du centre, au format du garde. */
export async function loadVenueHours(db: Db, venueId: string): Promise<HoursRange[]> {
  const rows = await db.selectFrom('opening_hours').select(['weekday', 'start_min', 'end_min']).where('venue_id', '=', venueId).execute();
  return rows.map((r) => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min }));
}
