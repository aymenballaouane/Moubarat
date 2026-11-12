import { sql, type Selectable } from 'kysely';
import { validateDisplayName, type RecurringBooking } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { RecurringBookingsTable } from '../../db/types.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { lockFieldSchedule, recurringClash, weeklyOverlap } from './occupancy.js';

export type RecurringRow = Selectable<RecurringBookingsTable>;

export function rowToRecurringBooking(row: RecurringRow): RecurringBooking {
  return {
    id: row.id, fieldId: row.field_id, weekday: row.weekday, startMin: row.start_min,
    durationMin: row.duration_min, holderName: row.holder_name,
    activeFrom: row.active_from.getTime(), status: row.status,
    ...(row.active_until !== null ? { activeUntil: row.active_until.getTime() } : {}),
  };
}

export interface RecurringBookingPublic {
  id: string; fieldId: string; fieldName: string; weekday: number; startMin: number; durationMin: number;
  holderName: string; activeFromMs: number; activeUntilMs: number | null; status: 'ACTIVE' | 'ENDED';
}

function publicRecurring(row: RecurringRow, fieldName: string): RecurringBookingPublic {
  return {
    id: row.id, fieldId: row.field_id, fieldName, weekday: row.weekday, startMin: row.start_min,
    durationMin: row.duration_min, holderName: row.holder_name,
    activeFromMs: row.active_from.getTime(), activeUntilMs: row.active_until?.getTime() ?? null,
    status: row.status,
  };
}

export async function listRecurringBookings(db: Db, venueId: string): Promise<RecurringBookingPublic[]> {
  const rows = await db.selectFrom('recurring_bookings')
    .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
    .select([
      'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday',
      'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'recurring_bookings.holder_name',
      'recurring_bookings.active_from', 'recurring_bookings.active_until', 'recurring_bookings.status',
      'fields.name as field_name',
    ])
    .where('fields.venue_id', '=', venueId)
    .orderBy('recurring_bookings.status', 'asc') // ACTIVE avant ENDED (ordre alphabétique, pratique ici)
    .orderBy('recurring_bookings.weekday', 'asc')
    .execute();
  return rows.map((r) => publicRecurring(r, r.field_name));
}

export interface CreateRecurringInput {
  fieldId: string; weekday: number; startMin: number; durationMin: number;
  holderName: string; activeFromMs: number; activeUntilMs?: number;
}

/** Un abonnement ne doit jamais entrer en conflit avec un autre abonnement actif
    (même terrain, motifs hebdomadaires qui se chevauchent), ni avec une réservation
    ponctuelle réelle déjà existante sur une occurrence future du motif proposé
    — décision d'Aymen (06/09) : refus explicite dans les deux cas, jamais de
    résolution automatique (ce serait déjà de la gestion de conflit V1.5).
    MS-002 (audit final, 12/11/2026) : comparaisons par instants absolus, minuit compris (23:00 × 2 h le mardi
    recouvre le mercredi 00:00) — avant, seul le même jour civil était comparé. À appeler sous `lockFieldSchedule`. */
