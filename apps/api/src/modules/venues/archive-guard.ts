import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { algiersDateOf, dayStartMs, hhmm } from '../../lib/algiers.js';

/* Archivage d'un terrain (22/09/2026, audit produit CE9) : avant ce garde, un terrain archivé disparaissait du
   planning et de l'app alors que ses réservations à venir restaient RESERVED — des clients se présentaient
   sur un terrain « disparu ». Un terrain n'est archivable que s'il n'a plus d'engagement à honorer :
   - réservation vivante (RESERVED / HONORED / PAID — les statuts qui bloquent le créneau) dont la FIN est
     dans le futur (une réservation en cours compte : le terrain n'est pas libre) ;
   - abonnement ACTIF (créneau hebdomadaire) sans date de fin dépassée.
   MAINTENANCE n'est pas concerné : il bloque déjà les nouvelles réservations sans toucher aux existantes.
   Limite assumée : une réservation créée dans la milliseconde qui sépare ce contrôle de l'écriture du statut
   n'est pas vue (la vente refuse ensuite tout nouveau créneau sur un terrain archivé). */

export interface FieldCommitment { kind: 'BOOKING' | 'SUBSCRIPTION'; label: string }
export interface FieldCommitments {
  /** Au plus `SHOWN` lignes, les plus proches d'abord — le compte exact est dans `bookings` / `subscriptions`. */
  conflicts: FieldCommitment[];
  bookings: number;
  subscriptions: number;
}

const SHOWN = 20;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « 24/09 20:00 » — jour et heure d'Alger. */
function whenLabel(startMs: number): string {
  const date = algiersDateOf(startMs);
  return `${date.slice(8, 10)}/${date.slice(5, 7)} ${hhmm(Math.round((startMs - dayStartMs(date)) / 60_000))}`;
}

export async function findFieldCommitments(db: Db, fieldId: string, now: number): Promise<FieldCommitments> {
  const nowDate = new Date(now);
  const [bookingRows, recurringRows] = await Promise.all([
    db.selectFrom('bookings')
      .select(['reference', 'reservation_name', sql<Date>`lower(time_range)`.as('starts_at')])
      .where('field_id', '=', fieldId)
      .where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
      .where(sql<boolean>`upper(time_range) > ${nowDate}`)
      .orderBy(sql`lower(time_range)`)
      .execute(),
    db.selectFrom('recurring_bookings')
      .select(['holder_name', 'weekday', 'start_min'])
      .where('field_id', '=', fieldId).where('status', '=', 'ACTIVE')
      .where((eb) => eb.or([eb('active_until', 'is', null), eb('active_until', '>=', nowDate)]))
      .execute(),
  ]);

  const all: FieldCommitment[] = [
    ...bookingRows.map((r) => ({
      kind: 'BOOKING' as const,
      label: `${r.reference ?? 'Résa'} · ${r.reservation_name ?? '—'} — ${whenLabel(new Date(r.starts_at).getTime())}`,
    })),
    ...recurringRows.map((r) => ({
      kind: 'SUBSCRIPTION' as const,
      label: `${r.holder_name} · chaque ${WEEKDAYS[r.weekday]} ${hhmm(r.start_min)}`,
    })),
  ];
  return { conflicts: all.slice(0, SHOWN), bookings: bookingRows.length, subscriptions: recurringRows.length };
}

/** Message de refus, pluriels accordés (jamais « (s) »). */
export function archiveRefusalMessage(c: Pick<FieldCommitments, 'bookings' | 'subscriptions'>): string {
  const parts: string[] = [];
  if (c.bookings > 0) parts.push(`${c.bookings} réservation${c.bookings > 1 ? 's' : ''} à venir`);
  if (c.subscriptions > 0) parts.push(`${c.subscriptions} abonnement${c.subscriptions > 1 ? 's' : ''} actif${c.subscriptions > 1 ? 's' : ''}`);
  return `Ce terrain a ${parts.join(' et ')} — à déplacer ou annuler avant de l’archiver.`;
}

/** Audit final, MS-016 (12/11/2026) : réservations vivantes à venir d'un terrain qui PORTENT l'un des formats donnés. Retirer
    un format (ou changer le sport, qui retire tous les formats de l'ancien sport) les laissait avec un format que le terrain
    ne propose plus : tout déplacement était ensuite refusé (FORMAT_NOT_AVAILABLE). Les réservations historiques sans format
    (`format` NULL) ne sont pas concernées : leur format se déduit du terrain au déplacement. */
export async function findFormatBookings(
  db: Db, fieldId: string, formats: readonly string[], now: number,
): Promise<{ count: number; conflicts: FieldCommitment[] }> {
  if (formats.length === 0) return { count: 0, conflicts: [] };
  const rows = await db.selectFrom('bookings')
    .select(['reference', 'reservation_name', 'format', sql<Date>`lower(time_range)`.as('starts_at')])
    .where('field_id', '=', fieldId)
    .where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
    .where(sql<boolean>`upper(time_range) > ${new Date(now)}`)
    .where(sql<boolean>`format::text IN (${sql.join([...formats])})`)
    .orderBy(sql`lower(time_range)`)
    .execute();
  return {
    count: rows.length,
    conflicts: rows.slice(0, SHOWN).map((r) => ({
      kind: 'BOOKING' as const,
      label: `${r.reference ?? 'Résa'} · ${r.reservation_name ?? '—'} · ${r.format} — ${whenLabel(new Date(r.starts_at).getTime())}`,
    })),
  };
}

/** « 2 réservations à venir portent ce format — … » (pluriels accordés). */
export function formatRefusalMessage(count: number, what: 'format' | 'sport'): string {
  const head = `${count} réservation${count > 1 ? 's' : ''} à venir ${count > 1 ? 'portent' : 'porte'}`;
  return what === 'format'
    ? `${head} ce format — à déplacer ou annuler avant de le retirer.`
    : `${head} un format de l’ancien sport — à déplacer ou annuler avant de changer le sport du terrain.`;
}
