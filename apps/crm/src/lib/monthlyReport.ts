/* P1-17 (audit stratégique du CRM, 15/11/2026, choix d'Aymen « écran imprimable ») : « ce que Moubarat vous a rapporté », mois
   par mois. Rien de neuf côté serveur : le rapport se compose des routes Analytics existantes (revenue, occupancy) sur le mois
   et le mois précédent — mêmes règles (core `cashReport`, erreurs de saisie du centre exclues). Que des chiffres réels : aucun
   « no-show évité » ni gain estimé, faute de mesure. Pur, testable sans réseau. */
import { noShowRatePct, pctChange, type BookingCounts } from './analyticsDetail.js';

export interface CashReportApi { collected: number; engaged: number; lostCancelled: number; lostNoShow: number }
export type SourceKey = 'MOUBARAT' | 'PHONE' | 'WALK_IN';
export interface RevenueReportApi {
  overall: CashReportApi;
  bySource: Record<SourceKey, CashReportApi>;
  counts: { overall: BookingCounts; bySource: Record<SourceKey, BookingCounts> };
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-11 » → « novembre 2026 ». */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** Le mois d'une date « AAAA-MM-JJ ». */
export function monthOf(dateIso: string): string { return dateIso.slice(0, 7); }

/** Le mois décalé de `delta` (« 2026-01 », −1 → « 2025-12 »). */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = (y * 12 + (m - 1)) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Premier et dernier JOUR D'EXPLOITATION du mois, au format des routes Analytics (`from`/`to` inclus). */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/** Le mois en cours est-il terminé ? (sinon le rapport le dit « en cours »). */
export function isMonthOver(ym: string, todayIso: string): boolean { return monthOf(todayIso) > ym; }

export interface ReportLine {
  key: string; label: string; value: string;
  /** Écart avec le mois précédent, en % (null si le mois précédent est à 0). */
  deltaPct: number | null;
  /** Une hausse est-elle une mauvaise nouvelle (no-shows, pertes) ? */
  lowerIsBetter: boolean;
  note?: string;
}

const da = (n: number) => `${n.toLocaleString('fr-FR').replace(/ | /g, ' ')} DA`;
const played = (c: BookingCounts) => c.honored + c.paid;

/** Les lignes du rapport d'un mois, comparées au mois précédent. `occupancy` : 0..1 (route occupancy). */
export function buildMonthlyReport(
  curr: RevenueReportApi, prev: RevenueReportApi, occ: { curr: number; prev: number },
): ReportLine[] {
  const appCurr = curr.bySource.MOUBARAT;
  const appPrev = prev.bySource.MOUBARAT;
  const appShare = curr.overall.collected > 0 ? Math.round((appCurr.collected / curr.overall.collected) * 100) : null;
  const nsCurr = noShowRatePct(curr.counts.overall);
  return [
    { key: 'collected', label: 'Chiffre d’affaires encaissé', value: da(curr.overall.collected), deltaPct: pctChange(curr.overall.collected, prev.overall.collected), lowerIsBetter: false },
    {
      key: 'app', label: 'dont réservations venues de l’app Moubarat', value: da(appCurr.collected),
      deltaPct: pctChange(appCurr.collected, appPrev.collected), lowerIsBetter: false,
      ...(appShare !== null ? { note: `${appShare} % du chiffre encaissé` } : {}),
    },
    { key: 'played', label: 'Réservations jouées (honorées ou payées)', value: String(played(curr.counts.overall)), deltaPct: pctChange(played(curr.counts.overall), played(prev.counts.overall)), lowerIsBetter: false },
    {
      key: 'appPlayed', label: 'dont via l’app Moubarat', value: String(played(curr.counts.bySource.MOUBARAT)),
      deltaPct: pctChange(played(curr.counts.bySource.MOUBARAT), played(prev.counts.bySource.MOUBARAT)), lowerIsBetter: false,
    },
    { key: 'occupancy', label: 'Remplissage des terrains', value: `${Math.round(occ.curr * 100)} %`, deltaPct: pctChange(Math.round(occ.curr * 100), Math.round(occ.prev * 100)), lowerIsBetter: false },
    {
      key: 'noShow', label: 'No-shows', value: String(curr.counts.overall.noShow), deltaPct: pctChange(curr.counts.overall.noShow, prev.counts.overall.noShow),
      lowerIsBetter: true, note: `${da(curr.overall.lostNoShow)} perdus${nsCurr !== null ? ` · ${String(nsCurr).replace('.', ',')} % des réservations` : ''}`,
    },
    { key: 'lostCancelled', label: 'Chiffre perdu sur annulations', value: da(curr.overall.lostCancelled), deltaPct: pctChange(curr.overall.lostCancelled, prev.overall.lostCancelled), lowerIsBetter: true },
    {
      key: 'engaged', label: 'Encore à encaisser', value: da(curr.overall.engaged), deltaPct: null, lowerIsBetter: true,
      note: curr.overall.engaged > 0 ? 'Réservations du mois ni payées ni clôturées' : 'Tout est clôturé',
    },
  ];
}
