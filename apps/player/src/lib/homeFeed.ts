import { activePlayers, isLockedNow } from '@moubarat/core';
import type { FeedEntry } from '../data/matchesFeedDemo.js';
import { isSameCalendarDay } from './format.js';
import { haversineKm, type GeoPosition } from './distance.js';
import { inPlayerCity } from './venueFilters.js';

/* Home › « Matchs à rejoindre » — remplace lib/homeMatches.ts (règle 11, refonte-app-joueur/
   docs/regles.md, décision d'Aymen du 25/10/2026). Pure présentation, pas une règle du core
   (gelé) : juste QUOI mettre en avant sur l'écran d'accueil — l'Explorer garde la liste
   complète, non filtrée.

   Un match est proposé s'il est :
   - encore rejoignable : ouvert (ni complet, ni verrouillé, ni annulé/joué), public, et
     commençant dans plus d'1 h (le core ferme les inscriptions à H-1 — isLockedNow, règle 4 modifiée ; de H-2 à H-1 une place libérée reste proposée) ;
   - AUJOURD'HUI (jour calendaire réel, pas une fenêtre glissante) ;
   - dans la ville du joueur (son centre), si elle est connue — sinon toutes villes, honnêtement
     (on ne filtre jamais sur une donnée qu'on n'a pas) ;
   - pas déjà MIEN : inscrit ou organisateur (déjà dans « Ton prochain match » / Mes matchs).
   Tri : début le plus proche d'abord ; à heure égale, le plus proche en distance (règle 33 —
   la position ne sert QU'au tri, jamais affichée, et seulement si le joueur l'a accordée).
   Plafond 6, puis « Voir tout » vers Explorer. Jamais de seuil de remplissage ici (abandonné
   avec la fenêtre 48 h — décision d'Aymen). */

export const HOME_JOIN_LIMIT = 6;

export interface VenueGeoInfo { wilaya: string; lat: number | null; lng: number | null }

function venueDistanceKm(
  venueId: string, venueOf: (venueId: string) => VenueGeoInfo | undefined, playerPos: GeoPosition,
): number {
  const venue = venueOf(venueId);
  if (!venue || venue.lat === null || venue.lng === null) return Infinity;
  return haversineKm(playerPos, { lat: venue.lat, lng: venue.lng });
}

export function homeJoinableMatches(
  entries: readonly FeedEntry[],
  viewerId: string,
  now: number,
  playerCity: string | null,
  venueOf: (venueId: string) => VenueGeoInfo | undefined,
  playerPos: GeoPosition | null,
  limit: number = HOME_JOIN_LIMIT,
): FeedEntry[] {
  return entries
    .filter(({ match, players }) => {
      if (match.visibility !== 'OPEN' || match.status !== 'OPEN') return false;
      if (isLockedNow(match, now)) return false; // commence dans moins d'1 h (ou a commencé)
      if (!isSameCalendarDay(match.range.start, now)) return false;
      const active = activePlayers(players);
      if (active.length >= match.capacity) return false;
      if (match.organizerId === viewerId || active.some((p) => p.userId === viewerId)) return false;
      if (playerCity) {
        const venue = venueOf(match.venueId);
        if (!venue || !inPlayerCity(venue.wilaya, playerCity)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.match.range.start !== b.match.range.start) return a.match.range.start - b.match.range.start;
      if (playerPos) {
        const da = venueDistanceKm(a.match.venueId, venueOf, playerPos);
        const db = venueDistanceKm(b.match.venueId, venueOf, playerPos);
        if (da !== db) return da - db;
      }
      return a.match.id.localeCompare(b.match.id);
    })
    .slice(0, limit);
}

/* Home › « Terrains à proximité » (règle 11/33) — centres de la ville du joueur (si connue),
   du plus proche au plus loin si la position est accordée ; sinon l'ordre reçu du serveur,
   avec l'invite « Active ta position… » affichée par l'écran, jamais une distance inventée. */

export function nearbyVenues<V extends VenueGeoInfo>(
  venues: readonly V[], playerCity: string | null, playerPos: GeoPosition | null,
): V[] {
  const inCity = venues.filter((v) => inPlayerCity(v.wilaya, playerCity));
  if (!playerPos) return [...inCity];
  return [...inCity].sort((a, b) => {
    const da = a.lat !== null && a.lng !== null ? haversineKm(playerPos, { lat: a.lat, lng: a.lng }) : Infinity;
    const db = b.lat !== null && b.lng !== null ? haversineKm(playerPos, { lat: b.lat, lng: b.lng }) : Infinity;
    return da - db;
  });
}
