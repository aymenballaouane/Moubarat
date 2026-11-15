import { sql } from 'kysely';
import {
  cashStatusOpensAt, recurringOccurrence, setBookingStatus, total, weekdayOfDayStart,
  type Booking, type BookingStatus, type CenterRole, type TimeRange,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { writeAudit } from '../../audit/log.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { algiersDateOf, dayStartMs, operatingDateOf, operatingDayWindow, operatingPeriodWindow } from '../../lib/algiers.js';
import { collectIntoOpenSession } from '../cash/collect.js';
import { rowToRecurringBooking } from './service.js';

/* P1-12 (audit stratégique du CRM, 15/11/2026, choix d'Aymen : « prix par séance », architecture « couche séances »).
   Une SÉANCE = une occurrence d'un abonnement (core `recurringOccurrence`, inchangé), identifiée par (abonnement, jour civil
   d'Alger où elle commence). Son statut n'existe que lorsqu'il est posé (table `recurring_occurrences`, migration 0046) ; sans
   ligne elle est « RESERVED » — à venir, ou passée et pas encore clôturée. Les règles de passage sont CELLES d'une réservation
   (core `setBookingStatus`, `cashStatusOpensAt`) : jamais une règle propre aux séances.
   - Une séance enregistrée compte TOUJOURS (même si l'abonnement est résilié depuis) avec le prix figé à l'enregistrement.
   - Une séance non enregistrée n'existe que pour un abonnement ACTIF (projection du core) et vaut son prix par séance.
   - Un abonnement sans prix (créé avant ce lot) : ses séances non enregistrées restent hors du chiffre d'affaires. */

const MIN = 60_000;
const DAY = 86_400_000;

export type SessionStatus = 'RESERVED' | 'HONORED' | 'PAID' | 'NO_SHOW';

export interface Session {
  recurringId: string; holderName: string; fieldId: string; fieldName: string;
  /** Jour civil (Alger) où la séance commence — la clé de la séance. */
  date: string;
  range: TimeRange;
  status: SessionStatus;
  /** Prix figé si le statut est posé, sinon le prix par séance de l'abonnement (null : abonnement sans prix). */
  priceDa: number | null;
  recorded: boolean;
}

interface SubRow {
  id: string; field_id: string; weekday: number; start_min: number; duration_min: number; holder_name: string;
  active_from: Date; active_until: Date | null; status: 'ACTIVE' | 'ENDED'; price_per_session_da: number | null; field_name: string;
}

async function loadSubs(db: Db, venueId: string, opts: { fieldId?: string; id?: string; forUpdate?: boolean } = {}): Promise<SubRow[]> {
  let q = db.selectFrom('recurring_bookings')
    .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
    .select([
      'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday', 'recurring_bookings.start_min',
      'recurring_bookings.duration_min', 'recurring_bookings.holder_name', 'recurring_bookings.active_from',
      'recurring_bookings.active_until', 'recurring_bookings.status', 'recurring_bookings.price_per_session_da',
      'fields.name as field_name',
    ])
    .where('fields.venue_id', '=', venueId);
  if (opts.fieldId) q = q.where('recurring_bookings.field_id', '=', opts.fieldId);
  if (opts.id) q = q.where('recurring_bookings.id', '=', opts.id);
  if (opts.forUpdate) q = q.forUpdate();
  return q.execute() as Promise<SubRow[]>;
}

interface RecordedRow { recurring_id: string; occurrence_date: string; status: 'HONORED' | 'PAID' | 'NO_SHOW'; price_da: number }

async function loadRecorded(db: Db, ids: readonly string[], fromDate: string, toDate: string): Promise<RecordedRow[]> {
  if (ids.length === 0) return [];
  const res = await sql<RecordedRow>`
    SELECT recurring_id, occurrence_date::text AS occurrence_date, status, price_da
    FROM recurring_occurrences
    WHERE recurring_id = ANY(${[...ids]}::uuid[]) AND occurrence_date BETWEEN ${fromDate}::date AND ${toDate}::date`.execute(db);
  return res.rows;
}

/** Début d'une séance d'un abonnement à un jour civil donné (qu'elle soit encore projetée ou non). */
function startOn(sub: SubRow, date: string): TimeRange {
  const start = dayStartMs(date) + sub.start_min * MIN;
  return { start, end: start + sub.duration_min * MIN };
}

/** Les séances dont le DÉBUT tombe dans la fenêtre [startMs, endMs) — projetées (abonnements actifs) et enregistrées. */
async function sessionsInWindow(db: Db, venueId: string, startMs: number, endMs: number, fieldId?: string): Promise<Session[]> {
  const subs = await loadSubs(db, venueId, fieldId ? { fieldId } : {});
  if (subs.length === 0) return [];
  const firstDate = algiersDateOf(startMs);
  const lastDate = algiersDateOf(endMs - 1);
  const recorded = await loadRecorded(db, subs.map((s) => s.id), firstDate, lastDate);
  const recordedByKey = new Map(recorded.map((r) => [`${r.recurring_id}|${r.occurrence_date}`, r]));
  const out = new Map<string, Session>();
  const add = (sub: SubRow, date: string, range: TimeRange) => {
    if (range.start < startMs || range.start >= endMs) return;
    const rec = recordedByKey.get(`${sub.id}|${date}`);
    out.set(`${sub.id}|${date}`, {
      recurringId: sub.id, holderName: sub.holder_name, fieldId: sub.field_id, fieldName: sub.field_name, date, range,
      status: rec?.status ?? 'RESERVED', priceDa: rec?.price_da ?? sub.price_per_session_da, recorded: rec !== undefined,
    });
  };
  for (let d = dayStartMs(firstDate); d <= dayStartMs(lastDate); d += DAY) {
    const weekday = weekdayOfDayStart(d);
    const date = algiersDateOf(d);
    for (const sub of subs) {
      const occ = recurringOccurrence(rowToRecurringBooking(sub), weekday, d);
      if (occ) add(sub, date, occ);
    }
  }
  // Enregistrées mais plus projetées (abonnement résilié depuis) : elles ont eu lieu, elles comptent.
  const byId = new Map(subs.map((s) => [s.id, s]));
  for (const r of recorded) {
    const sub = byId.get(r.recurring_id);
    if (sub && !out.has(`${sub.id}|${r.occurrence_date}`)) add(sub, r.occurrence_date, startOn(sub, r.occurrence_date));
  }
  return [...out.values()].sort((a, b) => a.range.start - b.range.start);
}

/** Les séances des jours d'EXPLOITATION `fromDay`..`toDay` (même fenêtre que les réservations, lib/algiers.ts). */
export function sessionsForPeriod(db: Db, venueId: string, fromDay: string, toDay: string, fieldId?: string): Promise<Session[]> {
  const win = operatingPeriodWindow(fromDay, toDay);
  return sessionsInWindow(db, venueId, win.start, win.end, fieldId);
}

/** Les séances d'un jour CIVIL (le Planning et la liste des réservations raisonnent déjà en jour civil pour les abonnements). */
export function sessionsForCivilDay(db: Db, venueId: string, date: string, fieldId?: string): Promise<Session[]> {
  const start = dayStartMs(date);
  return sessionsInWindow(db, venueId, start, start + DAY, fieldId);
}

/** Une séance vue comme une réservation pour les calculs du core (`cashReport`, comptages) : seulement si elle a un prix. Source
    « comptoir » (WALK_IN) : un abonné est un client du centre, pas une vente de l'app. */
export function sessionsAsBookings(sessions: readonly Session[]): (Booking & { cancelReason: null })[] {
  return sessions.filter((s) => s.priceDa !== null).map((s) => ({
    id: `sub-occ:${s.recurringId}:${s.date}`, fieldId: s.fieldId, range: s.range, status: s.status as BookingStatus,
    source: 'WALK_IN', verifiedByCenter: true, priceTotal: total(s.priceDa!), byUserId: '', createdAt: s.range.start,
    cancelReason: null,
  }) as Booking & { cancelReason: null });
}

const STATUS_LABEL: Record<'HONORED' | 'PAID' | 'NO_SHOW', string> = { HONORED: 'Honorée', PAID: 'Payée', NO_SHOW: 'No-show' };

function frDate(date: string): string { return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`; }

/** Poser le statut d'une séance (Réception et au-dessus : SET_CASH_STATUS, vérifié par l'appelant). Mêmes règles qu'une réservation :
    transitions du core, « Honorée » et « No-show » au début du créneau, « Payée » dès le jour d'exploitation (P0-1), encaissement
    en caisse dans la même transaction si demandé (P1-11). */
export async function setSessionStatus(db: Db, p: {
  venueId: string; recurringId: string; date: string; to: 'HONORED' | 'PAID' | 'NO_SHOW';
  actorId: string; role: CenterRole; recordCash: boolean; now: number;
}): Promise<{ status: SessionStatus; priceDa: number; cashRecorded: boolean }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw badRequest('Date de séance attendue au format AAAA-MM-JJ.');
  try { dayStartMs(p.date); } catch { throw badRequest('Date de séance invalide.'); }
  return db.transaction().execute(async (trx) => {
    const [sub] = await loadSubs(trx, p.venueId, { id: p.recurringId, forUpdate: true });
    if (!sub) throw notFound('Abonnement introuvable pour ce centre.');
    const [rec] = await loadRecorded(trx, [sub.id], p.date, p.date);
    const projected = recurringOccurrence(rowToRecurringBooking(sub), weekdayOfDayStart(dayStartMs(p.date)), dayStartMs(p.date));
    if (!rec && !projected) throw notFound('Cet abonnement n’a pas de séance ce jour-là.');
    const range = projected ?? startOn(sub, p.date);
    const current: SessionStatus = rec?.status ?? 'RESERVED';
    must(setBookingStatus({ status: current } as Booking, p.to));
    const opensAt = cashStatusOpensAt(p.to, range.start, operatingDayWindow(dayStartMs(operatingDateOf(range.start))).start);
    if (p.now < opensAt) {
      throw badRequest(
        p.to === 'PAID' ? 'Une séance se marque payée le jour même, pas avant.' : 'La séance n’a pas encore commencé : impossible de la marquer ' + (p.to === 'HONORED' ? 'honorée.' : 'no-show.'),
        p.to === 'PAID' ? 'PAYMENT_NOT_OPEN' : 'BOOKING_NOT_STARTED',
      );
    }
    const priceDa = rec?.price_da ?? sub.price_per_session_da;
    if (priceDa === null) throw new ApiError(409, 'NO_PRICE', 'Fixez d’abord le prix par séance de cet abonnement (écran Abonnements).');
    await trx.insertInto('recurring_occurrences')
      .values({ recurring_id: sub.id, occurrence_date: p.date, status: p.to, price_da: priceDa, set_by: p.actorId })
      .onConflict((oc) => oc.columns(['recurring_id', 'occurrence_date']).doUpdateSet({ status: p.to, set_by: p.actorId, set_at: new Date(p.now) }))
      .execute();
    const label = `la séance de ${sub.holder_name} du ${frDate(p.date)}`;
    const cashRecorded = p.to === 'PAID' && p.recordCash && await collectIntoOpenSession(trx, {
      venueId: p.venueId, role: p.role, actorId: p.actorId, amountDa: priceDa, ref: `Abonnement ${sub.holder_name} ${frDate(p.date)}`,
      note: 'Séance d’abonnement payée', now: p.now, summary: `a encaissé ${priceDa} DA en caisse — ${label} payée`,
    });
    await writeAudit(trx, {
      venueId: p.venueId, actorId: p.actorId, actorRole: p.role,
      action: 'BOOKING_CASH_STATUS', objectType: 'recurring_occurrence', objectId: `${sub.id}:${p.date}`,
      summary: `a passé ${label} en « ${STATUS_LABEL[p.to]} » (${priceDa} DA)${cashRecorded ? ' — encaissé en caisse' : ''}`,
      before: current, after: p.to,
    });
    return { status: p.to, priceDa, cashRecorded };
  });
}

/** Corriger une séance marquée par erreur (Manager et propriétaire : REVERT_NO_SHOW, vérifié par l'appelant) : elle redevient
    « réservée » (la ligne est retirée). La caisse n'est pas touchée, comme pour une réservation (MS-036). */
export async function revertSession(db: Db, p: { venueId: string; recurringId: string; date: string; actorId: string; role: CenterRole }): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw badRequest('Date de séance attendue au format AAAA-MM-JJ.');
  await db.transaction().execute(async (trx) => {
    const [sub] = await loadSubs(trx, p.venueId, { id: p.recurringId, forUpdate: true });
    if (!sub) throw notFound('Abonnement introuvable pour ce centre.');
    const deleted = await sql<{ status: string; price_da: number }>`
      DELETE FROM recurring_occurrences WHERE recurring_id = ${sub.id}::uuid AND occurrence_date = ${p.date}::date
      RETURNING status, price_da`.execute(trx);
    const row = deleted.rows[0];
    if (!row) throw badRequest('Cette séance n’a pas de statut à corriger.', 'INVALID_TRANSITION');
    await writeAudit(trx, {
      venueId: p.venueId, actorId: p.actorId, actorRole: p.role,
      action: 'BOOKING_STATUS_CORRECTED', objectType: 'recurring_occurrence', objectId: `${sub.id}:${p.date}`,
      summary: `a corrigé la séance de ${sub.holder_name} du ${frDate(p.date)} : ${STATUS_LABEL[row.status as 'PAID']} → Réservée (${row.price_da} DA)`,
      before: row.status, after: 'RESERVED',
    });
  });
}
