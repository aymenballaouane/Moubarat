/* Maquette Match — donnees fictives copiees de prototypes/app/match.html.
   Les entites (Match, MatchPlayer, Booking) suivent les types canoniques de
   @moubarat/core/entities.ts ; createMatch/joinMatch/leaveMatch/removePlayer
   viennent de rules/match-flow.ts — jamais reimplementes ici. */

import {
  FORMAT_CAPACITY, quoteRange, splitPerPlayer,
  type Match, type MatchFormat, type MatchPlayer, type SkillLevel,
} from '@moubarat/core';
import { CURRENT_USER_ID, VIEWER_ID } from './identity.js';
import { BASE_RATE, PRICING_RULES, DEMO_FORMAT } from './bookingDemo.js';
import { PEOPLE } from './people.js';
import { resolveNextWeekday } from '../lib/format.js';

/* Deux personas distinctes, fideles au prototype : sur l'ecran Detail, "Toi"
   rejoint le match d'Aymen (un autre organisateur) ; sur Config/Confirmation/
   Mon match, "Toi" CREES ton propre match et en es l'organisateur. Les
   confondre ferait rejoindre Aymen a son propre match. Identite partagee
   avec les autres ecrans (Teams...) via data/identity.ts. */
export { CURRENT_USER_ID, VIEWER_ID };

/* A7 (22/09/2026) : plus de terrain/sport/format figé ici — les écrans réels dérivent tout de
   store.venue via lib/venueCatalog.ts (sportChoicesFor/fieldForSport/formatChoicesFor). Seul le
   flux Défis (ChallengesFlow, derrière TEAMS_CHALLENGES_ENABLED, désactivé) garde un jeu de
   formats mock fixe — voir data/bookingDemo.ts pour le reste de son contexte mock. */
export interface SportOption { value: 'FOOTBALL' | 'PADEL' | 'BASKET'; label: string; icon: string; available: boolean }

export const FORMAT_OPTIONS: { value: MatchFormat; capacity: number }[] = (['5v5', '6v6', '7v7', '8v8'] as MatchFormat[])
  .map((f) => ({ value: f, capacity: FORMAT_CAPACITY[f] }));

export const LEVEL_OPTIONS: { value: SkillLevel; label: string }[] = [
  { value: 'LOISIR', label: 'Loisir' },
  { value: 'INTERMEDIAIRE', label: 'Intermédiaire' },
  { value: 'COMPETITION', label: 'Compétition' },
];

/* Ancrage reel : « Friday Night » a lieu le PROCHAIN vrai vendredi a 20:00
   (resolveNextWeekday — l'ancien ancrage Date.now()+3j donnait un coup
   d'envoi a l'heure courante, ex. 22:39, incoherent avec le nom du match
   des que les ecrans ont commence a DERIVER l'heure de l'epoch au lieu d'un
   libelle fige). Toujours assez loin pour que isLockedNow() reponde false. */
const DAY_MS = 86_400_000;
export const EXISTING_MATCH_START = resolveNextWeekday(5, 20 * 60, 1);
export const EXISTING_MATCH_END = EXISTING_MATCH_START + 90 * 60_000;

export interface RosterEntry { userId: string; name: string; role: string; ovr: string }

/* Les 7 inscrits de Friday Night — noms/postes/OVR tires de l'annuaire
   partage data/people.ts (une seule source), l'ordre et la composition du
   roster restant un fait de CE match. Le prefixe « Organisateur » est
   ajoute a l'affichage par PlayerRow (via organizerId), plus jamais fige
   dans la donnee. */
const ROSTER_IDS = ['u-aymen', 'u-karim', 'u-nassim', 'u-walid', 'u-sofiane', 'u-riad', 'u-mehdi'] as const;
export const EXISTING_ROSTER: RosterEntry[] = ROSTER_IDS.map((id) => {
  const p = PEOPLE[id]!;
  return { userId: id, name: p.name, role: p.position, ovr: p.ovr };
});

/* venueId/fieldId : placeholders inertes — cette constante n'est que la valeur INITIALE (avant
   authentification) de la carte de matchs (store.ts::initialState), remplacée dans son
   intégralité dès que loadEverything() résout (useAppStore.ts) et jamais peinte à l'écran entre-
   temps (App.tsx : store.bootstrapping). Aucun accès réseau ni affichage réel ne les lit — pas
   besoin d'un vrai id de centre ici, contrairement au reste de ce fichier. */
export const EXISTING_MATCH: Match = {
  id: 'm-friday-night',
  sport: 'FOOTBALL',
  format: '5v5',
  level: 'LOISIR',
  title: 'Friday Night',
  venueId: 'demo-venue',
  fieldId: 'demo-field',
  range: { start: EXISTING_MATCH_START, end: EXISTING_MATCH_END },
  capacity: 10,
  /* Derive du moteur tarifaire reel (vendredi 20h-21h30, bande pleine) —
     plus jamais un montant tape a la main qui pouvait diverger du vrai prix
     (revue Premium, lentille core). */
  pricePerPlayer: splitPerPlayer(
    quoteRange(PRICING_RULES, BASE_RATE, 5, 20 * 60, 20 * 60 + 90, DEMO_FORMAT).total, 10,
  ),
  visibility: 'OPEN',
  status: 'OPEN',
  organizerId: 'u-aymen',
  bookingId: 'b-existing',
  coordination: { kind: 'WHATSAPP' },
  createdAt: Date.now() - 2 * DAY_MS,
};

export const EXISTING_PLAYERS: MatchPlayer[] = EXISTING_ROSTER.map((r) => ({
  matchId: EXISTING_MATCH.id, userId: r.userId, status: 'JOINED', joinedAt: Date.now() - DAY_MS,
}));

export const EXISTING_VENUE_NAME = 'Complexe Ryad';
export const EXISTING_FIELD_LABEL = 'Complexe Ryad · Terrain de démonstration';

/* --- Creation (chemins A/B) ------------------------------------------------
   Lot 3C, P0 (audit du 31/08/2026, §4) : BOOKING_B (et ses dérivés
   BOOKING_B_START/_REF/_LABEL, plus buildBookingFromSlot qui ne servait
   qu'à en fabriquer l'équivalent pour le chemin A) ont été retirés. Ils
   n'avaient plus AUCUN usage réel depuis que la carte de raccourci démo de
   CreateMatchFlow a été supprimée (Lot 3B étape 3) — mais restaient
   consommés en permanence, pour TOUS les utilisateurs, par
   state/store.ts::blockersFor/commitmentRanges (un créneau vendredi
   18h-19h30 bloqué en dur dans la grille de disponibilité, sans jamais
   pouvoir être "consommé" avec de vrais ids serveur). Voir DECISIONS.md. */
