import { describe, expect, it } from 'vitest';
import { distanceKmText, haversineKm } from '../src/lib/distance.js';

/* Règle 33 — la distance « à X km » de la fiche d'un match : calculée sur le téléphone, un chiffre après la virgule, FR et AR. */

describe('distanceKmText', () => {
  it('français : virgule décimale, « km »', () => {
    expect(distanceKmText(3.4, 'fr')).toBe('3,4 km');
    expect(distanceKmText(12, 'fr')).toBe('12,0 km');
  });
  it('arabe : chiffres occidentaux, « كم »', () => {
    expect(distanceKmText(3.4, 'ar')).toMatch(/^3[,.٫]4 كم$/);
    expect(distanceKmText(2.14, 'ar')).toMatch(/^2[,.٫]1 كم$/);
  });
  it('arrondi à 100 m ; jamais « 0,0 km »', () => {
    expect(distanceKmText(3.449, 'fr')).toBe('3,4 km');
    expect(distanceKmText(3.45, 'fr')).toBe('3,5 km');
    expect(distanceKmText(0.01, 'fr')).toBe('0,1 km');
  });
  it('haversineKm : Alger – Blida ≈ 38 km (à vol d’oiseau)', () => {
    const km = haversineKm({ lat: 36.7538, lng: 3.0588 }, { lat: 36.47, lng: 2.83 });
    expect(km).toBeGreaterThan(35);
    expect(km).toBeLessThan(40);
  });
});
