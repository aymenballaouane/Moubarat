import { describe, expect, it } from 'vitest';
import { outsideAlgeria, parseCoordinates } from '../src/lib/coords.js';

/* 20/09/2026, demande d'Aymen — le « point pénible » du formulaire de création de centre :
   coller « 36.7538, 3.0588 » (Google Maps) doit remplir latitude ET longitude, avec ou sans
   espace après la virgule. */

const ALGER = { lat: 36.7538, lng: 3.0588 };

describe('parseCoordinates — la position copiée depuis Google Maps', () => {
  it('avec un espace après la virgule (le format exact de Google Maps)', () => {
    expect(parseCoordinates('36.7538, 3.0588')).toEqual(ALGER);
  });

  it('SANS espace après la virgule', () => {
    expect(parseCoordinates('36.7538,3.0588')).toEqual(ALGER);
  });

  it('espaces multiples, tabulation, espace insécable, espaces autour', () => {
    expect(parseCoordinates('  36.7538 ,   3.0588  ')).toEqual(ALGER);
    expect(parseCoordinates('36.7538,\t3.0588')).toEqual(ALGER);
    expect(parseCoordinates('36.7538, 3.0588')).toEqual(ALGER);
  });

  it('séparés par un espace seul, entre parenthèses, avec le symbole degré', () => {
    expect(parseCoordinates('36.7538 3.0588')).toEqual(ALGER);
    expect(parseCoordinates('(36.7538, 3.0588)')).toEqual(ALGER);
    expect(parseCoordinates('36.7538°, 3.0588°')).toEqual(ALGER);
  });

  it('virgule décimale à la française : « 36,7538 ; 3,0588 », « 36,7538 3,0588 », « 36,7538, 3,0588 »', () => {
    expect(parseCoordinates('36,7538 ; 3,0588')).toEqual(ALGER);
    expect(parseCoordinates('36,7538;3,0588')).toEqual(ALGER);
    expect(parseCoordinates('36,7538 3,0588')).toEqual(ALGER);
    expect(parseCoordinates('36,7538, 3,0588')).toEqual(ALGER);
  });

  it('valeurs négatives (ouest / sud) et entières', () => {
    expect(parseCoordinates('-33.8688, 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(parseCoordinates('35.6971,-0.6308')).toEqual({ lat: 35.6971, lng: -0.6308 });
    expect(parseCoordinates('36, 3')).toEqual({ lat: 36, lng: 3 });
  });

  it('un lien Google Maps : @lat,lng · !3d…!4d… · ?q=lat,lng', () => {
    expect(parseCoordinates('https://www.google.com/maps/place/Alger/@36.7538,3.0588,12z')).toEqual(ALGER);
    expect(parseCoordinates('https://www.google.com/maps/place/X/data=!3d36.7538!4d3.0588')).toEqual(ALGER);
    expect(parseCoordinates('https://maps.google.com/?q=36.7538,3.0588')).toEqual(ALGER);
  });

  it('refuse ce qui n’est pas une paire de coordonnées (jamais un remplissage silencieux)', () => {
    for (const bad of ['', '   ', 'Alger', '36.7538', '36.7538, 3.0588, 12', 'abc, def', '36.7538; 3.0588; 4', '91, 3', '36, 181', '36,3', 'https://example.com']) {
      expect(parseCoordinates(bad), `« ${bad} »`).toBeNull();
    }
  });
});

describe('outsideAlgeria — avertit d’une latitude/longitude inversée', () => {
  it('Alger, Oran, Tamanrasset : dans le pays ; l’ordre inversé (3.0588, 36.7538) : signalé', () => {
    expect(outsideAlgeria(ALGER)).toBe(false);
    expect(outsideAlgeria({ lat: 35.6971, lng: -0.6308 })).toBe(false);
    expect(outsideAlgeria({ lat: 22.785, lng: 5.5228 })).toBe(false);
    expect(outsideAlgeria({ lat: 3.0588, lng: 36.7538 })).toBe(true);
    expect(outsideAlgeria({ lat: 48.8566, lng: 2.3522 })).toBe(true); // Paris
  });
});
