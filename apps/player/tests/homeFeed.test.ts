import { describe, expect, it } from 'vitest';
import { MATCH_LOCK_BEFORE_MS, perPlayer, type Match, type MatchFormat, type MatchPlayer } from '@moubarat/core';
import { HOME_JOIN_LIMIT, homeJoinableMatches, nearbyVenues, type VenueGeoInfo } from '../src/lib/homeFeed.js';
import type { FeedEntry } from '../src/data/matchesFeedDemo.js';

/* Home › « Matchs à rejoindre » / « Terrains à proximité » — règle 11 (refonte-app-joueur/
   docs/regles.md, décisions d'Aymen du 23/10 et du 25/10/2026) : remplace lib/homeMatches.ts.
   Aujourd'hui seulement, ville du joueur, tri heure puis distance (si position accordée),
   plafond 6, aucun seuil de remplissage. */

const H = 3_600_000;
// Midi, un jour fixe — toutes les offsets en heures ci-dessous restent dans la même journée
// calendaire locale tant qu'elles restent dans [-12h, +11h], ce que chaque test respecte.
const NOW = new Date(2026, 8, 24, 12, 0, 0).getTime();
const ME = 'u-me';
const CAPACITY: Record<string, number> = { '5v5': 10, '6v6': 12, '7v7': 14, '8v8': 16, DOUBLE: 4, SIMPLE: 2 };

const VENUES: Record<string, VenueGeoInfo> = {
  alger1: { wilaya: 'Alger', lat: 36.75, lng: 3.05 },
  alger2: { wilaya: 'Alger', lat: 36.70, lng: 3.00 }, // un peu plus loin d'alger1
  oran: { wilaya: 'Oran', lat: 35.70, lng: -0.63 },
  setif1: { wilaya: 'Sétif', lat: 36.19, lng: 5.41 },
};
const venueOf = (id: string): VenueGeoInfo | undefined => VENUES[id];
const PLAYER_POS_NEAR_ALGER1 = { lat: 36.752, lng: 3.051 }; // quasi collé à alger1

function entry(id: string, over: {
  inH?: number; format?: MatchFormat; joined?: number; status?: Match['status'];
  visibility?: Match['visibility']; organizerId?: string; members?: string[]; venueId?: string;
} = {}): FeedEntry {
  const format = over.format ?? '5v5';
  const capacity = CAPACITY[format]!;
  const start = NOW + (over.inH ?? 10) * H;
  const joined = over.joined ?? Math.ceil(capacity / 2);
  const players: MatchPlayer[] = [
    ...(over.members ?? []).map((userId) => ({ matchId: id, userId, status: 'JOINED' as const, joinedAt: NOW })),
    ...Array.from({ length: Math.max(0, joined - (over.members ?? []).length) }, (_, i) => ({ matchId: id, userId: `${id}-p${i}`, status: 'JOINED' as const, joinedAt: NOW })),
  ];
  const match: Match = {
    id, sport: format === 'DOUBLE' || format === 'SIMPLE' ? 'PADEL' : 'FOOTBALL', format, level: 'LOISIR', title: `Match ${id}`,
    venueId: over.venueId ?? 'alger1', fieldId: 'f', range: { start, end: start + 90 * 60_000 }, capacity, pricePerPlayer: perPlayer(500),
    visibility: over.visibility ?? 'OPEN', status: over.status ?? 'OPEN', organizerId: over.organizerId ?? `${id}-org`,
    coordination: { kind: 'WHATSAPP' }, createdAt: NOW,
  };
  return { match, players };
}
const ids = (list: readonly FeedEntry[]) => list.map((e) => e.match.id);
const pick = (entries: FeedEntry[], playerCity: string | null = null, playerPos: { lat: number; lng: number } | null = null) =>
  homeJoinableMatches(entries, ME, NOW, playerCity, venueOf, playerPos);

describe('fenêtre de temps : aujourd’hui seulement (remplace la fenêtre glissante 48 h)', () => {
  it('commence dans moins de 1 h (inscriptions closes, règle 4 : H-1) ou a commencé : jamais proposé ; entre H-2 et H-1 une place libérée reste proposée', () => {
    expect(ids(pick([entry('a', { inH: 0.5 }), entry('b', { inH: -1 })]))).toEqual([]);
    expect(ids(pick([entry('r', { inH: 1.5 })]))).toEqual(['r']);
    expect(ids(pick([entry('c', { inH: MATCH_LOCK_BEFORE_MS / H })]))).toEqual([]);
    expect(ids(pick([entry('d', { inH: MATCH_LOCK_BEFORE_MS / H + 0.01 })]))).toEqual(['d']);
  });

  it('demain (même tard ce soir passé minuit) : jamais proposé — l’Explorer garde la liste complète', () => {
    expect(ids(pick([entry('demain', { inH: 13 })]))).toEqual([]); // 24/09 12:00 + 13h = 25/09 01:00
  });

  it('plus tôt aujourd’hui mais déjà passé : jamais proposé (verrouillé ou commencé)', () => {
    expect(ids(pick([entry('matin', { inH: -5 })]))).toEqual([]);
  });
});

describe('aucun seuil de remplissage (abandonné avec la fenêtre 48 h)', () => {
  it('1 seul inscrit sur 10 places, dans 3 h aujourd’hui : proposé quand même', () => {
    expect(ids(pick([entry('vide', { inH: 3, joined: 1 })]))).toEqual(['vide']);
  });
});

