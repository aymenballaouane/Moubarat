import { describe, expect, it } from 'vitest';
import { arabicPluralCase, pluralText } from '../src/lib/i18n.js';
import translations from '../../../refonte-app-joueur/i18n/fr-ar.json';

/* Lot « Match libre » (16/11/2026, dossier §9) — pluriels français et arabes. Les formes arabes attendues sont celles du dossier
   (tableau « Les pluriels arabes ») et de fr-ar-match-libre.json. */

describe('arabicPluralCase — les quatre cas du dossier', () => {
  it('1, 2, 3 à 10, 11 et plus', () => {
    expect(arabicPluralCase(1)).toBe('1');
    expect(arabicPluralCase(2)).toBe('2');
    for (const n of [3, 4, 9, 10]) expect(arabicPluralCase(n)).toBe('3-10');
    for (const n of [11, 14, 22, 100]) expect(arabicPluralCase(n)).toBe('11+');
  });
});

describe('pluralText — exemples du dossier', () => {
  it('« Trouver N joueurs »', () => {
    expect(pluralText('Trouver {n} joueurs', 1, 'ar')).toBe('اعثر على لاعب واحد');
    expect(pluralText('Trouver {n} joueurs', 2, 'ar')).toBe('اعثر على لاعبين');
    expect(pluralText('Trouver {n} joueurs', 6, 'ar')).toBe('اعثر على 6 لاعبين');
    expect(pluralText('Trouver {n} joueurs', 13, 'ar')).toBe('اعثر على 13 لاعبًا');
    expect(pluralText('Trouver {n} joueurs', 1, 'fr')).toBe('Trouver 1 joueur');
    expect(pluralText('Trouver {n} joueurs', 9, 'fr')).toBe('Trouver 9 joueurs');
  });

  it('« N places » et « Il manque encore N joueurs »', () => {
    expect(pluralText('{n} places', 1, 'ar')).toBe('مكان واحد');
    expect(pluralText('{n} places', 2, 'ar')).toBe('مكانان');
    expect(pluralText('{n} places', 4, 'ar')).toBe('4 أماكن');
    expect(pluralText('{n} places', 12, 'ar')).toBe('12 مكانًا');
    expect(pluralText('{n} places', 1, 'fr')).toBe('1 place');
    expect(pluralText('{n} places', 6, 'fr')).toBe('6 places');
    expect(pluralText('Il manque encore {n} joueurs', 2, 'ar')).toBe('ينقص لاعبان');
    expect(pluralText('Il manque encore {n} joueurs', 5, 'ar')).toBe('ينقص 5 لاعبين');
  });

  it('« Voir N matchs de plus » et « Plus que N places à remplir »', () => {
    expect(pluralText('Voir {n} matchs de plus', 5, 'fr')).toBe('Voir 5 matchs de plus');
    expect(pluralText('Voir {n} matchs de plus', 1, 'fr')).toBe('Voir 1 match de plus');
    expect(pluralText('Voir {n} matchs de plus', 5, 'ar')).toBe('عرض 5 مباريات أخرى');
    expect(pluralText('Plus que {n} places à remplir', 9, 'fr')).toBe('Plus que 9 places à remplir');
    expect(pluralText('Plus que {n} places à remplir', 9, 'ar')).toBe('بقي 9 أماكن شاغرة');
  });

  it('chaque texte du bloc « pluriels » a ses deux formes françaises et ses quatre formes arabes, chacune avec {n} quand le nombre s’écrit', () => {
    const blocks = Object.entries(translations.pluriels).filter(([k]) => !k.startsWith('_')) as [string, { fr: Record<string, string>; ar: Record<string, string> }][];
    expect(blocks.length).toBe(5);
    for (const [key, forms] of blocks) {
      expect(Object.keys(forms.fr).sort(), key).toEqual(['1', 'autre']);
      expect(Object.keys(forms.ar).sort(), key).toEqual(['1', '11+', '2', '3-10']);
      expect(forms.fr.autre, key).toContain('{n}');
      expect(forms.ar['3-10'], key).toContain('{n}');
      expect(forms.ar['11+'], key).toContain('{n}');
    }
  });

  it('une clé inconnue retombe sur la clé, nombre rempli — jamais de « (s) » ni de plantage', () => {
    expect(pluralText('Texte {n} inconnu', 3, 'ar')).toBe('Texte 3 inconnu');
  });
});
