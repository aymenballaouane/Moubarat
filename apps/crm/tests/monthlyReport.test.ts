import { describe, expect, it } from 'vitest';
import { buildMonthlyReport, isMonthOver, monthLabel, monthRange, shiftMonth, type RevenueReportApi } from '../src/lib/monthlyReport.js';

/* P1-17 (audit stratégique du CRM, 15/11/2026) : rapport du mois — composé des routes Analytics existantes. */

const cash = (collected: number, over: Partial<RevenueReportApi['overall']> = {}) => ({ collected, engaged: 0, lostCancelled: 0, lostNoShow: 0, ...over });
const counts = (paid: number, honored = 0, noShow = 0) => ({ paid, honored, noShow, cancelled: 0 });
function report(o: { collected: number; app: number; paid: number; appPaid: number; noShow?: number; lostNoShow?: number; engaged?: number }): RevenueReportApi {
  return {
    overall: cash(o.collected, { lostNoShow: o.lostNoShow ?? 0, engaged: o.engaged ?? 0 }),
    bySource: { MOUBARAT: cash(o.app), PHONE: cash(0), WALK_IN: cash(o.collected - o.app) },
    counts: { overall: counts(o.paid, 0, o.noShow ?? 0), bySource: { MOUBARAT: counts(o.appPaid), PHONE: counts(0), WALK_IN: counts(o.paid - o.appPaid) } },
  };
}

describe('mois', () => {
  it('libellé, décalage (y compris d’une année à l’autre), bornes du mois, mois terminé', () => {
    expect(monthLabel('2026-11')).toBe('novembre 2026');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(isMonthOver('2026-10', '2026-11-15')).toBe(true);
    expect(isMonthOver('2026-11', '2026-11-15')).toBe(false);
  });
});

describe('buildMonthlyReport', () => {
  const lines = buildMonthlyReport(
    report({ collected: 200_000, app: 50_000, paid: 80, appPaid: 20, noShow: 4, lostNoShow: 10_000, engaged: 3000 }),
    report({ collected: 160_000, app: 25_000, paid: 70, appPaid: 10, noShow: 2 }),
    { curr: 0.42, prev: 0.40 },
  );
  const by = (k: string) => lines.find((l) => l.key === k)!;

  it('CA encaissé et part venue de l’app, comparés au mois précédent', () => {
    expect(by('collected')).toMatchObject({ value: '200 000 DA', deltaPct: 25 });
    expect(by('app')).toMatchObject({ value: '50 000 DA', deltaPct: 100, note: '25 % du chiffre encaissé' });
    expect(by('appPlayed')).toMatchObject({ value: '20', deltaPct: 100 });
    expect(by('occupancy')).toMatchObject({ value: '42 %', deltaPct: 5 });
  });

  it('no-shows : une hausse est une mauvaise nouvelle ; le chiffre perdu et le taux en note ; rien d’inventé', () => {
    expect(by('noShow')).toMatchObject({ value: '4', deltaPct: 100, lowerIsBetter: true, note: '10 000 DA perdus · 4,8 % des réservations' });
    expect(lines.map((l) => l.key)).not.toContain('noShowAvoided');
    expect(by('engaged')).toMatchObject({ value: '3 000 DA', note: 'Réservations du mois ni payées ni clôturées' });
  });
});
