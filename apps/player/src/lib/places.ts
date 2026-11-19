/* Phase adresses (GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet) — logique PURE de la recherche d'adresses et de la carte de
   l'écran « Où tu joues ? ». Les suggestions viennent de notre serveur (GET /places/search, qui interroge OpenStreetMap). */
import { cityLabel } from './labels.js';
import { fold } from './venueFilters.js';

export interface PlaceSuggestion { id: string; name: string; detail: string; wilaya: string | null; lat: number; lng: number }
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
