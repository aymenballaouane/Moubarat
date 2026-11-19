import { describe, expect, it } from 'vitest';
import { communityNear, communitySuggestions, type CommunityPlace } from '../src/lib/places.js';

/* Lot B, phase 6 « Nos lieux d'abord » — recherche dans les terrains de la communauté et « C'est l'un de ces terrains ? ». */

const place = (id: string, name: string, lat: number, lng: number, matchCount = 0): CommunityPlace => ({
  id, name, area: 'Bordj El Kiffan', address: null, wilaya: 'Alger', lat, lng, verified: true, mine: false, matchCount,
});
const KOORA = place('a', 'Kooraland', 36.7466, 3.1937, 12);
const FOOT = place('b', 'Foot Center', 36.7501, 3.2001, 7);
const KIFFAN = place('c', 'Kiffan Foot', 36.76, 3.21, 3);

describe('communitySuggestions', () => {
  it('casse, accents et espaces ignorés ; les plus joués d’abord ; 3 au plus', () => {
    expect(communitySuggestions([KOORA, FOOT, KIFFAN], 'koora land').map((p) => p.id)).toEqual(['a']);
    expect(communitySuggestions([KIFFAN, FOOT], 'FOOT').map((p) => p.id)).toEqual(['b', 'c']);
    expect(communitySuggestions([KOORA], '  ')).toEqual([]);
  });
});

describe('communityNear', () => {
  it('les terrains à moins de 150 m de l’épingle, du plus proche au plus loin, distance en mètres', () => {
    const near = communityNear([KOORA, FOOT], { lat: 36.7470, lng: 3.1937 });
    expect(near.map((p) => p.id)).toEqual(['a']);
    expect(near[0]!.m).toBeGreaterThan(30);
    expect(near[0]!.m).toBeLessThan(60);
    expect(communityNear([KOORA], { lat: 36.76, lng: 3.19 })).toEqual([]);
  });
});
