import type { LatLng } from '../../lib/places.js';

/* Lot B, phase 5 — ce que l'écran donne à la carte et ce qu'elle lui rend, quelle que soit la bibliothèque (Google Maps ou Leaflet). */

export interface MapMarker { id: string; name: string; lat: number; lng: number }
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
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Un centre partenaire : le logo Moubarat dans un carré, une pointe, le nom dessous (maquette Cm-B1). Boîte 160 × 70, pointe à (80, 46). */
export function markerHtml(name: string): string {
  return `<span class="mm-mk__tile">${LOGO}</span><span class="mm-mk__tip"></span><span class="mm-mk__name" dir="ltr">${esc(name)}</span>`;
}
export const MARKER_SIZE = { w: 160, h: 70, anchorX: 80, anchorY: 46 } as const;
