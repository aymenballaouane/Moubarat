import { describe, expect, it } from 'vitest';
import { venueStatusTransition, type VenueStatus } from '../src/index.js';

describe('workflow de validation d\'un centre (SUPERADMIN)', () => {
  it('transitions autorisées', () => {
    expect(venueStatusTransition('PENDING', 'ACTIVE').ok).toBe(true);
    expect(venueStatusTransition('PENDING', 'REJECTED').ok).toBe(true);
    expect(venueStatusTransition('ACTIVE', 'SUSPENDED').ok).toBe(true);
    expect(venueStatusTransition('SUSPENDED', 'ACTIVE').ok).toBe(true);
  });

  it('transitions refusées — le serveur est l\'autorité, pas un bouton', () => {
    const bad: [VenueStatus, VenueStatus][] = [
      ['PENDING', 'SUSPENDED'],   // il faut d'abord être actif
      ['ACTIVE', 'PENDING'],      // on ne revient jamais en arrière
      ['ACTIVE', 'REJECTED'],     // rejeter n'a de sens qu'avant activation
      ['REJECTED', 'ACTIVE'],     // décision terminale en V1
      ['REJECTED', 'PENDING'],
      ['SUSPENDED', 'REJECTED'],
      ['SUSPENDED', 'PENDING'],
    ];
    for (const [from, to] of bad) {
      const r = venueStatusTransition(from, to);
      expect(r.ok, `${from} → ${to}`).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_TRANSITION');
    }
  });

  it('rester sur place est toujours refusé (pas une transition)', () => {
    for (const s of ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const) {
      expect(venueStatusTransition(s, s).ok).toBe(false);
    }
  });
});
