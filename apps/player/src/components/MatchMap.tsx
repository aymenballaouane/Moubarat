import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { GoogleMap } from './map/GoogleMap.js';
import { LeafletMap } from './map/LeafletMap.js';
import { useLang } from '../lib/i18n.js';
import type { MapViewProps } from './map/types.js';

export type { MapMarker, MapTarget } from './map/types.js';

/* La carte de « Créer un match » — le SEUL composant que les écrans utilisent (décision d'Aymen du 18/11/2026 : « isole la carte dans un
   seul composant »). Ordre (lot B, phases 5 et 7, 19/11/2026) :
   1. Google Maps, seulement si le serveur donne une clé (`googleKey`) — en réserve, éteint par décision d'Aymen ;
   2. la « carte Moubarat » (MapLibre + tuiles OpenFreeMap, map/VectorMap.tsx), la carte normale ;
   3. Leaflet en dernier secours (sans fond de carte autorisé en production, il dit « Carte indisponible »).
   `googleKey === undefined` : la clé n'est pas encore connue, la carte attend (fond uni). Mêmes entrées et sorties pour les trois. */

/** Le fichier de la carte Moubarat n'a pas pu se charger (hors ligne, nouvelle version en ligne) : la carte de secours, jamais un écran planté. */
class LoadGuard extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.onFail(); }
  override render() { return this.state.failed ? <div className="mm" aria-hidden="true" /> : this.props.children; }
}

const VectorMap = lazy(() => import('./map/VectorMap.js').then((m) => ({ default: m.VectorMap })));

export function MatchMap(p: MapViewProps & { googleKey: string | null | undefined }) {
  const lang = useLang();
  const [googleDown, setGoogleDown] = useState(false);
  const [vectorDown, setVectorDown] = useState(false);
  const { googleKey, ...view } = p;
  if (googleKey === undefined) return <div className="mm" aria-hidden="true" />;
  if (googleKey && !googleDown) return <GoogleMap {...view} apiKey={googleKey} lang={lang} onFail={() => setGoogleDown(true)} />;
  if (!vectorDown) {
    return (
      <LoadGuard onFail={() => setVectorDown(true)}>
        <Suspense fallback={<div className="mm" aria-hidden="true" />}>
          <VectorMap {...view} lang={lang === 'ar' ? 'ar' : 'fr'} onFail={() => setVectorDown(true)} />
        </Suspense>
      </LoadGuard>
    );
  }
  return <LeafletMap {...view} />;
}
