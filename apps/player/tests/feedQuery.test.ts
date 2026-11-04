import { describe, expect, it } from 'vitest';
import {
  FEED_PAGE_SIZE, dayCountsQueryString, feedQueryString, feedTotalAllDaysQueryString, mergeById, type FeedParams,
} from '../src/lib/feedQuery.js';

/* Explorer › Matchs : de l'état de l'écran (sport, jour, filtre rapide, texte) aux paramètres du fil côté serveur
   (L3, 25/09/2026). Chaque cas reprend une règle de l'ancien filtre en mémoire. */

// Jour local du 24/09/2026 (mêmes getters locaux que epochDateStamp) — jamais d'heure UTC en dur.
const localDay = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
const NOW = new Date(2026, 8, 24, 14, 30).getTime();
const base: FeedParams = { sport: 'FOOTBALL', day: 'ALL', quick: 'tous', query: '' };
const params = (qs: string) => Object.fromEntries(new URLSearchParams(qs.slice(1)));

describe('feedQueryString', () => {
  it('aucun filtre : seulement le sport et la taille de page — jamais de paramètre vide', () => {
    expect(params(feedQueryString(base, NOW))).toEqual({ sport: 'FOOTBALL', limit: String(FEED_PAGE_SIZE) });
    expect(params(feedQueryString({ ...base, sport: null }, NOW))).toEqual({ limit: String(FEED_PAGE_SIZE) });
  });

  it('jour choisi dans le bandeau : `day` au format YYYY-MM-DD du jour local', () => {
    expect(params(feedQueryString({ ...base, day: localDay(2026, 9, 27) }, NOW))).toMatchObject({ day: '2026-09-27' });
  });

  it('« Aujourd’hui » : le jour choisi, à défaut aujourd’hui', () => {
    expect(params(feedQueryString({ ...base, quick: 'aujourdhui' }, NOW))).toMatchObject({ day: '2026-09-24' });
    expect(params(feedQueryString({ ...base, quick: 'aujourdhui', day: localDay(2026, 9, 26) }, NOW))).toMatchObject({ day: '2026-09-26' });
  });

  it('« Ce soir » : le même jour effectif, avec `evening=1`', () => {
    expect(params(feedQueryString({ ...base, quick: 'cesoir' }, NOW))).toMatchObject({ day: '2026-09-24', evening: '1' });
    expect(params(feedQueryString({ ...base, quick: 'cesoir', day: localDay(2026, 9, 28) }, NOW))).toMatchObject({ day: '2026-09-28', evening: '1' });
  });

  it('« Week-end » : `weekend=1`, sans jour imposé ; un jour choisi se cumule', () => {
    const all = params(feedQueryString({ ...base, quick: 'weekend' }, NOW));
    expect(all).toMatchObject({ weekend: '1' });
    expect(all).not.toHaveProperty('day');
    expect(params(feedQueryString({ ...base, quick: 'weekend', day: localDay(2026, 9, 26) }, NOW))).toMatchObject({ weekend: '1', day: '2026-09-26' });
  });

  it('texte : espaces retirés, vide ignoré, accents et caractères spéciaux encodés', () => {
    expect(params(feedQueryString({ ...base, query: '  Élite du soir ' }, NOW))).toMatchObject({ q: 'Élite du soir' });
    expect(params(feedQueryString({ ...base, query: '   ' }, NOW))).not.toHaveProperty('q');
    expect(feedQueryString({ ...base, query: 'a&b=c' }, NOW)).toContain('q=a%26b%3Dc');
  });

  it('curseur : ajouté tel quel (opaque)', () => {
    expect(params(feedQueryString(base, NOW, 'abc_-DEF'))).toMatchObject({ cursor: 'abc_-DEF' });
    expect(params(feedQueryString(base, NOW, null))).not.toHaveProperty('cursor');
  });
});

describe('feedQueryString — page « Filtres » (Lot 5)', () => {
  it('niveaux et formats en liste, ville, place : seulement s’ils sont posés', () => {
    expect(params(feedQueryString({ ...base, levels: ['LOISIR', 'COMPETITION'], formats: ['5v5', '7v7'], city: 'SETIF', spots: true }, NOW)))
      .toMatchObject({ level: 'LOISIR,COMPETITION', format: '5v5,7v7', city: 'SETIF', spots: '1' });
    const none = params(feedQueryString({ ...base, levels: [], formats: [], city: null, spots: false }, NOW));
    for (const k of ['level', 'format', 'city', 'spots']) expect(none).not.toHaveProperty(k);
  });
  it('le compteur « Tous » garde ces filtres (seul le jour saute)', () => {
    expect(params(feedTotalAllDaysQueryString({ ...base, day: localDay(2026, 9, 27), levels: ['LOISIR'], spots: true }, NOW)))
      .toMatchObject({ level: 'LOISIR', spots: '1', limit: '1' });
  });
});

describe('feedTotalAllDaysQueryString', () => {
  it('même fil sans le jour choisi et sans page : limit=1, pour lire `total` seulement', () => {
    const p = params(feedTotalAllDaysQueryString({ ...base, day: localDay(2026, 9, 27), query: 'elite', quick: 'weekend' }, NOW));
    expect(p).toEqual({ sport: 'FOOTBALL', weekend: '1', q: 'elite', limit: '1' });
  });
  it('« Ce soir » garde son jour d’ancrage (aujourd’hui) — comme l’ancien compteur « Tous »', () => {
    expect(params(feedTotalAllDaysQueryString({ ...base, quick: 'cesoir', day: localDay(2026, 9, 27) }, NOW))).toMatchObject({ day: '2026-09-24', evening: '1', limit: '1' });
  });
});

describe('dayCountsQueryString', () => {
  it('sport, premier jour du bandeau et nombre de jours', () => {
    expect(params(dayCountsQueryString('PADEL', localDay(2026, 9, 24), 14))).toEqual({ sport: 'PADEL', from: '2026-09-24', days: '14' });
    expect(params(dayCountsQueryString(null, localDay(2026, 9, 24), 7))).toEqual({ from: '2026-09-24', days: '7' });
  });
});

describe('mergeById', () => {
  const item = (id: string, v: number) => ({ id, v });
  const idOf = (t: { id: string }) => t.id;
  it('ajoute les nouveaux en fin, dans l’ordre reçu', () => {
    expect(mergeById([item('a', 1)], [item('b', 2), item('c', 3)], idOf).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('un élément déjà connu est remplacé sur place par sa version récente, jamais dupliqué', () => {
    expect(mergeById([item('a', 1), item('b', 2)], [item('b', 99), item('c', 3)], idOf)).toEqual([item('a', 1), item('b', 99), item('c', 3)]);
  });
  it('ne modifie pas ses entrées', () => {
    const cur = [item('a', 1)]; const inc = [item('a', 2)];
    mergeById(cur, inc, idOf);
    expect(cur).toEqual([item('a', 1)]);
    expect(inc).toEqual([item('a', 2)]);
  });
});
