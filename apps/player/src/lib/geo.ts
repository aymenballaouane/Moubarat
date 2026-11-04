import { useEffect, useState } from 'react';
import type { GeoPosition } from './distance.js';

/* Position du joueur — règle 33 (refonte-app-joueur/docs/regles.md) : demandée au téléphone,
   JAMAIS envoyée au serveur ni enregistrée (ni localStorage : juste l'état React de cette
   visite, perdu au rechargement, redemandé à chaque ouverture de l'écran). Sert au TRI côté client
   (Accueil, Explorer) et à la distance « à X km » de la fiche d'un match (réponse d'Aymen, 26/10/2026) ;
   refusée ou indisponible : aucune distance n'est affichée. */

export type GeoStatus = 'loading' | 'granted' | 'denied' | 'unavailable';

export function useGeolocation(): { status: GeoStatus; position: GeoPosition | null } {
  const [status, setStatus] = useState<GeoStatus>('loading');
  const [position, setPosition] = useState<GeoPosition | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus('granted');
      },
      () => {
        if (!cancelled) setStatus('denied');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
    return () => { cancelled = true; };
  }, []);

  return { status, position };
}
