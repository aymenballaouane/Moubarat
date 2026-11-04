import { describe, expect, it } from 'vitest';
import {
  NO_VENUE_FILTERS, cityMatches, filterOptions, filterVenues, isPristine, sortVenuesByDistance, sortVenuesByName, type VenueFilters,
} from '../src/lib/venueFilters.js';
import type { VenueSummary } from '../src/state/store.js';

/* Explorer › Terrains (Lot 5, 25/10/2026) — rangée Tous / Foot / Padel / Libres ce soir + page « Filtres » (ville,
   sport, format) : chaque règle reste vraie même sur les cas ingrats (disponibilité inconnue, terrain archivé). */

const field = (formats: string[], status = 'ACTIVE') => ({ id: `f-${formats.join('')}`, name: 'T1', sport: 'FOOTBALL', formats, status, indoor: false, surface: null });
const v = (id: string, name: string, over: Partial<VenueSummary> = {}): VenueSummary => ({
  id, name, wilaya: 'Alger', address: 'Rue X, Alger', lat: null, lng: null, phone: null, description: null,
  equipments: [], sports: ['FOOTBALL'], formats: ['5v5'], priceFromDa: 3000,
  rating: { avg: null, count: 0, visible: false, minCount: 5 }, fields: [field(['5v5', '6v6'])] as unknown as VenueSummary['fields'], ...over,
});

const hydra = v('h', 'Stade Hydra Foot', { address: 'Rue des Frères Bouchama, Hydra' });
const kouba = v('k', 'Padel Club Kouba', { sports: ['PADEL'], fields: [{ ...field(['DOUBLE', 'SIMPLE']), sport: 'PADEL' }] as unknown as VenueSummary['fields'] });
const blida = v('b', 'Arena Blida Sport', { wilaya: 'Blida', address: 'Route de Ben Boulaïd, Blida', fields: [field(['5v5', '7v7'])] as unknown as VenueSummary['fields'] });
const setif = v('s', 'Sétif Arena', { wilaya: 'Sétif', fields: [field(['11v11'])] as unknown as VenueSummary['fields'] });
const tipaza = v('t', 'Complexe Sahel Tipaza', { wilaya: 'Tipaza', sports: ['FOOTBALL', 'PADEL'], fields: [field(['8v8'], 'ARCHIVED')] as unknown as VenueSummary['fields'] });
const all = [hydra, kouba, blida, setif, tipaza];
const ids = (list: readonly VenueSummary[]) => list.map((x) => x.id);
const F = (over: Partial<VenueFilters>): VenueFilters => ({ ...NO_VENUE_FILTERS, ...over });

