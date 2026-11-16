import { describe, expect, it } from 'vitest';
import type { MatchPlayer } from '@moubarat/core';
import { HOME_FIRST_VIEW, byStartThenId, cardArtKind, formatPill, freePlaces, homeListSlices, placesBadge } from '../src/lib/matchCardView.js';

/* Lot « Match libre », phase 2 — carte de match de l'accueil et de l'onglet Jouer (dossier §5, §6, §10 ; planches Cd2, Acc5, Acc6, Jo1). */

const joined = (n: number, left = 0): MatchPlayer[] => [
  ...Array.from({ length: n }, (_, i) => ({ matchId: 'm', userId: `u${i}`, status: 'JOINED' as const, joinedAt: i })),
  ...Array.from({ length: left }, (_, i) => ({ matchId: 'm', userId: `l${i}`, status: 'LEFT' as const, joinedAt: i })),
];

describe('places libres et pastille', () => {
  it('capacité moins inscrits ACTIFS (un joueur parti libère sa place), jamais négatif', () => {
    expect(freePlaces({ capacity: 10 }, joined(4, 3))).toBe(6);
    expect(freePlaces({ capacity: 2 }, joined(3))).toBe(0);
  });
  it('3 places ou plus : vert ; 2 : or ; 1 : « Plus que 1 place », or ; 0 : « Complet », gris', () => {
    expect(placesBadge(6)).toEqual({ tone: 'ok', kind: 'count' });
    expect(placesBadge(3)).toEqual({ tone: 'ok', kind: 'count' });   // valeur provisoire du dossier : 3 suit 4
    expect(placesBadge(2)).toEqual({ tone: 'gold', kind: 'count' });
    expect(placesBadge(1)).toEqual({ tone: 'gold', kind: 'last' });
    expect(placesBadge(0)).toEqual({ tone: 'full', kind: 'full' });
  });
});

describe('pastille de format et image', () => {
  it('foot : « 5v5 », « 7v7 » ; padel : « Padel · Simple » / « Padel · Double »', () => {
    expect(formatPill({ sport: 'FOOTBALL', format: '5v5' })).toBe('5v5');
    expect(formatPill({ sport: 'FOOTBALL', format: '11v11' })).toBe('11v11');
    expect(formatPill({ sport: 'PADEL', format: 'SIMPLE' })).toBe('Padel · Simple');
    expect(formatPill({ sport: 'PADEL', format: 'DOUBLE' })).toBe('Padel · Double');
  });
  it('centre sans photo : stade de foot ; padel bleu en simple, vert en double (Acc5, Acc6) ; sinon le logo', () => {
    expect(cardArtKind({ sport: 'FOOTBALL', format: '7v7' })).toBe('foot');
    expect(cardArtKind({ sport: 'PADEL', format: 'SIMPLE' })).toBe('padel-bleu');
    expect(cardArtKind({ sport: 'PADEL', format: 'DOUBLE' })).toBe('padel-vert');
    expect(cardArtKind({ sport: 'BASKET', format: '3v3' })).toBe('logo');
  });
});

describe('ordre et découpe de la liste de l’accueil', () => {
  const e = (id: string, start: number) => ({ match: { id, range: { start, end: start + 1 } } });
  it('heure de début croissante ; à heure égale, ordre stable par identifiant (le même à chaque affichage)', () => {
    const list = [e('c', 20), e('b', 10), e('a', 20), e('d', 5)];
    expect([...list].sort(byStartThenId).map((x) => x.match.id)).toEqual(['d', 'b', 'a', 'c']);
    expect([...list].reverse().sort(byStartThenId).map((x) => x.match.id)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('4 cartes d’abord, puis « Voir N matchs de plus » avec le nombre réel ; déroulé : tout, plus de bouton', () => {
    const nine = Array.from({ length: 9 }, (_, i) => i);
    expect(HOME_FIRST_VIEW).toBe(4);
    expect(homeListSlices(nine, false)).toEqual({ visible: [0, 1, 2, 3], remaining: 5 });
    expect(homeListSlices(nine, true)).toEqual({ visible: nine, remaining: 0 });
  });
  it('4 matchs ou moins : pas de bouton, tout est visible', () => {
    expect(homeListSlices([1, 2, 3, 4], false)).toEqual({ visible: [1, 2, 3, 4], remaining: 0 });
    expect(homeListSlices([1], false)).toEqual({ visible: [1], remaining: 0 });
    expect(homeListSlices([], false)).toEqual({ visible: [], remaining: 0 });
  });
});
