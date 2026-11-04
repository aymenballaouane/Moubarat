/* CRM-2 / CRM-3 (audit pré-lancement, 27/09/2026) — projections PURES de deux routes :
   - GET /venues/:id/bookings/search (retrouver une réservation par référence, nom ou téléphone) ;
   - GET /venues/:id/clients/:userId/bookings (l'historique d'un client sur ce centre).
   Le serveur date chaque ligne de son JOUR D'EXPLOITATION (BUG-9) : `startMin` est compté depuis le minuit civil de
   CE jour — une réservation à 00:30 donne 1 470, que `hhmm` écrit « 00:30 (+1) », et c'est ce jour que le CRM ouvre
   dans Réservations pour retrouver la fiche. Aucune règle métier ici, aucun réseau — testé isolément. */

import type { BookingSource, BookingStatus } from '../data/reservationsDemo.js';
import { DAY_NAMES_SHORT, MONTH_NAMES, dayStartMs, weekdayOf } from './bookingsDetail.js';

export interface ApiBookingSearchHit {
  id: string; date: string; start: number; end: number; status: BookingStatus; source: BookingSource;
  verifiedByCenter: boolean; reservationName: string | null; customerPhone: string | null; claimStatus?: 'PENDING' | 'CONFIRMED' | 'DECLINED' | null; reference: string | null;
  priceTotalDa: number; matchId: string | null; fieldId: string; fieldName: string;
}

export interface SearchHit {
  id: string; date: string; startMin: number; durationMin: number;
  name: string; reference?: string; field: string; amountDa: number;
  status: BookingStatus; source: BookingSource; verified?: boolean; customerPhone?: string;
  claimStatus?: 'PENDING' | 'CONFIRMED' | 'DECLINED';
}

export function searchHitsFromApi(rows: readonly ApiBookingSearchHit[]): SearchHit[] {
  return rows.map((r) => ({
    id: r.id, date: r.date,
    startMin: Math.round((r.start - dayStartMs(r.date)) / 60_000),
    durationMin: Math.round((r.end - r.start) / 60_000),
    name: r.reservationName ?? '—',
    ...(r.reference ? { reference: r.reference } : {}),
    field: r.fieldName, amountDa: r.priceTotalDa, status: r.status, source: r.source,
    ...(r.source === 'PHONE' ? { verified: r.verifiedByCenter } : {}),
    ...(r.customerPhone ? { customerPhone: r.customerPhone } : {}),
    ...(r.claimStatus ? { claimStatus: r.claimStatus } : {}),
  }));
}

export interface ApiClientBookingHistoryRow {
  id: string; date: string; start: number; end: number; status: BookingStatus; source: BookingSource;
  reference: string | null; fieldName: string; priceTotalDa: number;
  cancelReason: 'STAFF_ERROR' | 'CLIENT' | null; matchId: string | null;
}

export interface HistoryRow {
  id: string; date: string; startMin: number; durationMin: number;
  status: BookingStatus; source: BookingSource; reference?: string; field: string; amountDa: number;
  cancelReason?: 'STAFF_ERROR' | 'CLIENT';
}

export function historyRowsFromApi(rows: readonly ApiClientBookingHistoryRow[]): HistoryRow[] {
  return rows.map((r) => ({
    id: r.id, date: r.date,
    startMin: Math.round((r.start - dayStartMs(r.date)) / 60_000),
    durationMin: Math.round((r.end - r.start) / 60_000),
    status: r.status, source: r.source,
    ...(r.reference ? { reference: r.reference } : {}),
    field: r.fieldName, amountDa: r.priceTotalDa,
    ...(r.cancelReason ? { cancelReason: r.cancelReason } : {}),
  }));
}

/** « Mer. 30 sept. 2026 » — avec l'année, parce qu'un historique ou un résultat de recherche peut remonter loin ;
    `dayLabel` (« Aujourd'hui », sans année) reste celui de la navigation jour par jour. */
export function dateLabelLong(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return `${DAY_NAMES_SHORT[weekdayOf(dateIso)]}. ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** Le libellé du nombre de résultats — pluriel accordé en JS, jamais « (s) ». */
export function hitsCountLabel(count: number, hasMore: boolean): string {
  if (count === 0) return 'Aucun résultat';
  const n = `${count} ${count > 1 ? 'résultats' : 'résultat'}`;
  return hasMore ? `${n} affichés — affinez la recherche ou affichez plus` : n;
}
