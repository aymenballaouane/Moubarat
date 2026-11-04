import { describe, expect, it } from 'vitest';
import { FREE_FAILURES, MAX_DELAY_MS, loginDelayMs, waitLabel } from '../src/lib/login-throttle.js';

/* Décision d'Aymen (27/10/2026) — le barème du ralentissement progressif (fonction pure). */
describe('loginDelayMs — le délai double à chaque échec', () => {
  it('aucune pénalité pour les deux premières fautes ; puis 2 s, 4 s, 8 s, 16 s…', () => {
    expect([1, 2].map(loginDelayMs)).toEqual([0, 0]);
    expect(FREE_FAILURES).toBe(2);
    expect([3, 4, 5, 6, 7].map(loginDelayMs)).toEqual([2000, 4000, 8000, 16000, 32000]);
  });
  it('plafonné à 15 minutes, jamais de dépassement ni de valeur infinie même après des milliers d’échecs', () => {
    expect(loginDelayMs(12)).toBe(MAX_DELAY_MS);
    expect(loginDelayMs(1000)).toBe(MAX_DELAY_MS);
    expect(Number.isFinite(loginDelayMs(1_000_000))).toBe(true);
  });
  it('l’attente se lit en secondes puis en minutes', () => {
    expect(waitLabel(1)).toBe('1 seconde');
    expect(waitLabel(8000)).toBe('8 secondes');
    expect(waitLabel(61_000)).toBe('2 minutes');
  });
});
