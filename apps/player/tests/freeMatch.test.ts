import { describe, expect, it } from 'vitest';
import { FREE_DURATIONS, FREE_FORMATS, firstOpenPeriod, freeMatchTitle, freePlaceName, freeStarts, partnerSuggestions } from '../src/lib/freeMatch.js';

/* Lot « Match libre », phase 5 — logique pure du parcours W1 à W4. */

const day = new Date(2026, 10, 20).getTime();   // vendredi 20 novembre, minuit local
const at = (h: number, m = 0) => day + (h * 60 + m) * 60_000;

describe('W3 — les heures proposées', () => {
  it('soir : de 18:00 à 23:00 par demi-heure, un autre jour', () => {
    const s = freeStarts(day, 'soir', at(0) - 86_400_000);
    expect(s[0]).toBe(18 * 60);
    expect(s[s.length - 1]).toBe(23 * 60);
    expect(s).toHaveLength(11);
    expect(s.every((m) => m % 30 === 0)).toBe(true);
  });
  it('aujourd’hui : jamais à moins de 2 h (le core refuserait)', () => {
    const s = freeStarts(day, 'soir', at(17, 10));
    expect(s[0]).toBe(19 * 60 + 30);   // 19:30 = 17:10 + 2 h 20 ; 19:00 n'est qu'à 1 h 50
    expect(freeStarts(day, 'soir', at(16, 0))[0]).toBe(18 * 60 + 30);   // 18:00 pile à 2 h : refusé, comme le core
  });
  it('période par défaut : le soir ; aucune quand la journée est passée', () => {
    expect(firstOpenPeriod(day, at(9))).toBe('soir');
    expect(firstOpenPeriod(day, at(22, 30))).toBeNull();
  });
  it('durées et formats : ceux du core (W3 : 1 h, 1 h 30, 2 h ; W4 : 5V5 à 11V11, 9V9 compris)', () => {
    expect(FREE_DURATIONS).toEqual([60, 90, 120]);
    expect(FREE_FORMATS).toEqual(['5v5', '6v6', '7v7', '8v8', '9v9', '11v11']);
  });
});

describe('W1/W2 — le lieu', () => {
  it('un lieu saisi : nettoyé, 2 à 80 caractères', () => {
    expect(freePlaceName('  Stade   Ben Aknoun ')).toBe('Stade Ben Aknoun');
    expect(freePlaceName(' x ')).toBeNull();
    expect(freePlaceName('a'.repeat(81))).toBeNull();
  });
  it('le nom du match : le lieu, rallongé du format s’il est trop court ; 40 caractères au plus', () => {
    expect(freeMatchTitle('Terrain de Bab Ezzouar', '5v5')).toBe('Terrain de Bab Ezzouar');
    expect(freeMatchTitle('BZ', '7v7')).toBe('BZ 7V7');
    expect(freeMatchTitle('a'.repeat(60), '5v5')).toHaveLength(40);
  });
  it('suggestions : les centres partenaires dont le nom contient le texte, sans accents ni casse', () => {
    const venues = [{ name: 'Stade Hydra Foot' }, { name: 'Complexe El Biar Sports' }, { name: 'Green Arena Sport' }];
    expect(partnerSuggestions(venues, 'hydra').map((v) => v.name)).toEqual(['Stade Hydra Foot']);
    expect(partnerSuggestions(venues, 'SPORT').map((v) => v.name)).toEqual(['Complexe El Biar Sports', 'Green Arena Sport']);
    expect(partnerSuggestions(venues, '  ')).toEqual([]);
  });
});