async function assertNoConflict(db: Db, p: CreateRecurringInput): Promise<void> {
  const otherRecurring = await db.selectFrom('recurring_bookings')
    .select(['id', 'weekday', 'start_min', 'duration_min', 'holder_name'])
    .where('field_id', '=', p.fieldId).where('status', '=', 'ACTIVE')
    .execute();
  const clash = otherRecurring.find((r) => weeklyOverlap(p, { weekday: r.weekday, startMin: r.start_min, durationMin: r.duration_min }));
  if (clash) {
    throw new ApiError(409, 'SLOT_TAKEN',
      `Ce créneau chevauche l'abonnement déjà actif de ${clash.holder_name}.`);
  }

  // Résas ponctuelles réelles encore à venir (ou en cours), jusqu'au lendemain de activeUntil si borné (une
  // occurrence du dernier jour peut déborder après minuit). Chaque résa est comparée aux occurrences du motif
  // proposé par instants absolus (`recurringClash`, qui applique les bornes activeFrom/activeUntil du core).
  // Audit 07/09/2026 (T5) : la durée comparée reste celle de la résa EXISTANTE, lue sur sa propre plage.
  const from = new Date(Math.max(p.activeFromMs, Date.now()));
  let query = db.selectFrom('bookings')
    .select(['time_range'])
    .where('field_id', '=', p.fieldId)
    .where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
    .where(sql<boolean>`upper(time_range) > ${from}`);
  if (p.activeUntilMs !== undefined) {
    query = query.where(sql<boolean>`lower(time_range) < ${new Date(p.activeUntilMs + 2 * 86_400_000)}`);
  }
  const proposed: RecurringBooking = {
    id: '', fieldId: p.fieldId, weekday: p.weekday, startMin: p.startMin, durationMin: p.durationMin,
    holderName: p.holderName, activeFrom: p.activeFromMs, status: 'ACTIVE',
    ...(p.activeUntilMs !== undefined ? { activeUntil: p.activeUntilMs } : {}),
  };
  for (const r of await query.execute()) {
    if (recurringClash([proposed], fromPgRange(r.time_range))) {
      throw new ApiError(409, 'SLOT_TAKEN',
        'Ce motif chevauche une réservation déjà existante sur une occurrence future — impossible de créer l’abonnement.');
    }
  }
}

export async function createRecurringBooking(db: Db, venueId: string, p: CreateRecurringInput): Promise<RecurringBookingPublic> {
  const field = await db.selectFrom('fields').select(['id', 'name', 'venue_id']).where('id', '=', p.fieldId).executeTakeFirst();
  if (!field || field.venue_id !== venueId) throw notFound('Terrain introuvable pour ce centre.');
  if (!Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6) throw badRequest('weekday invalide (0–6).');
  if (!Number.isInteger(p.startMin) || p.startMin < 0 || p.startMin >= 1440) throw badRequest('startMin invalide.');
  if (!Number.isInteger(p.durationMin) || p.durationMin < 30 || p.durationMin > 360) {
    throw badRequest('Durée invalide : entre 30 et 360 minutes.');
  }
  const holderName = p.holderName.trim();
  must(validateDisplayName(holderName));
  if (p.activeUntilMs !== undefined && p.activeUntilMs < p.activeFromMs) {
    throw badRequest('La date de fin doit être postérieure à la date de début.');
  }

  // MS-002 (audit final, 12/11/2026) : contrôle et écriture dans la même transaction, sous le verrou du terrain
  // partagé avec la création et le déplacement de réservation — deux postes ne posent plus deux fois le même motif.
  const row = await db.transaction().execute(async (trx) => {
    await lockFieldSchedule(trx, p.fieldId);
    await assertNoConflict(trx, { ...p, holderName });
    return trx.insertInto('recurring_bookings').values({
      field_id: p.fieldId, weekday: p.weekday, start_min: p.startMin, duration_min: p.durationMin,
      holder_name: holderName, active_from: new Date(p.activeFromMs),
      active_until: p.activeUntilMs !== undefined ? new Date(p.activeUntilMs) : null,
    }).returningAll().executeTakeFirstOrThrow();
  });
  return publicRecurring(row, field.name);
}

export async function endRecurringBooking(db: Db, venueId: string, id: string): Promise<RecurringBookingPublic> {
  const row = await db.selectFrom('recurring_bookings')
    .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
    .select([
      'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday',
      'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'recurring_bookings.holder_name',
      'recurring_bookings.active_from', 'recurring_bookings.active_until', 'recurring_bookings.status',
      'fields.name as field_name', 'fields.venue_id as venue_id',
    ])
    .where('recurring_bookings.id', '=', id)
    .executeTakeFirst();
  if (!row || row.venue_id !== venueId) throw notFound('Abonnement introuvable pour ce centre.');
  if (row.status === 'ENDED') throw new ApiError(409, 'INVALID_TRANSITION', 'Cet abonnement est déjà résilié.');
  const updated = await db.updateTable('recurring_bookings').set({ status: 'ENDED' })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  return publicRecurring(updated, row.field_name);
}
