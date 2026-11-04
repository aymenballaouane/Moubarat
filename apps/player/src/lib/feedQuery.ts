import type { Sport } from '@moubarat/core';
import { epochDateStamp } from './format.js';

/* Explorer › Matchs — les filtres de l'écran deviennent les PARAMÈTRES du fil côté serveur (mise à l'échelle L3,
   25/09/2026, décision d'Aymen : « filtres serveur + Afficher plus »). Avant, l'app filtrait en mémoire les 50 matchs
   les plus proches : à 15 centres, un jour ou un filtre ne voyait jamais un match plus lointain que le 50ᵉ. Fonctions
   pures, sans réseau ni DOM (tests/feedQuery.test.ts). La règle de chaque filtre est celle qu'appliquait l'écran :
   - « Aujourd'hui » et « Ce soir » s'appuient sur le jour choisi dans le bandeau, à défaut sur aujourd'hui ;
   - « Ce soir » = début à 18 h ou plus tard ; « Week-end » = samedi ou dimanche ;
   - le texte cherche dans le titre et le format, sans accents ni casse (côté serveur). */

export type QuickFilter = 'tous' | 'aujourdhui' | 'cesoir' | 'weekend';

/** Villes du filtre « Où ? » (mêmes valeurs que `users.city` et que le filtre serveur `city`). */
export type CityFilter = 'ALGER' | 'ORAN' | 'CONSTANTINE' | 'ANNABA' | 'BLIDA' | 'SETIF' | 'AUTRE';

export interface FeedParams {
  sport: Sport | null;
  /** Début (ms) du jour choisi dans le bandeau de jours, ou `ALL` pour tous les jours. */
  day: number | 'ALL';
  quick: QuickFilter;
  /** Texte tapé dans la recherche (le serveur le replie : accents et casse sans importance). */
  query: string;
  /** Page « Filtres » (Lot 5) — tous optionnels, absents = pas de filtre : niveaux, formats (« l'un ou l'autre »), ville du centre,
      « seulement les matchs avec de la place ». */
  levels?: readonly string[];
  formats?: readonly string[];
  city?: CityFilter | null;
  spots?: boolean;
}

/** Taille d'une page du fil : assez pour remplir un écran et le défilement suivant, assez petite pour rester rapide. */
export const FEED_PAGE_SIZE = 30;

/** Chaîne de requête (`?a=b&c=d`) du fil pour ces paramètres — jamais de paramètre vide. `cursor` : page suivante. */
export function feedQueryString(p: FeedParams, nowMs: number, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (p.sport) qs.set('sport', p.sport);

  // Jour effectif : le jour choisi ; à défaut, aujourd'hui pour « Aujourd'hui » et « Ce soir » (comme l'ancien écran).
  const anchoredToToday = p.quick === 'aujourdhui' || p.quick === 'cesoir';
  if (p.day !== 'ALL') qs.set('day', epochDateStamp(p.day));
  else if (anchoredToToday) qs.set('day', epochDateStamp(nowMs));

  if (p.quick === 'cesoir') qs.set('evening', '1');
  if (p.quick === 'weekend') qs.set('weekend', '1');

  if (p.levels && p.levels.length > 0) qs.set('level', p.levels.join(','));
  if (p.formats && p.formats.length > 0) qs.set('format', p.formats.join(','));
  if (p.city) qs.set('city', p.city);
  if (p.spots) qs.set('spots', '1');

  const text = p.query.trim();
  if (text !== '') qs.set('q', text);

  qs.set('limit', String(FEED_PAGE_SIZE));
  if (cursor) qs.set('cursor', cursor);
  return `?${qs.toString()}`;
}

/** Même fil, sans le filtre de jour ET sans page : sert au compteur de la pastille « Tous » quand un jour précis est choisi
    (le total de la première page ne compte que ce jour-là). `limit=1` : seul `total` importe. */
export function feedTotalAllDaysQueryString(p: FeedParams, nowMs: number): string {
  return feedQueryString({ ...p, day: 'ALL' }, nowMs).replace(/limit=\d+/, 'limit=1');
}

/** Décomptes par jour du bandeau : sport seulement (comme l'ancien bandeau, indifférent au filtre rapide et au texte). */
export function dayCountsQueryString(sport: Sport | null, fromDayStartMs: number, days: number): string {
  const qs = new URLSearchParams();
  if (sport) qs.set('sport', sport);
  qs.set('from', epochDateStamp(fromDayStartMs));
  qs.set('days', String(days));
  return `?${qs.toString()}`;
}

/** Ajoute à `current` les éléments de `incoming` dont l'identifiant est nouveau, en gardant l'ordre reçu ; un
    élément déjà connu est REMPLACÉ sur place par sa version récente (le joueur peut avoir rejoint entre-temps). */
export function mergeById<T>(current: readonly T[], incoming: readonly T[], idOf: (t: T) => string): T[] {
  const fresh = new Map(incoming.map((t) => [idOf(t), t]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of current) {
    const id = idOf(t);
    seen.add(id);
    out.push(fresh.get(id) ?? t);
  }
  for (const t of incoming) {
    const id = idOf(t);
    if (!seen.has(id)) { seen.add(id); out.push(t); }
  }
  return out;
}
