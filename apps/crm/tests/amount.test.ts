import { describe, expect, it } from 'vitest';
import { parseDaAmount } from '../src/lib/amount.js';

describe('MS-039 — montant de caisse saisi', () => {
  it('accepte les espaces de milliers, y compris insécables', () => {
    expect(parseDaAmount('50 000')).toBe(50000);
    expect(parseDaAmount('50\u00a0000')).toBe(50000);
    expect(parseDaAmount(' 4500 ')).toBe(4500);
    expect(parseDaAmount('0')).toBe(0);
  });
  it('vide ou non numérique : null, jamais 0', () => {
    for (const bad of ['', '   ', 'abc', '12,5', '12.5', '-300', '4 5 0 0 DA', '1e5']) expect(parseDaAmount(bad), bad).toBeNull();
  });
});
