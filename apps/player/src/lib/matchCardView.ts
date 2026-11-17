import { activePlayers, type Match, type MatchPlayer } from '@moubarat/core';

/** L'image du haut de la carte : illustration du sport, ou logo sur fond rouge sombre. */
export type CardArtKind = 'foot' | 'padel-bleu' | 'padel-vert' | 'logo';

/* Carte de match unique de l'accueil et de l'onglet Jouer (lot « Match libre », phase 2, dossier §5, §6 et §10) — présentation PURE,
   testée isolément (tests/matchCardView.test.ts). Aucune règle métier ici : les places libres viennent du roster réel (core
   `activePlayers`), le tri du serveur. */

/** Les places libres : capacité moins inscrits actifs, jamais négatif (dossier §10, « Places libres »). */
export function freePlaces(match: Pick<Match, 'capacity'>, players: readonly MatchPlayer[]): number {
  return Math.max(0, match.capacity - activePlayers(players).length);
}

/** La pastille de places (dossier §6) : 3 ou plus → vert ; 2 → or ; 1 → « Plus que 1 place », or ; 0 → « Complet », gris.
    Le cas de 3 places suit 4 (vert) — valeur provisoire du dossier, section 11. */
export type PlacesTone = 'ok' | 'gold' | 'full';
export function placesBadge(free: number): { tone: PlacesTone; kind: 'count' | 'last' | 'full' } {
  if (free <= 0) return { tone: 'full', kind: 'full' };
  if (free === 1) return { tone: 'gold', kind: 'last' };
  if (free === 2) return { tone: 'gold', kind: 'count' };
  return { tone: 'ok', kind: 'count' };
}

/** La pastille de format (dossier §6) : « 5v5 », « 7v7 » ; au padel « Padel · Simple » / « Padel · Double ». Toujours en lettres latines,
    y compris en arabe (dossier §9). */
export function formatPill(match: Pick<Match, 'sport' | 'format'>): string {
  if (match.sport === 'PADEL') {
    if (match.format === 'SIMPLE') return 'Padel · Simple';
    if (match.format === 'DOUBLE') return 'Padel · Double';
  }
  return match.format;
}

/** L'image de la carte (dossier §6, « Les images ») pour un centre partenaire sans photo : l'illustration du sport — stade de foot ;
    court de padel bleu (Simple) ou vert (Double), comme les maquettes Acc5 / Acc6. Un sport sans illustration retombe sur le logo
    (fond rouge sombre), le repli du match libre. La photo du centre viendra en phase 6. */
export function cardArtKind(match: Pick<Match, 'sport' | 'format'> & { venueId?: string | null }): CardArtKind {
  // Match libre (phase 5) : fond rouge sombre avec le logo Moubarat (dossier §6) — un lieu libre n'est pas un centre.
  if (match.venueId === null) return 'logo';
  if (match.sport === 'FOOTBALL') return 'foot';
  if (match.sport === 'PADEL') return match.format === 'DOUBLE' ? 'padel-vert' : 'padel-bleu';
  return 'logo';
}

/** Ordre de la liste : heure de début croissante ; à heure égale, un ordre STABLE d'un affichage à l'autre (l'identifiant du match,
    comme le serveur) — dossier §6, « Match complet ». */
export function byStartThenId<T extends { match: Pick<Match, 'id' | 'range'> }>(a: T, b: T): number {
  return a.match.range.start - b.match.range.start || a.match.id.localeCompare(b.match.id);
}

/** Accueil (dossier §5) : les 4 premiers matchs, puis « Voir N matchs de plus » (N = nombre réel de matchs restants ; pas de bouton
    s'il y en a 4 ou moins), qui déroule la suite sur place. */
export const HOME_FIRST_VIEW = 4;
export function homeListSlices<T>(entries: readonly T[], expanded: boolean): { visible: T[]; remaining: number } {
  const remaining = Math.max(0, entries.length - HOME_FIRST_VIEW);
  return { visible: expanded || remaining === 0 ? [...entries] : entries.slice(0, HOME_FIRST_VIEW), remaining: expanded ? 0 : remaining };
}
