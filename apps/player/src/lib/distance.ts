/* Distance à vol d'oiseau (Haversine) entre deux points — sert à trier (Accueil, Explorer) et, depuis le 26/10/2026 (réponse d'Aymen : « la règle 33 ne l'interdit pas, elle
   interdit seulement d'envoyer la position au serveur »), à écrire « à 3,4 km » sur la fiche d'un match. Toujours calculée sur le téléphone. */

export interface GeoPosition { lat: number; lng: number }

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: GeoPosition, b: GeoPosition): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** « 3,4 km » / « 3,4 كم » — un chiffre après la virgule, comme les maquettes (chiffres occidentaux en arabe aussi). Moins de 100 m : « 0,1 km » plutôt que « 0 ». */
export function distanceKmText(km: number, lang: 'fr' | 'ar'): string {
  const n = Math.max(0.1, Math.round(km * 10) / 10);
  const num = n.toLocaleString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${num} ${lang === 'ar' ? 'كم' : 'km'}`;
}
