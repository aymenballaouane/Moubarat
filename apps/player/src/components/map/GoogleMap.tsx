import { useEffect, useRef } from 'react';
import { MARKER_SIZE, markerHtml, type MapViewProps } from './types.js';
import '../../styles/match-map.css';

/* Lot B, phase 5 (19/11/2026, décision d'Aymen : Google Maps pour la carte de « Créer un match ») — la carte normale. Mêmes entrées et
   sorties que LeafletMap.tsx, qui reste en secours : sans clé, clé refusée (`gm_authFailure` : clé invalide, site non autorisé,
   facturation coupée), script injoignable ou trop lent → `onFail`, et MatchMap.tsx passe à Leaflet.
   La clé est celle du navigateur (publique par nature, limitée au site et à Maps JavaScript API dans la console Google), servie par
   GET /places/map-config — jamais écrite dans le code. Chaque ouverture de la carte compte UN chargement chez Google (palier gratuit :
   10 000 par mois). Pas de bibliothèque ajoutée : le script officiel est chargé une fois, et les épingles des centres sont du HTML
   (OverlayView), exactement celles de la maquette Cm-B1 — pas besoin d'identifiant de carte (« Map ID »). */

/* eslint-disable @typescript-eslint/no-explicit-any -- le script Google n'a pas de types installés ici (aucune dépendance ajoutée). */
type GMaps = any;

declare global {
  interface Window { google?: { maps?: GMaps }; gm_authFailure?: () => void; __mbGoogleMapsReady?: () => void }
}

let loading: Promise<GMaps> | null = null;
const authFailures = new Set<() => void>();
let authFailed = false;

function loadGoogleMaps(key: string, lang: string): Promise<GMaps> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  window.gm_authFailure = () => { authFailed = true; for (const f of authFailures) f(); };
  loading = new Promise<GMaps>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), 12_000);
    window.__mbGoogleMapsReady = () => { window.clearTimeout(timer); resolve(window.google!.maps); };
    const s = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__mbGoogleMapsReady', language: lang, region: 'DZ' });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => { window.clearTimeout(timer); reject(new Error('script')); };
    document.head.appendChild(s);
  }).catch((err) => { loading = null; throw err; });
  return loading;
}

/** Thème clair ou sombre de l'app (body[data-theme], sinon le réglage du téléphone) — même règle que styles/theme-app-joueur.css. */
function isLight(): boolean {
  const t = document.body.dataset.theme;
  if (t === 'clair') return true;
  if (t === 'sombre') return false;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
}

/* Les commerces et lieux de Google masqués : sur cette carte, seuls comptent les centres Moubarat et l'épingle du joueur. */
const QUIET = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.sports_complex', stylers: [{ visibility: 'on' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
/* Style sombre (maquette Cm-B1 sombre : fond #0E1319, routes discrètes). */
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#151c26' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a94a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e1319' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a3442' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#14251c' }] },
  { featureType: 'poi.sports_complex', elementType: 'geometry', stylers: [{ color: '#14251c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#232c39' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a212c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2f3a4a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9aa4b5' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1724' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d8c' }] },
];

/** Une épingle HTML posée sur la carte (centre partenaire ou position du joueur). */
function htmlOverlay(maps: GMaps, at: { lat: number; lng: number }, el: HTMLElement, anchor: { x: number; y: number }, onClick?: () => void): GMaps {
  class Overlay extends maps.OverlayView {
    onAdd() {
      el.style.position = 'absolute';
      if (onClick) {
        el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        maps.OverlayView.preventMapHitsAndGesturesFrom(el);
      }
      (this as GMaps).getPanes()[onClick ? 'overlayMouseTarget' : 'overlayLayer'].appendChild(el);
    }
    draw() {
      const pos = (this as GMaps).getProjection().fromLatLngToDivPixel(new maps.LatLng(at.lat, at.lng));
      if (!pos) return;
      el.style.left = `${pos.x - anchor.x}px`;
      el.style.top = `${pos.y - anchor.y}px`;
    }
    onRemove() { el.remove(); }
  }
  return new Overlay();
}

export function GoogleMap(p: MapViewProps & { apiKey: string; lang: string; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<GMaps>(null);
  const maps = useRef<GMaps>(null);
  const markerOverlays = useRef<GMaps[]>([]);
  const meOverlay = useRef<GMaps>(null);
  const dragging = useRef(false);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let alive = true;
    const fail = () => { if (alive) cb.current.onFail(); };
    if (authFailed) { fail(); return undefined; }
    authFailures.add(fail);
    void loadGoogleMaps(p.apiKey, p.lang).then((g) => {
      if (!alive || !box.current) return;
      maps.current = g;
      const m = new g.Map(box.current, {
        center: { lat: p.center.lat, lng: p.center.lng }, zoom: p.zoom,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', keyboardShortcuts: false,
        backgroundColor: isLight() ? '#EEF1F5' : '#0E1319',
        styles: isLight() ? QUIET : [...DARK, ...QUIET],
      });
      map.current = m;
      m.addListener('dragstart', () => { dragging.current = true; cb.current.onMoveStart?.(); });
      m.addListener('idle', () => {
        const c = m.getCenter();
        if (!c) return;
        const byUser = dragging.current;
        dragging.current = false;
        cb.current.onMoveEnd?.({ lat: c.lat(), lng: c.lng() }, byUser);
      });
      drawMarkers();
      drawMe();
    }, fail);
    return () => {
      alive = false;
      authFailures.delete(fail);
      for (const o of markerOverlays.current) o.setMap(null);
      meOverlay.current?.setMap(null);
      if (map.current && maps.current) maps.current.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Déplacement demandé par l'écran (adresse choisie, « Ma position ») : pas un geste du joueur.
  useEffect(() => {
    const m = map.current;
    if (!m || !p.target) return;
    dragging.current = false;   // un déplacement demandé par l'écran n'est jamais un geste du joueur
    m.setZoom(p.target.zoom);
    m.setCenter({ lat: p.target.center.lat, lng: p.target.center.lng });
  }, [p.target?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawMarkers() {
    const g = maps.current;
    const m = map.current;
    if (!g || !m) return;
    for (const o of markerOverlays.current) o.setMap(null);
    markerOverlays.current = cb.current.markers.map((mk) => {
      const el = document.createElement('div');
      el.className = mk.kind === 'community' ? 'mm-mk mm-mk--community' : 'mm-mk';
      el.title = mk.name;
      el.style.width = `${MARKER_SIZE.w}px`;
      el.style.height = `${MARKER_SIZE.h}px`;
      el.innerHTML = markerHtml(mk.name, mk.kind);
      const o = htmlOverlay(g, mk, el, { x: MARKER_SIZE.anchorX, y: MARKER_SIZE.anchorY }, () => cb.current.onMarker?.(mk.id));
      o.setMap(m);
      return o;
    });
  }
  function drawMe() {
    const g = maps.current;
    const m = map.current;
    meOverlay.current?.setMap(null);
    meOverlay.current = null;
    const me = cb.current.me;
    if (!g || !m || !me) return;
    const el = document.createElement('div');
    el.className = 'mm-me';
    el.innerHTML = '<span></span>';
    meOverlay.current = htmlOverlay(g, me, el, { x: 17, y: 17 });
    meOverlay.current.setMap(m);
  }
  useEffect(drawMarkers, [p.markers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(drawMe, [p.me?.lat, p.me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={`mm mm--google${p.dimMarkers ? ' mm--dim' : ''}`} dir="ltr" role="application" aria-label={p.label} />;
}
