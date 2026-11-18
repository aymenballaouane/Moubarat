/* Recherche d'adresses (lot « Match libre », phase adresses — GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet, gratuit).
   Les données viennent d'OpenStreetMap, via Photon (moteur fait pour proposer des résultats au fil de la frappe). Ce fichier ne fait
   que traduire une réponse Photon (GeoJSON) en lignes simples pour l'app : un nom, un détail (quartier, commune), une wilaya, une
   position. Aucune règle métier ; aucune donnée du joueur n'est envoyée à part le texte tapé et la position de sa ville. */

export interface PlaceSuggestion {
  /** Identifiant OpenStreetMap stable (« N123 », « W456 ») : une clé d'affichage, rien de plus. */
  id: string;
  name: string;
  /** « Ben Aknoun, Alger » — quartier / localité puis commune, sans répéter le nom. */
  detail: string;
  /** La wilaya telle qu'OpenStreetMap la nomme (partie latine), `null` si inconnue. */
  wilaya: string | null;
  /** Lot B, phase 1 : la rue (« Rue Ali Khodja », numéro compris s'il est connu), `null` si OpenStreetMap n'en donne pas. */
  street: string | null;
  /** Lot B, phase 1 : le quartier ou la commune (« Ben Aknoun ») — préremplit « Terrain · {quartier} ». */
  area: string | null;
  lat: number;
  lng: number;
}

/** L'Algérie (minLon, minLat, maxLon, maxLat) : Photon n'y cherche que là. */
export const ALGERIA_BBOX = '-8.67,18.96,11.98,37.12';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

/** Bruit pour qui cherche où jouer : distributeurs, mobilier urbain… (OpenStreetMap les recense aussi). */
const NOISE = new Set(['atm', 'bank', 'bureau_de_change', 'vending_machine', 'post_box', 'waste_basket', 'waste_disposal', 'bench', 'telephone', 'recycling', 'parking_entrance', 'charging_station']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Les noms de wilaya d'OpenStreetMap mêlent souvent trois écritures (« Alger ⴷⵣⴰⵢⴻⵔ الجزائر ») : on garde la partie latine. */
export function latinPart(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/^[\p{Script=Latin}0-9\s'’.-]+/u);
  const latin = (m ? m[0] : name).replace(/^Wilaya (d['’]|de |du )/i, '').trim();
  return latin.length >= 2 ? latin : null;
}

/** « BEN AKNOUN » (certaines fiches OpenStreetMap sont en capitales) → « Ben Aknoun » ; un nom déjà en casse mixte reste tel quel. */
export function tidyCase(v: string | null): string | null {
  if (!v || v !== v.toUpperCase() || !/\p{Lu}/u.test(v)) return v;
  return v.toLowerCase().replace(/(^|[\s'’-])(\p{Ll})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function suggestionsFromPhoton(body: unknown, max = 6): PlaceSuggestion[] {
  const features = (body as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue;
    if (NOISE.has(String(p.osm_value ?? ''))) continue;
    const country = str(p.countrycode);
    if (country && country.toUpperCase() !== 'DZ') continue;
    const street = str(p.street);
    const name = str(p.name) ?? (street ? [str(p.housenumber), street].filter(Boolean).join(' ') : null);
    if (!name) continue;
    const parts = [street, str(p.district), str(p.locality), str(p.city)]
      .filter((x): x is string => x !== null && x.toLowerCase() !== name.toLowerCase());
    const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    const detail = unique.slice(0, 2).join(', ');
    const id = `${str(p.osm_type) ?? 'X'}${String(p.osm_id ?? out.length)}`;
    const key = `${name}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fullStreet = street ? [str(p.housenumber), street].filter(Boolean).join(' ') : null;
    const area = tidyCase(str(p.city) ?? str(p.district) ?? str(p.locality));
    out.push({ id, name, detail, wilaya: latinPart(str(p.state) ?? str(p.county)), street: fullStreet, area, lat: coords[1], lng: coords[0] });
    if (out.length >= max) break;
  }
  return out;
}
