import { apiUrl } from './api.js';

/* Phase photos (option A d'Aymen, 17/11/2026) — l'adresse de la photo principale d'un centre. `large` : la bande de la fiche et du
   détail du match (~1600×800) ; `card` : les cartes et les vignettes (~640×320). La version (qui change à chaque nouvel envoi depuis le
   CRM) fait partie de l'adresse : le navigateur garde l'image en cache sans jamais montrer une ancienne photo. `null` sans photo — l'écran
   affiche alors le logo Moubarat (ou l'illustration du sport sur une carte de match). */
export type VenuePhotoSize = 'large' | 'card';

export function venuePhotoUrl(venueId: string | null | undefined, version: number | null | undefined, size: VenuePhotoSize): string | null {
  if (!venueId || !version) return null;
  return apiUrl(`/venues/${encodeURIComponent(venueId)}/photo/${size}?v=${version}`);
}
