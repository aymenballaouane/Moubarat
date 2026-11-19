import { describe, expect, it } from 'vitest';
import { cityCenter, placeSubtitle, wilayaForPlace, defaultFieldName, distanceKm, kmText, partnerUnderPin, partnersByDistance } from '../src/lib/places.js';
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

describe('lot B, phase 1 — distances, centre sous l’épingle, nom proposé', () => {
  const hydra = { id: 'h', lat: 36.7431, lng: 3.0446 };
  const aknoun = { id: 'a', lat: 36.7565, lng: 3.0084 };
  const sansPosition = { id: 'x', lat: null, lng: null };
  it('distance et texte en kilomètres', () => {
    const km = distanceKm(aknoun, hydra);
    expect(km).toBeGreaterThan(3.2);
    expect(km).toBeLessThan(3.8);
    expect(kmText(1.234)).toBe('1,2');
    expect(kmText(12.6)).toBe('13');
  });
  it('les centres du plus proche au plus loin ; sans position : écartés', () => {
    expect(partnersByDistance([hydra, sansPosition, aknoun], { lat: 36.757, lng: 3.009 }).map((v) => v.id)).toEqual(['a', 'h']);
  });
  it('« C’est {centre} ? » seulement à moins de 120 m', () => {
    expect(partnerUnderPin([hydra, aknoun], { lat: 36.7569, lng: 3.0086 })?.id).toBe('a');
    expect(partnerUnderPin([hydra, aknoun], { lat: 36.7600, lng: 3.0200 })).toBeNull();
  });
  it('« Terrain · {quartier} », sinon la wilaya, sinon « Terrain »', () => {
    expect(defaultFieldName('Ben Aknoun', 'Alger', 'Terrain · {quartier}')).toBe('Terrain · Ben Aknoun');
    expect(defaultFieldName(null, 'Alger', 'Terrain · {quartier}')).toBe('Terrain · Alger');
    expect(defaultFieldName(null, null, 'Terrain · {quartier}')).toBe('Terrain');
    expect(defaultFieldName('Hydra', null, 'ملعب · {quartier}')).toBe('ملعب · Hydra');
  });
});
