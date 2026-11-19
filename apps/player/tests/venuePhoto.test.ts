import { describe, expect, it } from 'vitest';
import { venuePhotoUrl } from '../src/lib/venuePhoto.js';

/* Phase photos (17/11/2026) — l'adresse de la photo d'un centre ; sans photo, aucun lien : l'écran affiche le logo Moubarat. */
describe('venuePhotoUrl', () => {
  it('sans centre ou sans photo : null', () => {
    expect(venuePhotoUrl(null, 3, 'card')).toBeNull();
    expect(venuePhotoUrl('v1', null, 'card')).toBeNull();
    expect(venuePhotoUrl('v1', undefined, 'large')).toBeNull();
  });
  it('avec photo : la taille demandée et la version dans l’adresse (cache sans jamais d’ancienne photo)', () => {
    expect(venuePhotoUrl('v1', 3, 'card')).toMatch(/\/venues\/v1\/photo\/card\?v=3$/);
    expect(venuePhotoUrl('v1', 4, 'large')).toMatch(/\/venues\/v1\/photo\/large\?v=4$/);
  });
});
