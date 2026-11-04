import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import type { Db } from '../../db/client.js';
import type { BookingSourceDb, BookingStatusDb } from '../../db/types.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { algiersDateOf, algiersHHMM, hhmm, operatingDateOf, operatingMinutesOfDay, operatingPeriodWindow } from '../../lib/algiers.js';
import type { Period } from './service.js';

/* Lot 4 — export Excel (15/09/2026). Requête dédiée, distincte de
   `loadPeriodBookings` (service.ts) : celle-ci ne porte ni `reference` ni
   `customer_phone` (absents du type core `Booking`, jamais ajoutés là — même
   raison que `cancelReason`), et ne joint pas le nom du terrain — inutiles
   aux rapports agrégés qu'elle alimente, indispensables ligne par ligne ici.
   Même fenêtre que `loadPeriodBookings` : les JOURS D'EXPLOITATION de la
   période, par heure de début (lib/algiers.ts, BUG-9 27/09/2026) — une
   réservation 23:30 → 01:00 sortait dans l'export de DEUX mois, et une
   réservation à 00:30 (+1) sortait datée du lendemain. Un blocage centre
   (`source: 'CENTER'`) n'est pas une réservation — exclu à la source, même
   règle que `bookingCounts` (service.ts) : « un blocage centre n'est pas une
   résa ». */
export interface ExportBookingRow {
  id: string;
  fieldName: string;
  startMs: number;
  endMs: number;
  status: BookingStatusDb;
  source: Exclude<BookingSourceDb, 'CENTER'>;
  reservationName: string | null;
  reference: string | null;
  customerPhone: string | null;
  priceTotalDa: number;
  cancelReason: 'STAFF_ERROR' | 'CLIENT' | null;
  createdAtMs: number;
}

export async function loadBookingsForExport(db: Db, venueId: string, period: Period): Promise<ExportBookingRow[]> {
  const win = operatingPeriodWindow(period.fromDay, period.toDay);
  const rows = await db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
    .select([
      'bookings.id', 'bookings.time_range', 'bookings.status', 'bookings.source',
      'bookings.reservation_name', 'bookings.reference', 'bookings.customer_phone',
      'bookings.price_total_da', 'bookings.cancel_reason', 'bookings.created_at',
      'fields.name as field_name',
    ])
    .where('fields.venue_id', '=', venueId)
    .where(sql<boolean>`lower(bookings.time_range) >= ${new Date(win.start)} AND lower(bookings.time_range) < ${new Date(win.end)}`)
    .where('bookings.source', '!=', 'CENTER')
    .execute();
  return rows.map((r) => {
    const range = fromPgRange(r.time_range);
    return {
      id: r.id, fieldName: r.field_name, startMs: range.start, endMs: range.end,
      status: r.status, source: r.source as Exclude<BookingSourceDb, 'CENTER'>,
      reservationName: r.reservation_name, reference: r.reference, customerPhone: r.customer_phone,
      priceTotalDa: r.price_total_da, cancelReason: r.cancel_reason, createdAtMs: r.created_at.getTime(),
    };
  });
}

const STATUS_LABELS: Record<BookingStatusDb, string> = {
  RESERVED: 'Réservé', HONORED: 'Honoré', PAID: 'Payé', NO_SHOW: 'No-show', CANCELLED: 'Annulé',
};
const SOURCE_LABELS: Record<Exclude<BookingSourceDb, 'CENTER'>, string> = {
  MOUBARAT: 'Moubarat', PHONE: 'Téléphone', WALK_IN: 'Comptoir',
};
/* Motif d'annulation (15/09/2026) : libellé français en clair dans l'export,
   jamais l'enum brute STAFF_ERROR/CLIENT — décision d'Aymen (preuve fiscale
   lisible par un comptable, pas par un développeur). */
const CANCEL_REASON_LABELS: Record<'STAFF_ERROR' | 'CLIENT', string> = {
  STAFF_ERROR: 'Erreur de saisie', CLIENT: 'Client',
};

export interface ExportRow {
  reference: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  terrain: string;
  statut: string;
  motifAnnulation: string;
  source: string;
  nom: string;
  telephone: string;
  montantDa: number;
  creeLe: string;
}

/* Montant = prix de la réservation, TOUJOURS (jamais 0 pour une annulée,
   jamais l'encaissé réel) — décision d'Aymen : c'est le Statut qui permet
   d'exclure une ligne annulée d'une somme, pas une colonne à 0. Une
   annulation STAFF_ERROR exporte donc le même Montant qu'une réservation
   honorée du même prix — seul son Statut ("Annulé") et son Motif
   ("Erreur de saisie") disent qu'elle ne doit pas entrer dans un total. */
export function exportRowsFromBookings(bookings: readonly ExportBookingRow[]): ExportRow[] {
  return bookings
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((b) => ({
      reference: b.reference ?? '',
      // Date = le jour d'EXPLOITATION (BUG-9) : une réservation à 00:30 sort datée de sa soirée, heure « 00:30 (+1) » —
      // la même écriture que le planning du CRM, jamais « le lendemain à 00:30 » qu'un comptable classerait ailleurs.
      date: operatingDateOf(b.startMs),
      heureDebut: hhmm(operatingMinutesOfDay(b.startMs)),
      heureFin: hhmm(operatingMinutesOfDay(b.startMs) + Math.round((b.endMs - b.startMs) / 60_000)),
      terrain: b.fieldName,
      statut: STATUS_LABELS[b.status],
      motifAnnulation: b.cancelReason ? CANCEL_REASON_LABELS[b.cancelReason] : '',
      source: SOURCE_LABELS[b.source],
      nom: b.reservationName ?? '',
      telephone: b.customerPhone ?? '',
      montantDa: b.priceTotalDa,
      creeLe: `${algiersDateOf(b.createdAtMs)} ${algiersHHMM(b.createdAtMs)}`,
    }));
}

const COLUMNS: { header: string; key: keyof ExportRow; width: number }[] = [
  { header: 'Référence', key: 'reference', width: 14 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Heure début', key: 'heureDebut', width: 12 },
  { header: 'Heure fin', key: 'heureFin', width: 12 },
  { header: 'Terrain', key: 'terrain', width: 10 },
  { header: 'Statut', key: 'statut', width: 12 },
  { header: 'Motif annulation', key: 'motifAnnulation', width: 16 },
  { header: 'Source', key: 'source', width: 12 },
  { header: 'Nom', key: 'nom', width: 22 },
  { header: 'Téléphone', key: 'telephone', width: 16 },
  { header: 'Montant (DA)', key: 'montantDa', width: 14 },
  { header: 'Créée le', key: 'creeLe', width: 18 },
];

/** Construit le classeur — jamais de Date JS confiée à exceljs (elle
    l'écrirait en UTC par défaut, exigence n°1 d'Aymen) : toutes les colonnes
    date/heure sont déjà des chaînes formatées Alger par `exportRowsFromBookings`.
    Type de retour non annoté à dessein : le `Buffer` d'exceljs (ambient,
    non exporté par le module) n'est pas le `Buffer` Node — l'appelant
    (routes.ts) repasse par `Buffer.from(...)` avant `reply.send`. */
export async function buildExportWorkbook(rows: readonly ExportRow[]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Réservations');
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  return wb.xlsx.writeBuffer();
}

export function exportFilename(fromDay: string, toDay: string): string {
  return `moubarat-reservations-${fromDay}_${toDay}.xlsx`;
}
