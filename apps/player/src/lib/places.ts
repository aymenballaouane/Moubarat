/* Phase adresses (GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet) — logique PURE de la recherche d'adresses et de la carte de
   l'écran « Où tu joues ? ». Les suggestions viennent de notre serveur (GET /places/search, qui interroge OpenStreetMap). */
import { cityLabel } from './labels.js';
import { fold } from './venueFilters.js';

export interface PlaceSuggestion {
  id: string; name: string; detail: string; wilaya: string | null; lat: number; lng: number;
  /** Lot B, phase 1 : la rue et le quartier (ou la commune) d'OpenStreetMap, quand ils sont connus. */
  street?: string | null; area?: string | null;
}
export interface LatLng { lat: number; lng: number }

/** Le centre de chaque ville proposée par l'app (code du profil) — là où s'ouvre la carte quand le lieu n'a pas encore de position. */
export const CITY_CENTERS: Record<string, LatLng> = {
  ALGER: { lat: 36.7538, lng: 3.0588 },
  ORAN: { lat: 35.6971, lng: -0.6308 },
  CONSTANTINE: { lat: 36.365, lng: 6.6147 },
  ANNABA: { lat: 36.9, lng: 7.7667 },
  BLIDA: { lat: 36.47, lng: 2.8277 },
  SETIF: { lat: 36.19, lng: 5.41 },
};

export function cityCenter(city: string | null | undefined): LatLng {
  return (city ? CITY_CENTERS[city] : undefined) ?? CITY_CENTERS.ALGER!;
}

/** La wilaya à enregistrer pour un lieu : celle d'OpenStreetMap si c'est l'une des villes de l'app (même écriture que les centres,
    « Alger », « Sétif »… — le filtre « ville » de Jouer en dépend), sinon celle du joueur. */
export function wilayaForPlace(osmWilaya: string | null | undefined, fallback: string): string {
  if (!osmWilaya) return fallback;
  const key = fold(osmWilaya.trim());
  for (const code of Object.keys(CITY_CENTERS)) {
    const label = cityLabel(code);
    if (fold(label) === key) return label;
  }
  return fallback;
}

/** « Ben Aknoun, Alger » : le détail d'une suggestion, suivi de sa wilaya si elle n'y figure pas déjà. */
export function placeSubtitle(s: Pick<PlaceSuggestion, 'detail' | 'wilaya'>): string {
  const parts = [s.detail, s.wilaya ?? ''].map((x) => x.trim()).filter(Boolean);
  return parts.filter((x, i) => parts.findIndex((y) => fold(y) === fold(x)) === i).join(' · ');
}

/* --- Lot B, phase 1 (« Où tu joues ? » sur la carte, 18/11/2026) ------------------------------------------------------------------ */

/** Distance à vol d'oiseau, en kilomètres (formule de haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** « 1,2 km », « 12 km » (une décimale sous 10 km) — virgule française, chiffres latins en arabe aussi. */
export function kmText(km: number): string {
  const v = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return String(v).replace('.', ',');
}

/** Les centres qui ont une position, du plus proche au plus loin de `from`, avec leur distance. */
export function partnersByDistance<V extends { lat: number | null; lng: number | null }>(venues: readonly V[], from: LatLng): (V & { km: number })[] {
  return venues
    .filter((v): v is V & { lat: number; lng: number } => v.lat !== null && v.lng !== null)
    .map((v) => ({ ...v, km: distanceKm(from, { lat: v.lat, lng: v.lng }) }))
    .sort((a, b) => a.km - b.km);
}

/** Le centre partenaire sous l'épingle (à moins de `withinM` mètres), le plus proche ; sinon `null` — « C'est {centre} ? ». */
export function partnerUnderPin<V extends { lat: number | null; lng: number | null }>(venues: readonly V[], pin: LatLng, withinM = 120): V | null {
  const near = partnersByDistance(venues, pin)[0];
  return near && near.km * 1000 <= withinM ? (venues.find((v) => v.lat === near.lat && v.lng === near.lng) ?? null) : null;
}

/** Le nom proposé pour un terrain sous l'épingle : « Terrain · Ben Aknoun » — jamais le nom du commerce le plus proche. Sans quartier
    connu : « Terrain · {wilaya} », sinon « Terrain ». `label` = la traduction de « Terrain · {quartier} ». */
export function defaultFieldName(area: string | null | undefined, wilaya: string | null | undefined, label: string): string {
  const where = (area ?? '').trim() || (wilaya ?? '').trim();
  return where ? label.replace('{quartier}', where) : label.replace(/\s*·\s*\{quartier\}/, '').trim();
}
