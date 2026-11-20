import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';   // MapLibre 6 : plus d'export par défaut (module ESM)
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 charge sa tâche de fond d'un fichier séparé, à côté du sien : Vite regroupe la bibliothèque ailleurs, on lui donne donc
// l'adresse exacte (servie par l'app elle-même, comme le module arabe).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
// Module arabe 0.2.3 (licence BSD) : choisi avec MapLibre 4, gardé avec MapLibre 6 (20/11/2026, correctif de sécurité) — la 0.3.0 n'est pas chargée par ses tâches de fond. Servi comme fichier
// par Vite depuis l'app elle-même, jamais d'un autre site.
import rtlPluginUrl from '@mapbox/mapbox-gl-rtl-text/mapbox-gl-rtl-text.min.js?url';
import { moubaratStyle, type MapTheme } from './moubaratStyle.js';
import { MARKER_SIZE, markerHtml, type MapViewProps } from './types.js';
import '../../styles/match-map.css';

/* Lot B, phase 7 (19/11/2026) — la « carte Moubarat », carte normale de « Créer un match » : MapLibre (bibliothèque libre) et le style
   de moubaratStyle.ts, sur les tuiles gratuites d'OpenFreeMap. Mêmes entrées et sorties que LeafletMap.tsx et GoogleMap.tsx
   (map/types.ts). Chargé à la demande (MatchMap.tsx, React.lazy) : la bibliothèque ne pèse pas sur l'ouverture de l'app.
   Échec (navigateur sans WebGL, tuiles injoignables 12 s) : `onFail`, MatchMap passe à la carte de secours. Noms arabes : module RTL
   embarqué dans l'app (jamais chargé d'un autre site), sans quoi les lettres ne sont pas reliées. */

maplibregl.setWorkerUrl(workerUrl);

let rtlRequested = false;
function ensureRtlPlugin() {
  if (rtlRequested) return;
  rtlRequested = true;
  try {
    maplibregl.setRTLTextPlugin(rtlPluginUrl, true).catch((e: unknown) => { console.warn('[carte] module arabe', e); });
  } catch (e) { console.warn('[carte] module arabe', e); }
}

/** Thème de l'app (body[data-theme], sinon le réglage du téléphone) — même règle que styles/theme-app-joueur.css. */
function currentTheme(): MapTheme {
  const t = document.body.dataset.theme;
  if (t === 'clair') return 'clair';
  if (t === 'sombre') return 'sombre';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
}

export function VectorMap(p: MapViewProps & { lang: 'fr' | 'ar'; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const dragging = useRef(false);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    if (!box.current) return undefined;
    if (p.lang === 'ar') ensureRtlPlugin();
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: box.current, style: moubaratStyle(currentTheme(), p.lang),
        center: [p.center.lng, p.center.lat], zoom: p.zoom, attributionControl: { compact: false },
        dragRotate: false, pitchWithRotate: false, touchPitch: false, maxZoom: 19,
      });
    } catch {
      cb.current.onFail();   // pas de WebGL
      return undefined;
    }
    m.touchZoomRotate.disableRotation();
    map.current = m;
    let loaded = false;
    m.once('load', () => { loaded = true; });
    const watchdog = window.setTimeout(() => { if (!loaded) cb.current.onFail(); }, 12_000);
    // Un geste du joueur (glisser, pincer, double-toucher) porte `originalEvent` ; un déplacement demandé par l'écran (jumpTo) n'en a pas.
    m.on('movestart', (e) => { if (e.originalEvent) { dragging.current = true; cb.current.onMoveStart?.(); } });
    m.on('moveend', () => {
      const c = m.getCenter();
      const byUser = dragging.current;
      dragging.current = false;
      cb.current.onMoveEnd?.({ lat: c.lat, lng: c.lng }, byUser);
    });
    // La carte change de hauteur (mode épingle) : MapLibre doit le savoir, en gardant le même centre.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    drawMarkers();
    drawMe();
    return () => { ro.disconnect(); window.clearTimeout(watchdog); markerObjs.current = []; meMarker.current = null; m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Déplacement demandé par l'écran (adresse choisie, « Ma position ») : pas un geste du joueur.
  useEffect(() => {
    const m = map.current;
    if (!m || !p.target) return;
    dragging.current = false;
    m.jumpTo({ center: [p.target.center.lng, p.target.center.lat], zoom: p.target.zoom });
  }, [p.target?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawMarkers() {
    const m = map.current;
    if (!m) return;
    for (const mk of markerObjs.current) mk.remove();
    markerObjs.current = cb.current.markers.map((mk) => {
      const el = document.createElement('div');
      el.className = mk.kind === 'community' ? 'mm-mk mm-mk--community' : 'mm-mk';
      el.title = mk.name;
      el.style.width = `${MARKER_SIZE.w}px`;
      el.style.height = `${MARKER_SIZE.h}px`;
      el.innerHTML = markerHtml(mk.name, mk.kind);
      el.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onMarker?.(mk.id); });
      return new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-MARKER_SIZE.anchorX, -MARKER_SIZE.anchorY] })
        .setLngLat([mk.lng, mk.lat]).addTo(m);
    });
  }
  function drawMe() {
    const m = map.current;
    meMarker.current?.remove();
    meMarker.current = null;
    const me = cb.current.me;
    if (!m || !me) return;
    const el = document.createElement('div');
    el.className = 'mm-me';
    el.innerHTML = '<span></span>';
    meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(m);
  }
  useEffect(drawMarkers, [p.markers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(drawMe, [p.me?.lat, p.me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={`mm mm--vector${p.dimMarkers ? ' mm--dim' : ''}`} dir="ltr" role="application" aria-label={p.label} />;
}
