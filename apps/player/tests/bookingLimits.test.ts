import { describe, expect, it } from 'vitest';
import { limitReached } from '../src/lib/bookingLimits.js';

/* Lot « Match libre », phase 4 — « Limite atteinte » (planche S3L). */

describe('limitReached', () => {
  const base = { maxPerDay: 2, maxUpcoming: 4, upcoming: 1, perDay: { '2026-11-20': 1 } };
  it('rien de bloqué sous les plafonds', () => {
    expect(limitReached(base, '2026-11-20')).toBeNull();
    expect(limitReached(base, '2026-11-21')).toBeNull();
  });
  it('2 réservations ce jour-là : bloqué ce jour-là seulement', () => {
    const l = { ...base, upcoming: 2, perDay: { '2026-11-20': 2 } };
    expect(limitReached(l, '2026-11-20')).toEqual({ kind: 'day', max: 2 });
    expect(limitReached(l, '2026-11-21')).toBeNull();
  });
  it('4 réservations à venir : bloqué tous les jours ; le jour passe avant (même ordre que le core)', () => {
    const l = { ...base, upcoming: 4, perDay: { '2026-11-20': 2, '2026-11-22': 1, '2026-11-23': 1 } };
    expect(limitReached(l, '2026-11-21')).toEqual({ kind: 'upcoming', max: 4 });
    expect(limitReached(l, '2026-11-20')).toEqual({ kind: 'day', max: 2 });
  });
  it('le chiffre suit le réglage du serveur (1 par jour)', () => {
    expect(limitReached({ ...base, maxPerDay: 1 }, '2026-11-20')).toEqual({ kind: 'day', max: 1 });
  });
  it('plafonds inconnus ou jour inconnu : rien (le serveur juge)', () => {
    expect(limitReached(null, '2026-11-20')).toBeNull();
    expect(limitReached(base, null)).toBeNull();
  });
});
