import { describe, expect, it } from 'vitest';
import { cityCenter, placeSubtitle, wilayaForPlace } from '../src/lib/places.js';
import { placeMapsUrl } from '../src/lib/venueView.js';

/* Phase adresses (GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet) — logique pure de la recherche et de la carte. */
describe('adresses du match libre', () => {
  it('la carte s’ouvre sur la ville du joueur (Alger sinon)', () => {
    expect(cityCenter('ORAN')).toEqual({ lat: 35.6971, lng: -0.6308 });
    expect(cityCenter(null)).toEqual(cityCenter('ALGER'));
    expect(cityCenter('AUTRE')).toEqual(cityCenter('ALGER'));
  });
  it('wilaya : celle d’OpenStreetMap si c’est une ville de l’app (même écriture), sinon celle du joueur', () => {
    expect(wilayaForPlace('Oran', 'Alger')).toBe('Oran');
    expect(wilayaForPlace('setif', 'Alger')).toBe('Sétif');
    expect(wilayaForPlace('Tipaza', 'Alger')).toBe('Alger');
    expect(wilayaForPlace(null, 'Blida')).toBe('Blida');
  });
  it('sous-titre : détail puis wilaya, sans répétition', () => {
    expect(placeSubtitle({ detail: 'Ben Aknoun, Cité 324 lgts', wilaya: 'Alger' })).toBe('Ben Aknoun, Cité 324 lgts · Alger');
    expect(placeSubtitle({ detail: 'Alger', wilaya: 'Alger' })).toBe('Alger');
    expect(placeSubtitle({ detail: '', wilaya: null })).toBe('');
  });
  it('« Itinéraire » d’un lieu posé sur la carte : le point exact ; sans position : le nom et la ville', () => {
    expect(placeMapsUrl({ name: 'Stade', wilaya: 'Alger', lat: 36.72, lng: 3.19 })).toContain('query=36.72%2C3.19');
    expect(placeMapsUrl({ name: 'Stade', wilaya: 'Alger' })).toContain('query=Stade%2C%20Alger');
  });
});