describe('audit 26/10 (P1-12) — villes à accent et « Autre »', () => {
  it('un joueur de Sétif voit les matchs d’un centre « Sétif » (accent) — l’Accueil n’est plus vide', () => {
    expect(ids(pick([entry('s', { inH: 3, venueId: 'setif1' }), entry('a', { inH: 3, venueId: 'alger1' })], 'SETIF'))).toEqual(['s']);
    expect(nearbyVenues(Object.values(VENUES), 'SETIF', null).map((v) => v.wilaya)).toEqual(['Sétif']);
  });
  it('« Autre » (ville hors liste) : aucun filtre de ville — toutes villes, jamais un Accueil vide', () => {
    expect(ids(pick([entry('s', { inH: 3, venueId: 'setif1' }), entry('o', { inH: 4, venueId: 'oran' })], 'AUTRE'))).toEqual(['s', 'o']);
    expect(nearbyVenues(Object.values(VENUES), 'AUTRE', null)).toHaveLength(4);
  });
});

describe('ville du joueur', () => {
  it('ville connue : seuls les matchs des centres de cette ville sont proposés', () => {
    const list = pick([
      entry('a', { venueId: 'alger1', inH: 3 }),
      entry('b', { venueId: 'oran', inH: 3 }),
    ], 'ALGER');
    expect(ids(list)).toEqual(['a']);
  });

  it('ville inconnue (null) : aucun filtre — on ne filtre jamais sur une donnée absente', () => {
    const list = pick([
      entry('a', { venueId: 'alger1', inH: 3 }),
      entry('b', { venueId: 'oran', inH: 4 }),
    ], null);
    expect(ids(list)).toEqual(['a', 'b']);
  });
});

describe('ce qui n’est pas rejoignable', () => {
  it('complet (par statut ou par effectif), verrouillé, annulé, joué, privé : jamais proposé', () => {
    expect(ids(pick([
      entry('full-status', { status: 'FULL', joined: 10, inH: 5 }),
      entry('full-count', { joined: 10, inH: 5 }),
      entry('locked', { status: 'LOCKED', joined: 9, inH: 5 }),
      entry('cancelled', { status: 'CANCELLED', joined: 9, inH: 5 }),
      entry('played', { status: 'PLAYED', joined: 9, inH: 5 }),
      entry('private', { visibility: 'PRIVATE', joined: 9, inH: 5 }),
    ]))).toEqual([]);
  });

  it('un match où je suis déjà inscrit ou dont je suis l’organisateur n’est pas proposé', () => {
    expect(ids(pick([
      entry('inscrit', { members: [ME], joined: 6, inH: 5 }),
      entry('organise', { organizerId: ME, joined: 6, inH: 5 }),
      entry('autre', { joined: 6, inH: 5 }),
    ]))).toEqual(['autre']);
  });
});

describe('tri, plafond', () => {
  it('début le plus proche d’abord', () => {
    const list = pick([
      entry('tard', { inH: 9 }),
      entry('tot', { inH: 2.1 }),
      entry('milieu', { inH: 5 }),
    ]);
    expect(ids(list)).toEqual(['tot', 'milieu', 'tard']);
  });

  it('à heure égale, le plus proche en distance si la position est connue', () => {
    const list = pick([
      entry('loin', { inH: 5, venueId: 'alger2' }),
      entry('proche', { inH: 5, venueId: 'alger1' }),
    ], 'ALGER', PLAYER_POS_NEAR_ALGER1);
    expect(ids(list)).toEqual(['proche', 'loin']);
  });

  it('à heure égale, sans position connue : ordre stable (id), jamais planté', () => {
    const list = pick([
      entry('b', { inH: 5, venueId: 'alger2' }),
      entry('a', { inH: 5, venueId: 'alger1' }),
    ], 'ALGER', null);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it(`plafonne à ${HOME_JOIN_LIMIT} : les plus proches dans le temps gardés`, () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(`m${i}`, { inH: 3 + i * 0.5 }));
    expect(ids(pick(many))).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('ne modifie pas la liste reçue', () => {
    const input = [entry('b', { inH: 4 }), entry('a', { inH: 3 })];
    const copy = [...input];
    pick(input);
    expect(input).toEqual(copy);
  });
});

describe('nearbyVenues — « Terrains à proximité »', () => {
  const venues: (VenueGeoInfo & { id: string })[] = [
    { id: 'alger1', ...VENUES.alger1! },
    { id: 'alger2', ...VENUES.alger2! },
    { id: 'oran', ...VENUES.oran! },
  ];

  it('filtre sur la ville du joueur quand elle est connue', () => {
    expect(nearbyVenues(venues, 'ALGER', null).map((v) => v.id)).toEqual(['alger1', 'alger2']);
  });

  it('aucun filtre si la ville est inconnue', () => {
    expect(nearbyVenues(venues, null, null).map((v) => v.id)).toEqual(['alger1', 'alger2', 'oran']);
  });

  it('trie du plus proche au plus loin si la position est connue', () => {
    expect(nearbyVenues(venues, 'ALGER', PLAYER_POS_NEAR_ALGER1).map((v) => v.id)).toEqual(['alger1', 'alger2']);
  });

  it('sans position connue : garde l’ordre reçu (jamais de distance inventée)', () => {
    expect(nearbyVenues(venues, 'ALGER', null).map((v) => v.id)).toEqual(['alger1', 'alger2']);
  });

  it('ne modifie pas la liste reçue', () => {
    const copy = [...venues];
    nearbyVenues(venues, 'ALGER', PLAYER_POS_NEAR_ALGER1);
    expect(venues).toEqual(copy);
  });
});
