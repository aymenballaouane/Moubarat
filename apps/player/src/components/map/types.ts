import type { LatLng } from '../../lib/places.js';

/* Lot B, phase 5 — ce que l'écran donne à la carte et ce qu'elle lui rend, quelle que soit la bibliothèque (Google Maps ou Leaflet). */

export interface MapMarker {
  id: string; name: string; lat: number; lng: number;
  /** Lot B, phase 6 : un centre partenaire (logo, défaut) ou un terrain de la communauté (rond or). */
  kind?: 'partner' | 'community';
}
/** Un déplacement demandé par l'écran (adresse choisie, « Ma position ») : `seq` change à chaque demande. */
export interface MapTarget { center: LatLng; zoom: number; seq: number }

export interface MapViewProps {
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
}

const LOGO = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9"/><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00"/></svg>';
/** Un terrain (icône de la maquette « Nos lieux d'abord »). */
const PITCH = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="3"/></svg>';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Un centre partenaire : le logo Moubarat dans un carré, une pointe, le nom dessous (maquette Cm-B1). Boîte 160 × 70, pointe à (80, 46). */
export function markerHtml(name: string, kind: MapMarker['kind'] = 'partner'): string {
  if (kind === 'community') return `<span class="mm-mk__tile mm-mk__tile--community">${PITCH}</span><span class="mm-mk__tip"></span><span class="mm-mk__name" dir="ltr">${esc(name)}</span>`;
  return `<span class="mm-mk__tile">${LOGO}</span><span class="mm-mk__tip"></span><span class="mm-mk__name" dir="ltr">${esc(name)}</span>`;
}
export const MARKER_SIZE = { w: 160, h: 70, anchorX: 80, anchorY: 46 } as const;
