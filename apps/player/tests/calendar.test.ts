import { describe, expect, it } from 'vitest';
import { CALENDAR_HORIZON_DAYS, monthCells, monthCount, startOfDay } from '../src/lib/calendar.js';

/* « Choisis un jour » (Lot 5) — grille du mois, semaine commençant le lundi. */

const TODAY = new Date(2026, 9, 25, 15, 30).getTime(); // dimanche 25 octobre 2026

describe('monthCells', () => {
  it('octobre 2026 : le 1er est un jeudi → trois cases vides (lundi, mardi, mercredi)', () => {
    const { year, month, cells } = monthCells(TODAY, 0);
    expect([year, month]).toEqual([2026, 9]);
    expect(cells.slice(0, 3).every((c) => c.empty)).toBe(true);
    expect(cells[3]).toMatchObject({ empty: false, day: 1, stamp: '2026-10-01' });
    expect(cells).toHaveLength(3 + 31);
  });
  it('les jours avant aujourd’hui sont passés, aujourd’hui et après ne le sont pas', () => {
    const { cells } = monthCells(TODAY, 0);
    const day = (n: number) => cells.find((c) => c.day === n)!;
    expect(day(24).past).toBe(true);
    expect(day(25).past).toBe(false);
    expect(day(31).past).toBe(false);
  });
  it('le mois suivant : novembre 2026 commence un dimanche → six cases vides, aucun jour passé', () => {
    const { month, cells } = monthCells(TODAY, 1);
    expect(month).toBe(10);
    expect(cells.slice(0, 6).every((c) => c.empty)).toBe(true);
    expect(cells[6]).toMatchObject({ day: 1, stamp: '2026-11-01' });
    expect(cells.filter((c) => !c.empty)).toHaveLength(30);
    expect(cells.some((c) => c.past)).toBe(false);
  });
  it('passage d’année : décembre → janvier', () => {
    const dec = new Date(2026, 11, 20).getTime();
    expect(monthCells(dec, 1)).toMatchObject({ year: 2027, month: 0 });
  });
  it('dayStart est minuit local', () => {
    const c = monthCells(TODAY, 0).cells.find((x) => x.day === 25)!;
    expect(c.dayStart).toBe(startOfDay(TODAY));
  });
});

describe('monthCount', () => {
  it('l’horizon de 62 jours depuis le 25 octobre couvre octobre, novembre et décembre', () => {
    expect(monthCount(TODAY, CALENDAR_HORIZON_DAYS)).toBe(3);
  });
  it('au 1er du mois, 62 jours = ce mois et le suivant (et le début du troisième si le mois est court)', () => {
    expect(monthCount(new Date(2026, 9, 1).getTime(), 62)).toBe(3); // 1er oct. + 61 j = 1er déc.
    expect(monthCount(new Date(2026, 9, 1).getTime(), 30)).toBe(1);
  });
});
