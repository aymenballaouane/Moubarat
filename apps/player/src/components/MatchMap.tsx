import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../lib/places.js';
import '../styles/match-map.css';

/* La carte de « Créer un match » (lot B, phase 1 — GO d'Aymen du 18/11/2026). SEUL fichier de l'app qui parle à une bibliothèque de
   carte : le passage à Google Maps (compte d'Aymen en cours de création) ne remplacera que ce composant ; ses entrées et sorties
   (centre, zoom, épingles des centres, position du joueur, « la carte a bougé ») restent les mêmes.

   Fond de carte : `VITE_MAP_TILES_URL` (+ `VITE_MAP_TILES_ATTRIBUTION`). Sans réglage, les images d'OpenStreetMap servent SEULEMENT en
   développement — jamais en production (décision d'Aymen : leur règle d'usage ne garantit rien à un service commercial). Sans fond de
   carte utilisable, le composant le dit (`onUnavailable`) et l'écran affiche « Carte indisponible. Réessaie. ». En thème sombre, les
   images claires d'OpenStreetMap sont assombries par un filtre (maquette Cm-B1 sombre) ; un vrai style sombre viendra avec Google. */

const TILES_URL: string | null = import.meta.env.VITE_MAP_TILES_URL
  ?? (import.meta.env.DEV ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : null);
const TILES_ATTRIBUTION = import.meta.env.VITE_MAP_TILES_ATTRIBUTION
  ?? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export interface MapMarker { id: string; name: string; lat: number; lng: number }
/** Un déplacement demandé par l'écran (adresse choisie, « Ma position ») : `seq` change à chaque demande. */
export interface MapTarget { center: LatLng; zoom: number; seq: number }

const LOGO = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9"/><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00"/></svg>';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function MatchMap(p: {
  center: LatLng;
  zoom: number;
  target?: MapTarget | null;
  markers: readonly MapMarker[];
  /** Les épingles des centres passent au second plan (mode épingle, maquette Cm-B1b). */
  dimMarkers?: boolean;
  me: LatLng | null;
  onMarker?: (id: string) => void;
  onMoveStart?: () => void;
  /** La carte s'est arrêtée : son centre, et si c'est le joueur qui l'a fait glisser. */
  onMoveEnd?: (center: LatLng, byUser: boolean) => void;
  onUnavailable?: () => void;
  label: string;
}) {
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
        className: 'mm-mk',
        html: `<span class="mm-mk__tile">${LOGO}</span><span class="mm-mk__tip"></span><span class="mm-mk__name" dir="ltr">${esc(mk.name)}</span>`,
        iconSize: [160, 70], iconAnchor: [80, 46],
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
