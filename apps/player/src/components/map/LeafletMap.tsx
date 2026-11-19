import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MARKER_SIZE, markerHtml, type MapViewProps } from './types.js';
import '../../styles/match-map.css';

/* La carte de SECOURS de « Créer un match » (lot B, phase 1, puis phase 5 : Google Maps devient la carte normale, MatchMap.tsx choisit).
   Leaflet sert quand Google n'a pas de clé, refuse la clé ou ne se charge pas ; mêmes entrées et sorties que GoogleMap.tsx.

   Fond de carte : `VITE_MAP_TILES_URL` (+ `VITE_MAP_TILES_ATTRIBUTION`). Sans réglage, les images d'OpenStreetMap servent SEULEMENT en
   développement — jamais en production (décision d'Aymen : leur règle d'usage ne garantit rien à un service commercial). Sans fond de
   carte utilisable, le composant le dit (`onUnavailable`) et l'écran affiche « Carte indisponible. Réessaie. ». En thème sombre, les
   images claires d'OpenStreetMap sont assombries par un filtre (maquette Cm-B1 sombre) ; un vrai style sombre viendra avec Google. */

const TILES_URL: string | null = import.meta.env.VITE_MAP_TILES_URL
  ?? (import.meta.env.DEV ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : null);
const TILES_ATTRIBUTION = import.meta.env.VITE_MAP_TILES_ATTRIBUTION
  ?? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function LeafletMap(p: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const meLayer = useRef<L.LayerGroup | null>(null);
  const programmatic = useRef(false);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    if (!box.current) return undefined;
    if (!TILES_URL) { cb.current.onUnavailable?.(); return undefined; }
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([p.center.lat, p.center.lng], p.zoom);
    const tiles = L.tileLayer(TILES_URL, { maxZoom: 19, attribution: TILES_ATTRIBUTION }).addTo(m);
    let loaded = false;
    let errors = 0;
    tiles.on('tileload', () => { loaded = true; });
    tiles.on('tileerror', () => { errors += 1; if (!loaded && errors >= 4) cb.current.onUnavailable?.(); });
    const watchdog = window.setTimeout(() => { if (!loaded) cb.current.onUnavailable?.(); }, 12_000);
    markerLayer.current = L.layerGroup().addTo(m);
    meLayer.current = L.layerGroup().addTo(m);
    m.on('movestart', () => { if (!programmatic.current) cb.current.onMoveStart?.(); });
    m.on('moveend', () => {
      const c = m.getCenter();
      cb.current.onMoveEnd?.({ lat: c.lat, lng: c.lng }, !programmatic.current);
    });
    map.current = m;
    // La carte change de hauteur (mode épingle, maquette Cm-B1b) : Leaflet doit le savoir, en gardant le même centre — sans que ce
    // recentrage passe pour un geste du joueur.
    const ro = new ResizeObserver(() => {
      programmatic.current = true;
      try { m.invalidateSize({ animate: false }); } finally { programmatic.current = false; }
    });
    ro.observe(box.current);
    return () => { ro.disconnect(); window.clearTimeout(watchdog); m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Déplacement demandé par l'écran (adresse choisie, « Ma position ») : pas un geste du joueur.
  useEffect(() => {
    const m = map.current;
    if (!m || !p.target) return;
    // Sans animation, Leaflet émet « movestart » et « moveend » PENDANT setView : le drapeau couvre exactement ce déplacement.
    programmatic.current = true;
    try { m.setView([p.target.center.lat, p.target.center.lng], p.target.zoom, { animate: false }); } finally { programmatic.current = false; }
  }, [p.target?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Les centres partenaires : le logo Moubarat dans un carré, une pointe, le nom dessous (maquette Cm-B1).
  useEffect(() => {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const mk of p.markers) {
      const icon = L.divIcon({
        className: mk.kind === 'community' ? 'mm-mk mm-mk--community' : 'mm-mk',
        html: markerHtml(mk.name, mk.kind),
        iconSize: [MARKER_SIZE.w, MARKER_SIZE.h], iconAnchor: [MARKER_SIZE.anchorX, MARKER_SIZE.anchorY],
      });
      L.marker([mk.lat, mk.lng], { icon, keyboard: false, title: mk.name })
        .on('click', () => cb.current.onMarker?.(mk.id))
        .addTo(layer);
    }
  }, [p.markers]);

  useEffect(() => {
    const layer = meLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (p.me) L.marker([p.me.lat, p.me.lng], { icon: L.divIcon({ className: 'mm-me', html: '<span></span>', iconSize: [34, 34] }), interactive: false, keyboard: false }).addTo(layer);
  }, [p.me?.lat, p.me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={`mm${p.dimMarkers ? ' mm--dim' : ''}`} dir="ltr" role="application" aria-label={p.label} />;
}