describe('filtres', () => {
  it('aucun filtre → tout le catalogue', () => {
    expect(ids(filterVenues(all, NO_VENUE_FILTERS, null))).toEqual(['h', 'k', 'b', 's', 't']);
  });

  it('recherche : nom, wilaya ou adresse, sans accent ni casse', () => {
    expect(ids(filterVenues(all, F({ query: 'hydra' }), null))).toEqual(['h']);
    expect(ids(filterVenues(all, F({ query: 'BLIDA' }), null))).toEqual(['b']);
    expect(ids(filterVenues(all, F({ query: 'ben boulaid' }), null))).toEqual(['b']); // « Boulaïd » sans tréma
    expect(ids(filterVenues(all, F({ query: 'zzz' }), null))).toEqual([]);
  });

  it('sport : un centre multi-sport apparaît sous chacun de ses sports', () => {
    expect(ids(filterVenues(all, F({ sport: 'PADEL' }), null))).toEqual(['k', 't']);
    expect(ids(filterVenues(all, F({ sport: 'FOOTBALL' }), null))).toEqual(['h', 'b', 's', 't']);
  });

  it('ville : la wilaya du centre, sans accents ni casse ; « Autre ville » = hors des six', () => {
    expect(ids(filterVenues(all, F({ city: 'BLIDA' }), null))).toEqual(['b']);
    expect(ids(filterVenues(all, F({ city: 'SETIF' }), null))).toEqual(['s']); // « Sétif » en base
    expect(ids(filterVenues(all, F({ city: 'ALGER' }), null))).toEqual(['h', 'k']);
    expect(ids(filterVenues(all, F({ city: 'AUTRE' }), null))).toEqual(['t']);
    expect(cityMatches(' ORAN ', 'ORAN')).toBe(true);
    expect(cityMatches('Tizi Ouzou', 'AUTRE')).toBe(true);
    expect(cityMatches('Alger', 'AUTRE')).toBe(false);
  });

  it('format : au moins un des formats demandés, sur un terrain ACTIF (un terrain archivé ne compte pas)', () => {
    expect(ids(filterVenues(all, F({ formats: ['7v7'] }), null))).toEqual(['b']);
    expect(ids(filterVenues(all, F({ formats: ['6v6', '11v11'] }), null))).toEqual(['h', 's']);
    expect(ids(filterVenues(all, F({ formats: ['8v8'] }), null))).toEqual([]); // seul terrain 8v8 : archivé
  });

  it('libres ce soir : d’après le résumé ; inconnu → filtre ignoré, jamais « aucun libre »', () => {
    const availability = {
      h: { freeStarts: 4, nextStartMin: 1140, eveningStarts: 3 },
      k: { freeStarts: 2, nextStartMin: 600, eveningStarts: 0 },
      b: { freeStarts: 0, nextStartMin: null, eveningStarts: 0 },
    };
    expect(ids(filterVenues(all, F({ quick: 'cesoir' }), availability))).toEqual(['h']);
    expect(ids(filterVenues(all, F({ quick: 'cesoir' }), null))).toHaveLength(5);
  });

  it('les filtres se cumulent', () => {
    expect(ids(filterVenues(all, F({ sport: 'FOOTBALL', city: 'ALGER', formats: ['5v5'] }), null))).toEqual(['h']);
  });
});

describe('tri et options', () => {
  it('par nom, sans modifier la liste reçue', () => {
    const input = [kouba, hydra, blida];
    expect(ids(sortVenuesByName(input))).toEqual(['b', 'k', 'h']);
    expect(ids(input)).toEqual(['k', 'h', 'b']);
  });

  it('options : uniquement les sports qui existent dans le catalogue', () => {
    expect(filterOptions(all).sports.sort()).toEqual(['FOOTBALL', 'PADEL']);
    expect(filterOptions([hydra]).sports).toEqual(['FOOTBALL']);
  });

  it('isPristine : vrai seulement sans aucun filtre', () => {
    expect(isPristine(NO_VENUE_FILTERS)).toBe(true);
    for (const over of [{ query: 'x' }, { sport: 'PADEL' }, { quick: 'cesoir' }, { city: 'ORAN' }, { formats: ['5v5'] }] as Partial<VenueFilters>[]) {
      expect(isPristine(F(over))).toBe(false);
    }
  });
});

describe('tri par distance (règle 33)', () => {
  const at = (id: string, name: string, lat: number | null, lng: number | null) => v(id, name, { lat, lng });
  const near = at('n', 'Proche', 36.76, 3.05);
  const far = at('f', 'Loin', 36.9, 3.4);
  const unknown = at('u', 'Sans coordonnées', null, null);
  const pos = { lat: 36.75, lng: 3.04 };
  it('du plus proche au plus loin, les centres sans coordonnées après', () => {
    expect(ids(sortVenuesByDistance([unknown, far, near], pos))).toEqual(['n', 'f', 'u']);
  });
  it('sans position : par nom, jamais une distance inventée ; la liste reçue n’est pas modifiée', () => {
    const input = [far, near, unknown];
    expect(ids(sortVenuesByDistance(input, null))).toEqual(ids(sortVenuesByName(input)));
    expect(ids(input)).toEqual(['f', 'n', 'u']);
  });
});
