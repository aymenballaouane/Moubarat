import type { Sport } from '@moubarat/core';
import type { VenueSummary } from '../state/store.js';
import type { VenueAvailability } from './mappers.js';
import type { CityFilter } from './feedQuery.js';
import { fieldFormatList } from './venueView.js';
import { haversineKm, type GeoPosition } from './distance.js';

/* Explorer › Terrains — filtres et recherche des centres, EN MÉMOIRE sur la liste complète (cadrage §1.1 : « quelques
   dizaines de Ko pour 15 à 50 centres, donc pas de pagination »). Fonctions pures, sans DOM ni réseau
   (tests/venueFilters.test.ts).

   Lot 5 (25/10/2026, décision d'Aymen : « plus simple que l'A8 validé le 23/10 ») : l'onglet suit Explorer.dc.html —
   une rangée Tous / Foot / Padel / Libres ce soir — et les filtres de la page « Filtres » (FiltresExplorer.dc.html) :
   ville, sport, format. Prix, note minimale, équipements et tri ont quitté l'écran (leur code aussi). */

export type QuickVenueFilter = 'tous' | 'cesoir';

export interface VenueFilters {
  query: string;
  sport: Sport | 'ALL';
  quick: QuickVenueFilter;
  /** Ville du centre (wilaya) — mêmes valeurs que le filtre « Où ? » des matchs. */
  city: CityFilter | null;
  /** Formats demandés (« l'un ou l'autre ») : le centre doit en proposer au moins un sur un terrain actif. */
  formats: readonly string[];
}

export const NO_VENUE_FILTERS: VenueFilters = { query: '', sport: 'ALL', quick: 'tous', city: null, formats: [] };

/** Insensible aux accents et à la casse. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Début de wilaya, replié, de chacune des six villes proposées — la règle du serveur (`city` du fil des matchs). */
const CITY_PREFIX: Record<Exclude<CityFilter, 'AUTRE'>, string> = {
  ALGER: 'alger', ORAN: 'oran', CONSTANTINE: 'constantine', ANNABA: 'annaba', BLIDA: 'blida', SETIF: 'setif',
};

/** La wilaya du centre correspond-elle à la ville ? `AUTRE` = aucune des six. */
export function cityMatches(wilaya: string, city: CityFilter): boolean {
  const w = fold(wilaya.trim());
  if (city === 'AUTRE') return !Object.values(CITY_PREFIX).some((p) => w.startsWith(p));
  return w.startsWith(CITY_PREFIX[city]);
}

/** Audit final 26/10/2026 (P1-12, MAQ1-4) : le centre est-il « dans la ville du joueur » (Accueil : matchs à rejoindre, terrains à proximité, stade partenaire) ?
    La comparaison d'avant (`wilaya.toUpperCase() === playerCity`) échouait sur les accents (« Sétif » → « SÉTIF » ≠ « SETIF ») : l'Accueil d'un joueur de Sétif
    était vide alors que des centres existaient. Même règle que le filtre d'Explorer (début de wilaya, replié) ; ville inconnue OU « Autre » (la ville du
    joueur n'est pas dans la liste) = aucun filtre, toutes villes — on ne filtre jamais sur une ville qu'on ne sait pas comparer. */
export function inPlayerCity(wilaya: string, playerCity: string | null): boolean {
  if (!playerCity || playerCity === 'AUTRE') return true;
  return cityMatches(wilaya, playerCity as CityFilter);
}

/** `availability` : ce qu'il reste à jouer aujourd'hui par centre, `null` si pas lu — le filtre rapide est alors
    ignoré (jamais un « aucun centre libre » affirmé à partir d'une donnée qu'on n'a pas). */
export function matchesVenueFilters(
  v: VenueSummary, f: VenueFilters, availability: Record<string, VenueAvailability> | null,
): boolean {
  const q = fold(f.query.trim());
  if (q !== '' && !fold(v.name).includes(q) && !fold(v.wilaya).includes(q) && !fold(v.address).includes(q)) return false;
  if (f.sport !== 'ALL' && !v.sports.includes(f.sport)) return false;
  if (f.city !== null && !cityMatches(v.wilaya, f.city)) return false;
  if (f.formats.length > 0) {
    const offered = new Set(v.fields.filter((x) => x.status === 'ACTIVE').flatMap((x) => fieldFormatList(x.formats)));
    if (!f.formats.some((x) => offered.has(x))) return false;
  }
  if (availability && f.quick === 'cesoir') {
    const a = availability[v.id];
    if (!a || a.eveningStarts === 0) return false;
  }
  return true;
}

export function filterVenues(
  venues: readonly VenueSummary[], f: VenueFilters, availability: Record<string, VenueAvailability> | null,
): VenueSummary[] {
  return venues.filter((v) => matchesVenueFilters(v, f, availability));
}

/** Du plus proche au plus loin quand la position du joueur est connue (règle 33 : calculée sur le téléphone, jamais envoyée) ; les centres
    sans coordonnées passent après, puis par nom. Sans position : par nom — jamais une distance inventée. */
export function sortVenuesByDistance(venues: readonly VenueSummary[], pos: GeoPosition | null): VenueSummary[] {
  if (!pos) return sortVenuesByName(venues);
  const km = (v: VenueSummary) => (v.lat !== null && v.lng !== null ? haversineKm(pos, { lat: v.lat, lng: v.lng }) : Infinity);
  return [...venues].sort((a, b) => km(a) - km(b) || a.name.localeCompare(b.name, 'fr'));
}

/** Par nom, sans surprise (stable). */
export function sortVenuesByName(venues: readonly VenueSummary[]): VenueSummary[] {
  return [...venues].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface VenueFilterOptions { sports: Sport[] }

/** Ce que l'écran propose : uniquement des sports qui existent dans le catalogue. */
export function filterOptions(venues: readonly VenueSummary[]): VenueFilterOptions {
  const sports = new Set<Sport>();
  for (const v of venues) for (const s of v.sports) sports.add(s as Sport);
  return { sports: [...sports] };
}

/** Pas de filtre posé (le compteur « Filtres » et le bouton « Réinitialiser » en dépendent). */
export function isPristine(f: VenueFilters): boolean {
  return f.query.trim() === '' && f.sport === 'ALL' && f.quick === 'tous' && f.city === null && f.formats.length === 0;
}
