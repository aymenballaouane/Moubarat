import type { StyleSpecification, ExpressionSpecification, LayerSpecification } from 'maplibre-gl';

/* Lot B, phase 7 (19/11/2026, aperçu validé par Aymen : « branche-la ») — le style de la « carte Moubarat » : MapLibre sur les tuiles
   vectorielles du schéma OpenMapTiles. Source par défaut : OpenFreeMap (gratuit, sans compte ni clé, usage commercial autorisé, mention
   obligatoire en bas de carte). `VITE_MAP_VECTOR_URL` / `VITE_MAP_GLYPHS_URL` permettent d'héberger plus tard notre propre fichier de
   l'Algérie sans toucher au code. Deux thèmes tirés des jetons de design/moubarat-ds.css ; les terrains de sport ressortent en vert ;
   le rouge reste réservé aux centres partenaires et aux actions. */

export const VECTOR_URL: string = import.meta.env.VITE_MAP_VECTOR_URL ?? 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL: string = import.meta.env.VITE_MAP_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export type MapTheme = 'sombre' | 'clair';

export const PALETTES = {
  sombre: {
    land: '#10161F', water: '#0B1724', waterLine: '#13263A', park: '#13231A', wood: '#122019',
    pitch: '#173A27', pitchLine: '#2EB872', building: '#161D27', buildingLine: '#1D2531',
    road: { motorway: '#3A4556', trunk: '#343E4E', primary: '#2C3543', secondary: '#252D39', minor: '#1D2430', service: '#181E28' },
    casing: '#0B0F15', label: '#8A94A6', labelStrong: '#C5CCD6', halo: '#0E1319', roadLabel: '#7C8698',
  },
  clair: {
    land: '#F4F3EF', water: '#C9DCEB', waterLine: '#B4CDE0', park: '#DCEAD5', wood: '#D2E3CC',
    pitch: '#C3E3C4', pitchLine: '#2E9E5E', building: '#E3E1DB', buildingLine: '#D6D3CB',
    road: { motorway: '#FFFFFF', trunk: '#FFFFFF', primary: '#FFFFFF', secondary: '#FFFFFF', minor: '#FFFFFF', service: '#FAFAF8' },
    casing: '#D3D0C8', label: '#6A6862', labelStrong: '#35342E', halo: '#F4F3EF', roadLabel: '#7A7872',
  },
} as const;

type RoadKey = keyof (typeof PALETTES)['sombre']['road'];

/** Les noms : en français, le nom français, sinon latin, sinon local ; en arabe, le nom arabe (lettres reliées par le module RTL). */
export function nameField(lang: 'fr' | 'ar'): ExpressionSpecification {
  return lang === 'ar'
    ? ['coalesce', ['get', 'name:ar'], ['get', 'name']]
    : ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']];
}

export function moubaratStyle(theme: MapTheme, lang: 'fr' | 'ar'): StyleSpecification {
  const c = PALETTES[theme];
  const name = nameField(lang);
  const width = (base: number): ExpressionSpecification => ['interpolate', ['exponential', 1.6], ['zoom'], 10, base * 0.4, 14, base * 1.6, 18, base * 7];
  const roads: [RoadKey, string[], number, number][] = [
    ['service', ['service', 'track'], 0.6, 13],
    ['minor', ['minor'], 0.9, 12],
    ['secondary', ['secondary', 'tertiary'], 1.4, 9],
    ['primary', ['primary'], 1.8, 7],
    ['trunk', ['trunk'], 2.1, 5],
    ['motorway', ['motorway'], 2.4, 5],
  ];
  const roadFilter = (classes: string[]): ExpressionSpecification => ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']];
  const classIn = (classes: string[]): ExpressionSpecification => ['in', ['get', 'class'], ['literal', classes]];
  const layers: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': c.land } },
    { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: classIn(['wood', 'forest']), paint: { 'fill-color': c.wood } },
    { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: classIn(['grass', 'farmland']), paint: { 'fill-color': c.park, 'fill-opacity': 0.7 } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
    { id: 'pitch', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: classIn(['pitch', 'stadium', 'track', 'playground']), paint: { 'fill-color': c.pitch } },
    { id: 'pitch-line', type: 'line', source: 'omt', 'source-layer': 'landuse', minzoom: 14, filter: classIn(['pitch', 'stadium']), paint: { 'line-color': c.pitchLine, 'line-width': 1.2, 'line-opacity': 0.75 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.waterLine, 'line-width': 1.2 } },
    { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine } },
    ...roads.map(([id, classes, w, minzoom]): LayerSpecification => ({ id: `casing-${id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom, filter: roadFilter(classes), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.casing, 'line-width': width(w * 1.35) } })),
    ...roads.map(([id, classes, w, minzoom]): LayerSpecification => ({ id: `road-${id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom, filter: roadFilter(classes), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.road[id], 'line-width': width(w) } })),
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-angle': 30 }, paint: { 'text-color': c.roadLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
    { id: 'pitch-name', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 15, filter: ['in', ['get', 'subclass'], ['literal', ['pitch', 'sports_centre', 'stadium']]], layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8 }, paint: { 'text-color': c.pitchLine, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
    { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 12, filter: classIn(['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet']), layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 8 }, paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: classIn(['city', 'town']), layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 14, 17], ...(lang === 'ar' ? {} : { 'text-transform': 'uppercase' as const, 'text-letter-spacing': 0.08 }) }, paint: { 'text-color': c.labelStrong, 'text-halo-color': c.halo, 'text-halo-width': 1.8 } },
  ];
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: { omt: { type: 'vector', url: VECTOR_URL, attribution: ATTRIBUTION } },
    layers,
  };
}
