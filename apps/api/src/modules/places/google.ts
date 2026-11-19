import { latinPart, tidyCase, type PlaceSuggestion } from './photon.js';

/* Lot B, phase 5 (19/11/2026, décision d'Aymen : « on part sur Google », en gardant OpenStreetMap en secours) — traduction des
   réponses de Google Places API (New) et de Geocoding API en lignes `PlaceSuggestion`, les mêmes que pour Photon. Aucune règle métier.

   Différence avec Photon : une suggestion de Google (Autocomplete) n'a PAS de position. Elle n'arrive qu'au choix de l'adresse, par
   Place Details (champs « Essentials » seulement : position, adresse, composants — jamais `displayName`, facturé plus cher ; le nom vient
   de la suggestion). L'app le sait (`needsDetails`) et demande la position au toucher. */

/** Une suggestion Google sans position : `lat`/`lng` à `null`, résolus par GET /places/details. */
export type PendingSuggestion = Omit<PlaceSuggestion, 'lat' | 'lng'> & { lat: null; lng: null; needsDetails: true };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** « Chéraga, Algérie » → « Chéraga » : le pays n'apprend rien à un joueur en Algérie. */
function dropCountry(s: string | null): string {
  if (!s) return '';
  return s.split(',').map((x) => x.trim()).filter((x) => x && !/^alg[ée]rie$|^algeria$|^الجزائر$/i.test(x)).join(', ');
}

/** Les noms de wilaya de Google : « Alger », « Province d'Alger », « Wilaya de Blida »… → la partie utile. */
function wilayaName(raw: string | null): string | null {
  if (!raw) return null;
  return latinPart(raw.replace(/^(Province|Wilaya)\s+(d['’]|de |du )/i, '').trim());
}

export function suggestionsFromGoogle(body: unknown, max = 6): PendingSuggestion[] {
  const list = (body as { suggestions?: unknown[] } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: PendingSuggestion[] = [];
  for (const s of list) {
    const pp = (s as { placePrediction?: Record<string, unknown> }).placePrediction;
    if (!pp) continue;
    const id = str(pp.placeId);
    const fmt = (pp.structuredFormat ?? {}) as { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
    const name = str(fmt.mainText?.text) ?? str((pp.text as { text?: unknown } | undefined)?.text);
    if (!id || !name) continue;
    const detail = dropCountry(str(fmt.secondaryText?.text));
    const area = detail ? detail.split(',')[0]!.trim() : null;
    out.push({ id, name, detail, wilaya: null, street: null, area: area || null, lat: null, lng: null, needsDetails: true });
    if (out.length >= max) break;
  }
  return out;
}

interface Component { longText?: unknown; long_name?: unknown; types?: unknown }

function pick(components: readonly Component[], ...types: string[]): string | null {
  for (const t of types) {
    const c = components.find((x) => Array.isArray(x.types) && (x.types as unknown[]).includes(t));
    const v = c ? str(c.longText) ?? str(c.long_name) : null;
    if (v) return v;
  }
  return null;
}

function fromComponents(components: readonly Component[]) {
  const route = pick(components, 'route');
  const number = pick(components, 'street_number');
  return {
    street: route ? [number, route].filter(Boolean).join(' ') : null,
    area: tidyCase(pick(components, 'sublocality_level_1', 'sublocality', 'neighborhood', 'locality', 'administrative_area_level_2')),
    wilaya: wilayaName(pick(components, 'administrative_area_level_1')),
  };
}

/** Place Details (New) → le lieu choisi, avec sa position. `name` : le nom de la suggestion touchée (jamais redemandé à Google). */
export function placeFromGoogleDetails(body: unknown, name: string): PlaceSuggestion | null {
  const b = (body ?? {}) as { id?: unknown; location?: { latitude?: unknown; longitude?: unknown }; addressComponents?: unknown; shortFormattedAddress?: unknown; formattedAddress?: unknown };
  const lat = Number(b.location?.latitude);
  const lng = Number(b.location?.longitude);
  const id = str(b.id);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const comps = Array.isArray(b.addressComponents) ? (b.addressComponents as Component[]) : [];
  const { street, area, wilaya } = fromComponents(comps);
  const detail = dropCountry(str(b.shortFormattedAddress) ?? str(b.formattedAddress))
    .split(',').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== name.toLowerCase()).slice(0, 2).join(', ');
  return { id, name, detail, wilaya, street, area, lat, lng };
}

/** Geocoding (adresse d'un point) → le lieu sous l'épingle. Secours seulement : Photon reste la source normale (gratuite). */
export function placeFromGeocode(body: unknown, lat: number, lng: number): PlaceSuggestion | null {
  const b = (body ?? {}) as { status?: unknown; results?: { place_id?: unknown; formatted_address?: unknown; address_components?: unknown }[] };
  if (b.status !== 'OK' || !Array.isArray(b.results) || b.results.length === 0) return null;
  const r = b.results[0]!;
  const comps = Array.isArray(r.address_components) ? (r.address_components as Component[]) : [];
  const { street, area, wilaya } = fromComponents(comps);
  const name = street ?? area ?? dropCountry(str(r.formatted_address)).split(',')[0]?.trim() ?? null;
  if (!name) return null;
  const detail = [area, wilaya].filter((x): x is string => !!x && x !== name).join(', ');
  return { id: str(r.place_id) ?? `G${lat.toFixed(5)},${lng.toFixed(5)}`, name, detail, wilaya, street, area, lat, lng };
}
