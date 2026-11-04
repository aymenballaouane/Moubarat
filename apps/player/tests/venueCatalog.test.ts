import { describe, expect, it } from 'vitest';
import { fieldForFormat, fieldsForSport, formatChoicesFor, sportChoicesFor } from '../src/lib/venueCatalog.js';
import type { VenueDetail } from '../src/state/store.js';

/* A7 bis (23/09/2026) — l'affectation AUTOMATIQUE du terrain se décide par (sport, format), pas par sport
   seul : le centre pilote a T1 (5v5/6v6) ET T2 (7v7), deux terrains de foot que seul le format distingue.
   La première version de A7 prenait « le premier terrain du sport » — T2 n'était jamais atteignable. */

const field = (id: string, name: string, sport: string, formats: string[], status = 'ACTIVE'): VenueDetail['fields'][number] => ({
  id, name, sport, formats, hourlyRateDa: 3000, status,
  formatPrices: formats.map((format) => ({ format, hourlyRateDa: 3000 })),
  surface: null, sizeLabel: null, indoor: false, pricingRules: [],
});

const venue = (fields: VenueDetail['fields']): VenueDetail => ({
  id: 'v', name: 'Centre', wilaya: 'Alger', address: '', phone: null, lat: null, lng: null, description: null,
  equipments: [], photos: [], fields, openingHours: [], rating: { avg: null, count: 0, visible: false, minCount: 5 },
});

const pilot = venue([
  field('t3', 'T3', 'PADEL', ['DOUBLE', 'SIMPLE']),
  field('t2', 'T2', 'FOOTBALL', ['7v7']),
  field('t1', 'T1', 'FOOTBALL', ['5v5', '6v6']),
  field('t4', 'T4', 'PADEL', ['DOUBLE'], 'ARCHIVED'),
]);

describe('affectation automatique du terrain', () => {
  it('les terrains d’un sport sont actifs uniquement, dans l’ordre de remplissage (par nom)', () => {
    expect(fieldsForSport(pilot, 'FOOTBALL').map((f) => f.id)).toEqual(['t1', 't2']);
    expect(fieldsForSport(pilot, 'PADEL').map((f) => f.id)).toEqual(['t3']);
    expect(fieldsForSport(pilot, 'BASKET')).toEqual([]);
    expect(fieldsForSport(null, 'FOOTBALL')).toEqual([]);
  });

  it('le format décide du terrain : 5v5 et 6v6 → T1, 7v7 → T2 (T2 est atteignable)', () => {
    expect(fieldForFormat(pilot, 'FOOTBALL', '5v5')?.id).toBe('t1');
    expect(fieldForFormat(pilot, 'FOOTBALL', '6v6')?.id).toBe('t1');
    expect(fieldForFormat(pilot, 'FOOTBALL', '7v7')?.id).toBe('t2');
    expect(fieldForFormat(pilot, 'PADEL', 'SIMPLE')?.id).toBe('t3');
  });

  it('un format que le sport ne propose pas → aucun terrain, jamais un terrain par défaut', () => {
    expect(fieldForFormat(pilot, 'FOOTBALL', '11v11')).toBeUndefined();
    expect(fieldForFormat(pilot, 'PADEL', '5v5')).toBeUndefined();
  });

  it('à format égal, le centre remplit ses terrains dans l’ordre (T1 avant T2)', () => {
    const twoFives = venue([field('b', 'T2', 'FOOTBALL', ['5v5']), field('a', 'T1', 'FOOTBALL', ['5v5'])]);
    expect(fieldForFormat(twoFives, 'FOOTBALL', '5v5')?.id).toBe('a');
  });

  it('un terrain archivé n’est jamais affecté', () => {
    expect(fieldForFormat(pilot, 'PADEL', 'DOUBLE')?.id).toBe('t3');
  });

  it('les formats proposés d’un sport sont l’union de ses terrains, sans doublon, avec leur capacité', () => {
    expect(formatChoicesFor(fieldsForSport(pilot, 'FOOTBALL'))).toEqual([
      { value: '5v5', capacity: 10 }, { value: '6v6', capacity: 12 }, { value: '7v7', capacity: 14 },
    ]);
    const dup = venue([field('a', 'T1', 'FOOTBALL', ['5v5', '6v6']), field('b', 'T2', 'FOOTBALL', ['6v6', '7v7'])]);
    expect(formatChoicesFor(fieldsForSport(dup, 'FOOTBALL')).map((f) => f.value)).toEqual(['5v5', '6v6', '7v7']);
    expect(formatChoicesFor([])).toEqual([]);
  });

  it('les sports proposés sont ceux des terrains actifs seulement', () => {
    expect(sportChoicesFor(pilot).map((s) => s.value)).toEqual(['PADEL', 'FOOTBALL']);
    expect(sportChoicesFor(venue([field('x', 'T4', 'PADEL', ['DOUBLE'], 'ARCHIVED')]))).toEqual([]);
    expect(sportChoicesFor(null)).toEqual([]);
  });
});
