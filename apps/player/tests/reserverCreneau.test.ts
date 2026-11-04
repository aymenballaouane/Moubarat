import { describe, expect, it } from 'vitest';
import type { MatchFormat, Quote } from '@moubarat/core';
import type { AvailabilityStart } from '../src/lib/mappers.js';
import {
  buildDayChips, cancelLimitLabel, defaultStart, fallbackStarts, fillTemplate, formatPrice, periodOf, resolveFormat, startsForFormat, ticketDateLabel,
} from '../src/lib/reserverCreneau.js';

/* R3 (Lot 5) — dérivations pures de l'écran « Ta réservation » (règle 17 : jour → format → durée → heure). */

const quote = {} as Quote;
const start = (startMin: number, formats: [MatchFormat, number][]): AvailabilityStart => ({
  startMin,
  byFormat: formats.map(([format, totalDa]) => ({ format, fieldId: `f-${format}`, totalDa, peak: false, quote })),
});

describe('periodOf', () => {
  it('coupe à 12 h et 18 h', () => {
    expect(periodOf(11 * 60 + 30)).toBe('matin');
    expect(periodOf(12 * 60)).toBe('apm');
    expect(periodOf(17 * 60 + 30)).toBe('apm');
    expect(periodOf(18 * 60)).toBe('soir');
    expect(periodOf(25 * 60)).toBe('soir');
  });
});

describe('buildDayChips', () => {
  it('sept jours glissants, le premier est aujourd’hui, sept jours de semaine distincts', () => {
    const now = new Date(2026, 9, 25, 15, 0); // dimanche 25 oct. 2026
    const chips = buildDayChips(now);
    expect(chips).toHaveLength(7);
    expect(chips[0]).toEqual({ weekday: 0, date: 25, isToday: true });
    expect(chips.map((c) => c.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(chips.filter((c) => c.isToday)).toHaveLength(1);
    expect(chips[1]!.date).toBe(26);
  });
  it('commence un mercredi : mer. → mar.', () => {
    const chips = buildDayChips(new Date(2026, 9, 21, 9, 0));
    expect(chips.map((c) => c.weekday)).toEqual([3, 4, 5, 6, 0, 1, 2]);
    expect(chips[0]!.date).toBe(21);
  });
});

describe('startsForFormat / defaultStart', () => {
  const starts = [
    start(17 * 60, [['5v5', 4000]]),
    start(18 * 60 + 30, [['5v5', 5000], ['6v6', 5600]]),
    start(20 * 60, [['6v6', 6000]]),
  ];
  it('ne garde que les départs où le format est libre', () => {
    expect(startsForFormat(starts, '5v5').map((s) => s.startMin)).toEqual([17 * 60, 18 * 60 + 30]);
    expect(startsForFormat(starts, '6v6').map((s) => s.startMin)).toEqual([18 * 60 + 30, 20 * 60]);
    expect(startsForFormat(starts, null)).toEqual([]);
  });
  it('propose 18:00 s’il est libre, sinon le premier après, sinon le premier', () => {
    expect(defaultStart([start(17 * 60, [['5v5', 1]]), start(18 * 60, [['5v5', 1]])])).toBe(18 * 60);
    expect(defaultStart(starts)).toBe(18 * 60 + 30);
    expect(defaultStart([start(9 * 60, [['5v5', 1]]), start(10 * 60, [['5v5', 1]])])).toBe(9 * 60);
    expect(defaultStart([])).toBeNull();
  });
});

describe('resolveFormat', () => {
  const options = [{ format: '5v5' as MatchFormat }, { format: '7v7' as MatchFormat }];
  it('choix du joueur > terrain touché > premier proposé, toujours un format servi', () => {
    expect(resolveFormat(options, '7v7', '5v5')).toBe('7v7');
    expect(resolveFormat(options, null, '7v7')).toBe('7v7');
    expect(resolveFormat(options, null, null)).toBe('5v5');
    expect(resolveFormat(options, '11v11', '8v8')).toBe('5v5');
    expect(resolveFormat([], null, null)).toBeNull();
  });
});

describe('formatPrice', () => {
  const starts = [start(18 * 60, [['5v5', 4000]]), start(20 * 60, [['5v5', 5000], ['7v7', 9000]])];
  it('prix exact du départ choisi s’il offre le format', () => {
    expect(formatPrice(starts, '5v5', 20 * 60)).toEqual({ total: 5000, exact: true });
  });
  it('sinon « dès » le moins cher des départs de ce format', () => {
    expect(formatPrice(starts, '5v5', null)).toEqual({ total: 4000, exact: false });
    expect(formatPrice(starts, '7v7', 18 * 60)).toEqual({ total: 9000, exact: false });
  });
  it('aucun départ libre dans ce format → null, jamais un prix inventé', () => {
    expect(formatPrice(starts, '8v8', null)).toBeNull();
  });
});

describe('ticket R4', () => {
  const start = new Date(2026, 9, 26, 18, 0).getTime(); // lundi 26 oct. 2026, 18:00
  it('date du bandeau en majuscules (fr), chiffres occidentaux en arabe', () => {
    expect(ticketDateLabel(start, 'fr')).toMatch(/^LUN.? 26 OCT/);
    expect(ticketDateLabel(start, 'ar')).toMatch(/26/);
    expect(ticketDateLabel(start, 'ar')).not.toMatch(/[٠-٩]/);
  });
  it('limite d’annulation : l’heure seule le jour même, jour + heure sinon', () => {
    const limit = start - 2 * 3_600_000; // 16:00
    expect(cancelLimitLabel(limit, start, new Date(2026, 9, 26, 9, 0).getTime(), 'fr')).toBe('16:00');
    const other = cancelLimitLabel(limit, start, new Date(2026, 9, 25, 9, 0).getTime(), 'fr');
    expect(other).toMatch(/26/);
    expect(other).toMatch(/16:00$/);
  });
});

describe('créneau pris entre-temps', () => {
  const free = [9, 12, 19, 20, 21, 23.5].map((h) => start(h * 60, [['5v5', 4000]]));
  it('propose les deux départs libres les plus proches, en ordre chronologique, sans le départ pris', () => {
    expect(fallbackStarts(free, 20 * 60).map((s) => s.startMin / 60)).toEqual([19, 21]);
    expect(fallbackStarts(free, 18 * 60).map((s) => s.startMin / 60)).toEqual([19, 20]);
  });
  it('à égalité de distance, le plus tardif ; jamais le départ pris lui-même', () => {
    const twoSides = [18, 20].map((h) => start(h * 60, [['5v5', 1]]));
    expect(fallbackStarts(twoSides, 19 * 60, 1).map((s) => s.startMin / 60)).toEqual([20]);
    expect(fallbackStarts(twoSides.concat(start(19 * 60, [['5v5', 1]])), 19 * 60).map((s) => s.startMin / 60)).toEqual([18, 20]);
  });
  it('aucun départ libre → aucune proposition, sans planter', () => {
    expect(fallbackStarts([], 20 * 60)).toEqual([]);
    expect(fallbackStarts([start(20 * 60, [['5v5', 1]])], 20 * 60)).toEqual([]);
  });
  it('gabarit à trous : remplit, laisse un trou inconnu tel quel', () => {
    expect(fillTemplate('Prendre {heure}', { heure: '21:00' })).toBe('Prendre 21:00');
    expect(fillTemplate('{a} et {b}', { a: 'x' })).toBe('x et {b}');
  });
});
