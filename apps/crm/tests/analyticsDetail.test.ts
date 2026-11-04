import { describe, expect, it } from 'vitest';
import {
  pctChange, noShowRatePct, panierMoyenDa, revenuePerOpenHourDa, type BookingCounts,
} from '../src/lib/analyticsDetail.js';

function counts(over: Partial<BookingCounts> = {}): BookingCounts {
  return { honored: 0, paid: 0, noShow: 0, cancelled: 0, ...over };
}

describe('pctChange', () => {
  it('variation simple', () => { expect(pctChange(120, 100)).toBe(20); });
  it('base nulle avec valeur courante nulle : 0 %, pas null', () => { expect(pctChange(0, 0)).toBe(0); });
  it('base nulle avec valeur courante non nulle : rien à comparer', () => { expect(pctChange(50, 0)).toBeNull(); });
});

describe('noShowRatePct — dénominateur honoré+payé+no-show, jamais les annulées ni RESERVED', () => {
  it('exclut les annulées (tôt ou tard) du dénominateur', () => {
    // 1 honorée, 1 payée, 1 no-show, 3 annulées : le taux ignore les 3
    // annulées — 1/3, pas 1/6.
    const c = counts({ honored: 1, paid: 1, noShow: 1, cancelled: 3 });
    expect(noShowRatePct(c)).toBeCloseTo(33.3, 1);
  });
  it('aucune résa résolue (honorée/payée/no-show) : null, pas 0', () => {
    expect(noShowRatePct(counts({ cancelled: 5 }))).toBeNull();
  });
  it('zéro no-show sur des résas résolues : 0 %', () => {
    expect(noShowRatePct(counts({ honored: 4, paid: 2 }))).toBe(0);
  });
});

describe('panierMoyenDa — dénominateur PAYÉES uniquement', () => {
  it('collecté ÷ nombre de résas payées', () => {
    expect(panierMoyenDa(15_000, counts({ paid: 4 }))).toBe(3_750);
  });
  it('aucune résa payée : null, jamais une division par zéro déguisée en 0', () => {
    expect(panierMoyenDa(0, counts({ honored: 3, noShow: 1 }))).toBeNull();
  });
});

describe('revenuePerOpenHourDa — DA par heure D\'OUVERTURE, jamais par heure réservée', () => {
  it('collecté ÷ (minutes d\'ouverture / 60)', () => {
    // 68 000 DA sur 1020 minutes d'ouverture (17h) => 4 000 DA/h.
    expect(revenuePerOpenHourDa(68_000, 1020)).toBe(4_000);
  });
  it('terrain sans horaires d\'ouverture connus : null', () => {
    expect(revenuePerOpenHourDa(10_000, 0)).toBeNull();
  });
});
