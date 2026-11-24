import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayShort, dayTitle } from '../src/lib/bookingsDetail.js';
import { applyLang } from '../src/lib/lang.js';

beforeEach(() => { vi.stubGlobal('document', { documentElement: { setAttribute: () => undefined } }); applyLang('fr'); }); // tests sans navigateur
afterEach(() => { applyLang('fr'); vi.unstubAllGlobals(); });

describe('dayShort / dayTitle (design P3-20, P1-4)', () => {
  it('étiquette courte sous une barre de tendance', () => {
    expect(dayShort('2026-11-23')).toBe('Lun 23');
    expect(dayShort('2026-11-01')).toBe('Dim 1');
  });
  it('titre de navigation : toujours la date', () => {
    expect(dayTitle('2026-11-24')).toBe('Mar. 24 nov.');
  });
  it('arabe : jour/mois en chiffres 0-9', () => {
    applyLang('ar');
    expect(dayShort('2026-11-23')).toBe('23/11');
  });
});
