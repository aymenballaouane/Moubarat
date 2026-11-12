import { sql } from 'kysely';
import {
  MIN, validateClosure, weekdayOfDayStart,
  type ClosureReason, type RecurringBooking,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';
import { dayStartMs } from '../../lib/algiers.js';
import { fromPgRange, toPgRange } from '../../lib/pgrange.js';
import { recurringClash } from '../recurring-bookings/occupancy.js';

/* Audit général (07-09/09/2026), §5.6 : la table `closures` (schéma gelé) et
   sa lecture par le moteur de disponibilité (bookings/service.ts,
   closureRangesFor) existaient déjà, jamais câblées en écriture — « saisie
   disponible en V1.5 » (docs/PASSATION.md). Chantier demandé par Aymen le
   14-15/09/2026, avec cinq exigences précises (voir chaque fonction). */

export interface ClosurePublic {
  id: string; venueId: string; fieldId: string | null; fieldName: string | null;
  startMs: number; endMs: number; reason: ClosureReason; label: string | null;
}

interface ClosureRow {
  id: string; venue_id: string; field_id: string | null; during: string;
  reason: ClosureReason; label: string | null; field_name?: string | null;
}

function publicClosure(row: ClosureRow): ClosurePublic {
  const range = fromPgRange(row.during);
  return {
    id: row.id, venueId: row.venue_id, fieldId: row.field_id,
    fieldName: row.field_name ?? null,
    startMs: range.start, endMs: range.end,
    reason: row.reason, label: row.label,
  };
}

/** Liste des fermetures d'un centre, les plus proches d'abord — passées
    incluses (le Journal/l'historique du centre en a besoin), pas seulement
    à venir. */
export async function listClosures(db: Db, venueId: string): Promise<ClosurePublic[]> {
  const rows = await db.selectFrom('closures')
    .leftJoin('fields', 'fields.id', 'closures.field_id')
    .select([
      'closures.id', 'closures.venue_id', 'closures.field_id', 'closures.during',
      'closures.reason', 'closures.label', 'fields.name as field_name',
    ])
    .where('closures.venue_id', '=', venueId)
    .orderBy(sql`lower(closures.during)`, 'desc')
    .execute();
  return rows.map(publicClosure);
}

export interface CreateClosureInput {
  venueId: string;
  /** null = tout le centre. */
  fieldId: string | null;
  reason: ClosureReason;
  label?: string;
  date: string;
  /** Exigence n°2 (Aymen) : « journée d'exploitation, pas journée calendaire »
      — une fermeture « toute la journée » couvre les horaires RÉELS de ce
      jour de semaine, queue après minuit comprise (ouvert 08:00→01:00,
      fermé le 1er nov. = bloqué jusqu'à 01:00 le 2). Calculé ici depuis
      `opening_hours`, jamais en supposant 00:00→24:00. */
  wholeDay: boolean;
  /** Ignorés si `wholeDay` — sinon minutes depuis minuit local (le second
      peut dépasser 1440, même convention que `opening_hours.end_min`). */
  startMin?: number;
  endMin?: number;
}

export interface ClosureConflict {
  kind: 'BOOKING' | 'SUBSCRIPTION';
  fieldId: string; fieldName: string;
  label: string; // référence + nom, ou nom du titulaire d'abonnement
}

/** Exigence n°3 (Aymen) : refuser la création si la plage contient déjà des
    réservations RESERVED/HONORED/PAID ou une occurrence d'abonnement actif
    sur les terrains concernés — jamais annuler/déplacer en silence, on
    renvoie la liste pour que le gérant tranche d'abord. Réutilise
    `recurringOccurrence` (core, gelé) via `recurringClash` plutôt que réimplémenter le
    chevauchement occurrence × plage. */
async function findConflicts(
  db: Db, fieldIds: readonly string[], range: { start: number; end: number },
): Promise<ClosureConflict[]> {
  if (fieldIds.length === 0) return [];
  const windowRange = toPgRange(range);
  const [bookingRows, recurringRows] = await Promise.all([
    db.selectFrom('bookings')
      .innerJoin('fields', 'fields.id', 'bookings.field_id')
      .select(['bookings.reference', 'bookings.reservation_name', 'fields.id as field_id', 'fields.name as field_name'])
      .where('bookings.field_id', 'in', fieldIds)
      .where('bookings.status', 'in', ['RESERVED', 'HONORED', 'PAID'])
      .where(sql<boolean>`bookings.time_range && ${windowRange}::tstzrange`)
      .execute(),
    db.selectFrom('recurring_bookings')
      .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
      .select([
        'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday',
        'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'recurring_bookings.holder_name',
        'recurring_bookings.active_from', 'recurring_bookings.active_until',
        'fields.name as field_name',
      ])
      .where('recurring_bookings.field_id', 'in', fieldIds)
      .where('recurring_bookings.status', '=', 'ACTIVE')
      .execute(),
  ]);

  const conflicts: ClosureConflict[] = bookingRows.map((r) => ({
    kind: 'BOOKING' as const, fieldId: r.field_id, fieldName: r.field_name,
    label: `${r.reference ?? 'résa'} · ${r.reservation_name ?? '—'}`,
  }));

  for (const r of recurringRows) {
    const rec: RecurringBooking = {
      id: r.id, fieldId: r.field_id, weekday: r.weekday, startMin: r.start_min,
      durationMin: r.duration_min, holderName: r.holder_name, activeFrom: r.active_from.getTime(),
      status: 'ACTIVE',
      ...(r.active_until !== null ? { activeUntil: r.active_until.getTime() } : {}),
    };
    // MS-002 (audit final, 12/11/2026) : occurrences comparées par instants absolus, veille et lendemain compris
    // (une fermeture 23:00 → 01:00 recouvre l'abonnement du lendemain 00:30) ; bornes d'activité appliquées par le core.
    if (recurringClash([rec], range)) {
      conflicts.push({ kind: 'SUBSCRIPTION', fieldId: r.field_id, fieldName: r.field_name, label: r.holder_name });
    }
  }
  return conflicts;
}

export async function createClosure(db: Db, p: CreateClosureInput): Promise<ClosurePublic> {
  if (p.fieldId !== null) {
    const field = await db.selectFrom('fields').select(['id', 'venue_id']).where('id', '=', p.fieldId).executeTakeFirst();
    if (!field || field.venue_id !== p.venueId) throw notFound('Terrain introuvable pour ce centre.');
  }
  let dayStart: number;
  try { dayStart = dayStartMs(p.date); }
  catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }
  const weekday = weekdayOfDayStart(dayStart);

  let startMin: number; let endMin: number;
  if (p.wholeDay) {
    const dayHours = await db.selectFrom('opening_hours').select(['start_min', 'end_min'])
      .where('venue_id', '=', p.venueId).where('weekday', '=', weekday).execute();
    if (dayHours.length === 0) throw badRequest('Ce jour n’a pas d’horaires définis — rien à fermer.', 'HOURS_INVALID');
    // Bord à bord (le plus tôt au plus tard) : une journée à deux plages
    // (matin + soir) est fermée entièrement, jamais seulement la première —
    // même principe que « fermer tout le centre » couvre tous ses terrains.
    startMin = Math.min(...dayHours.map((h) => h.start_min));
    endMin = Math.max(...dayHours.map((h) => h.end_min));
  } else {
    startMin = Number(p.startMin);
    endMin = Number(p.endMin);
    if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
      throw badRequest('startMin doit être entre 0 et 1439.', 'HOURS_INVALID');
    }
    if (!Number.isInteger(endMin) || endMin <= startMin || endMin > 2880) {
      throw badRequest('La fin de la fermeture doit suivre son début.', 'HOURS_INVALID');
    }
  }
  const range = { start: dayStart + startMin * MIN, end: dayStart + endMin * MIN };
  const validation = validateClosure({ range });
  if (!validation.ok) throw new ApiError(400, validation.code, validation.message);

  const fieldIds = p.fieldId !== null ? [p.fieldId]
    : (await db.selectFrom('fields').select('id').where('venue_id', '=', p.venueId)
        .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'ARCHIVED')])).execute()).map((f) => f.id);
  const conflicts = await findConflicts(db, fieldIds, range);
  if (conflicts.length > 0) {
    throw new ApiError(409, 'SLOT_TAKEN',
      `${conflicts.length} réservation(s) ou abonnement(s) occupent déjà ce créneau — à déplacer ou annuler avant de fermer.`,
      { conflicts });
  }

  const row = await db.insertInto('closures').values({
    venue_id: p.venueId, field_id: p.fieldId, during: toPgRange(range),
    reason: p.reason, label: p.label?.trim() || null,
  }).returningAll().executeTakeFirstOrThrow();
  const fieldName = p.fieldId !== null
    ? (await db.selectFrom('fields').select('name').where('id', '=', p.fieldId).executeTakeFirst())?.name ?? null
    : null;
  return publicClosure({ ...row, field_name: fieldName });
}

export async function deleteClosure(db: Db, venueId: string, id: string): Promise<ClosurePublic> {
  const row = await db.selectFrom('closures')
    .leftJoin('fields', 'fields.id', 'closures.field_id')
    .select([
      'closures.id', 'closures.venue_id', 'closures.field_id', 'closures.during',
      'closures.reason', 'closures.label', 'fields.name as field_name',
    ])
    .where('closures.id', '=', id).executeTakeFirst();
  if (!row || row.venue_id !== venueId) throw notFound('Fermeture introuvable pour ce centre.');
  await db.deleteFrom('closures').where('id', '=', id).execute();
  return publicClosure(row);
}
