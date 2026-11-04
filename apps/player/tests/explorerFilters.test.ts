import { describe, expect, it } from 'vitest';
import {
  FORMAT_CHOICES, applyWhen, freeSlotsLabel, matchFilterCount, partnerCountLabel, placesLabel, sportChipLabel, toggleIn, whenOf,
} from '../src/lib/explorerFilters.js';

/* Page « Filtres » et onglet Terrains d'Explorer (Lot 5, 25/10/2026). */

const TODAY = new Date(2026, 9, 25).getTime();
const TOMORROW = new Date(2026, 9, 26).getTime();
// Dictionnaire arabe minimal : le gabarit de la maquette (« 4 مراكز شريكة » → « {n} مراكز شريكة »).
const ar: Record<string, string> = {
  '{n} centres partenaires': '{n} مراكز شريكة', 'Centres partenaires': 'مراكز شريكة',
  '{n} places libres': '{n} أماكن متاحة', 'Encore {n} créneaux': 'بقيت {n} مواعيد', 'Plus que {n} créneaux': 'بقيت {n} مواعيد فقط',
};
const tAr = (k: string) => ar[k] ?? k;
const tFr = (k: string) => k;

describe('« Quand ? » ↔ filtre rapide + jour du bandeau', () => {
  it('chaque choix écrit l’état existant du fil', () => {
    expect(applyWhen('aujourdhui', TODAY, TOMORROW)).toEqual({ quick: 'tous', day: TODAY }); // le jour d'aujourd'hui du bandeau
    expect(applyWhen('cesoir', TODAY, TOMORROW)).toEqual({ quick: 'cesoir', day: 'ALL' });
    expect(applyWhen('weekend', TODAY, TOMORROW)).toEqual({ quick: 'weekend', day: 'ALL' });
    expect(applyWhen('demain', TODAY, TOMORROW)).toEqual({ quick: 'tous', day: TOMORROW });
    expect(applyWhen(null, TODAY, TOMORROW)).toEqual({ quick: 'tous', day: 'ALL' });
  });
  it('et l’état du fil redonne le choix (aller-retour sans perte)', () => {
    for (const w of ['aujourdhui', 'cesoir', 'weekend', 'demain'] as const) {
      const s = applyWhen(w, TODAY, TOMORROW);
      expect(whenOf(s.quick, s.day, TODAY, TOMORROW)).toBe(w);
    }
    expect(whenOf('tous', 'ALL', TODAY, TOMORROW)).toBeNull();
    expect(whenOf('aujourdhui', 'ALL', TODAY, TOMORROW)).toBe('aujourdhui'); // l'ancien filtre rapide reste reconnu
  });
  it('un autre jour du bandeau n’est aucun des quatre choix', () => {
    expect(whenOf('tous', TOMORROW + 3 * 86_400_000, TODAY, TOMORROW)).toBeNull();
  });
});

describe('compteur et sélection multiple', () => {
  it('compte les groupes posés, pas les valeurs', () => {
    expect(matchFilterCount({ city: null, when: null, levels: [], formats: [], spots: false })).toBe(0);
    expect(matchFilterCount({ city: 'ORAN', when: 'cesoir', levels: ['LOISIR', 'COMPETITION'], formats: ['5v5', '7v7'], spots: true })).toBe(5);
    // « Aujourd'hui » est l'état de départ : il ne compte pas
    expect(matchFilterCount({ city: null, when: 'aujourdhui', levels: [], formats: [], spots: false })).toBe(0);
  });
  it('toggleIn : ajoute, retire, garde l’ordre de la maquette', () => {
    expect(toggleIn([], '7v7', FORMAT_CHOICES)).toEqual(['7v7']);
    expect(toggleIn(['7v7'], '5v5', FORMAT_CHOICES)).toEqual(['5v5', '7v7']);
    expect(toggleIn(['5v5', '7v7'], '5v5', FORMAT_CHOICES)).toEqual(['7v7']);
  });
  it('puces de sport courtes', () => {
    expect(sportChipLabel('FOOTBALL')).toBe('Foot');
    expect(sportChipLabel('PADEL')).toBe('Padel');
  });
});

describe('libellés accordés', () => {
  it('français : pluriels accordés, jamais « (s) »', () => {
    expect(partnerCountLabel(1, tFr, 'fr')).toBe('1 centre partenaire');
    expect(partnerCountLabel(4, tFr, 'fr')).toBe('4 centres partenaires');
    expect(freeSlotsLabel(1, tFr, 'fr')).toBe('Plus que 1 créneau');
    expect(freeSlotsLabel(3, tFr, 'fr')).toBe('Plus que 3 créneaux');
    expect(freeSlotsLabel(4, tFr, 'fr')).toBe('Encore 4 créneaux');
    expect(freeSlotsLabel(0, tFr, 'fr')).toBeNull();
  });
  it('arabe : gabarit de la maquette de 3 à 10, jamais une grammaire fausse en dehors', () => {
    expect(partnerCountLabel(4, tAr, 'ar')).toBe('4 مراكز شريكة');
    expect(partnerCountLabel(10, tAr, 'ar')).toBe('10 مراكز شريكة');
    expect(partnerCountLabel(1, tAr, 'ar')).toBe('مراكز شريكة');
    expect(partnerCountLabel(11, tAr, 'ar')).toBe('مراكز شريكة');
    expect(freeSlotsLabel(4, tAr, 'ar')).toBe('بقيت 4 مواعيد');
    expect(freeSlotsLabel(3, tAr, 'ar')).toBe('بقيت 3 مواعيد فقط');
    expect(freeSlotsLabel(2, tAr, 'ar')).toBeNull();
    expect(freeSlotsLabel(12, tAr, 'ar')).toBeNull();
  });
});

describe('places libres (Recherche)', () => {
  it('français accordé, arabe de 3 à 10 seulement, rien si complet', () => {
    expect(placesLabel(1, tFr, 'fr')).toBe('1 place libre');
    expect(placesLabel(3, tFr, 'fr')).toBe('3 places libres');
    expect(placesLabel(0, tFr, 'fr')).toBeNull();
    expect(placesLabel(3, tAr, 'ar')).toBe('3 أماكن متاحة');
    expect(placesLabel(2, tAr, 'ar')).toBeNull();
    expect(placesLabel(11, tAr, 'ar')).toBeNull();
  });
});
