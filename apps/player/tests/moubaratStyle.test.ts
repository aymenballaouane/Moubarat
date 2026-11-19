import { describe, expect, it } from 'vitest';
import { moubaratStyle, nameField, PALETTES } from '../src/components/map/moubaratStyle.js';

/* Lot B, phase 7 — le style de la carte Moubarat (MapLibre + OpenFreeMap). */

describe('moubaratStyle', () => {
  it('une seule source, OpenFreeMap par défaut, avec la mention obligatoire ; jamais Google ni les images d’OpenStreetMap', () => {
    const s = moubaratStyle('sombre', 'fr');
    const src = s.sources.omt as { url: string; attribution: string };
    expect(src.url).toBe('https://tiles.openfreemap.org/planet');
    expect(src.attribution).toContain('OpenFreeMap');
    expect(src.attribution).toContain('OpenStreetMap');
    expect(JSON.stringify(s)).not.toMatch(/google|tile\.openstreetmap\.org/);
  });

  it('les deux thèmes reprennent les couleurs de l’app ; les terrains de sport ont leur calque', () => {
    const dark = moubaratStyle('sombre', 'fr');
    const light = moubaratStyle('clair', 'fr');
    const bg = (st: typeof dark) => (st.layers.find((l) => l.id === 'bg') as { paint: { 'background-color': string } }).paint['background-color'];
    expect(bg(dark)).toBe(PALETTES.sombre.land);
    expect(bg(light)).toBe('#F4F3EF');
    expect(dark.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['pitch', 'pitch-line', 'water', 'road-primary', 'place-city']));
  });

  it('les noms : français (puis latin) en français, arabe en arabe ; pas de capitales forcées en arabe', () => {
    expect(JSON.stringify(nameField('fr'))).toContain('name:fr');
    expect(JSON.stringify(nameField('ar'))).toContain('name:ar');
    const city = (lang: 'fr' | 'ar') => moubaratStyle('sombre', lang).layers.find((l) => l.id === 'place-city') as { layout: Record<string, unknown> };
    expect(city('fr').layout['text-transform']).toBe('uppercase');
    expect(city('ar').layout['text-transform']).toBeUndefined();
  });
});
