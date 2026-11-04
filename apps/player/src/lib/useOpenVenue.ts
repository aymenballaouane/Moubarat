import { useState } from 'react';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';

/** Ouvrir un centre = charger sa fiche complète (les écrans de réservation lisent `store.venue`), PUIS aller à
    la réservation — jamais l'inverse, sinon l'écran s'ouvrirait sur le centre précédent. Partagé par
    l'Explorer et le Home (une seule façon d'ouvrir un centre). `openingId` : le centre en cours de
    chargement (la carte se met en attente), `error` : le message du serveur si la fiche n'a pas pu être lue. */
export function useOpenVenue(store: AppStore, onNavigate: (route: Route) => void) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openVenue(venueId: string): Promise<void> {
    if (openingId !== null) return;
    setError(null);
    setOpeningId(venueId);
    const res = await store.selectVenue(venueId);
    setOpeningId(null);
    if (res.ok) onNavigate({ name: 'booking', venuePicked: true });
    else setError(res.message ?? 'Ce centre est indisponible pour le moment.');
  }

  return { openVenue, openingId, error, clearError: () => setError(null) };
}
