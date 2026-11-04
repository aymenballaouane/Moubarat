import { describe, expect, it } from 'vitest';
import { perHour, total, type MatchFormat } from '@moubarat/core';
import { mergeFieldAvailabilities } from '../src/lib/availabilityMerge.js';
import type { AvailabilityStart } from '../src/lib/mappers.js';

/* A7 bis (23/09/2026) — fusion des disponibilités des terrains d'un même sport : un départ existe dès
   qu'UN terrain est libre, chaque format n'apparaît qu'une fois et garde le fieldId du terrain à réserver. */

const quote = (amount: number) => ({ total: total(amount), bands: [{ fromMin: 0, toMin: 90, rate: perHour(amount), amount }] });
const start = (startMin: number, fieldId: string, formats: [MatchFormat, number][]): AvailabilityStart => ({
  startMin,
  byFormat: formats.map(([format, totalDa]) => ({ format, fieldId, totalDa, peak: false, quote: quote(totalDa) })),
});

const t1 = {
  fieldId: 't1',
  starts: [start(600, 't1', [['5v5', 3000], ['6v6', 6000]]), start(660, 't1', [['5v5', 3000], ['6v6', 6000]])],
  formats: [{ format: '5v5' as const, hourlyRateDa: 3000 }, { format: '6v6' as const, hourlyRateDa: 6000 }],
};
const t2 = {
  fieldId: 't2',
  starts: [start(600, 't2', [['7v7', 9000]]), start(720, 't2', [['7v7', 9000]])],
  formats: [{ format: '7v7' as const, hourlyRateDa: 9000 }],
};

describe('mergeFieldAvailabilities', () => {
  it('un départ propose les formats de TOUS les terrains libres, chacun avec son terrain', () => {
    const { starts } = mergeFieldAvailabilities([t1, t2]);
    const at600 = starts.find((s) => s.startMin === 600)!;
    expect(at600.byFormat.map((f) => [f.format, f.fieldId])).toEqual([['5v5', 't1'], ['6v6', 't1'], ['7v7', 't2']]);
  });

  it('un départ libre sur un seul terrain reste proposé, avec les seuls formats de ce terrain', () => {
    const { starts } = mergeFieldAvailabilities([t1, t2]);
    expect(starts.find((s) => s.startMin === 660)!.byFormat.map((f) => f.fieldId)).toEqual(['t1', 't1']);
    expect(starts.find((s) => s.startMin === 720)!.byFormat.map((f) => [f.format, f.fieldId])).toEqual([['7v7', 't2']]);
  });

  it('les départs sortent triés, sans doublon', () => {
    expect(mergeFieldAvailabilities([t2, t1]).starts.map((s) => s.startMin)).toEqual([600, 660, 720]);
  });

  it('même format sur deux terrains libres : le PREMIER de la liste gagne (T1 avant T2)', () => {
    const b = { fieldId: 'b', starts: [start(600, 'b', [['5v5', 3300]])], formats: [{ format: '5v5' as const, hourlyRateDa: 3300 }] };
    const a = { fieldId: 'a', starts: [start(600, 'a', [['5v5', 3000]])], formats: [{ format: '5v5' as const, hourlyRateDa: 3000 }] };
    const merged = mergeFieldAvailabilities([a, b]);
    expect(merged.starts[0]!.byFormat).toHaveLength(1);
    expect(merged.starts[0]!.byFormat[0]!.fieldId).toBe('a');
    expect(merged.formats).toEqual([{ format: '5v5', hourlyRateDa: 3000 }]);
  });

  it('le premier terrain pris à cet instant : le format bascule sur le second, au prix du second', () => {
    const a = { fieldId: 'a', starts: [], formats: [{ format: '5v5' as const, hourlyRateDa: 3000 }] };
    const b = { fieldId: 'b', starts: [start(600, 'b', [['5v5', 3300]])], formats: [{ format: '5v5' as const, hourlyRateDa: 3300 }] };
    const entry = mergeFieldAvailabilities([a, b]).starts[0]!.byFormat[0]!;
    expect([entry.fieldId, entry.totalDa]).toEqual(['b', 3300]);
  });

  it('les formats sont l’union des terrains, sans doublon', () => {
    expect(mergeFieldAvailabilities([t1, t2]).formats.map((f) => f.format)).toEqual(['5v5', '6v6', '7v7']);
  });

  it('aucun terrain → rien', () => {
    expect(mergeFieldAvailabilities([])).toEqual({ starts: [], formats: [] });
  });
});
