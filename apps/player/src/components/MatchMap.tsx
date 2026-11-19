import { useState } from 'react';
import { GoogleMap } from './map/GoogleMap.js';
import { LeafletMap } from './map/LeafletMap.js';
import { useLang } from '../lib/i18n.js';
import type { MapViewProps } from './map/types.js';

export type { MapMarker, MapTarget } from './map/types.js';

/* La carte de « Créer un match » — le SEUL composant que les écrans utilisent (décision d'Aymen du 18/11/2026 : « isole la carte dans un
   seul composant »). Lot B, phase 5 (19/11/2026) : Google Maps quand le serveur donne une clé (`googleKey`), sinon — ou si Google refuse
   ou ne se charge pas — la carte Leaflet d'avant, gardée en secours. `googleKey === undefined` : la clé n'est pas encore connue, la carte
   attend (fond uni) pour ne pas charger deux bibliothèques. Les deux cartes ont les mêmes entrées et sorties (map/types.ts). */

export function MatchMap(p: MapViewProps & { googleKey: string | null | undefined }) {
  const lang = useLang();
  const [googleDown, setGoogleDown] = useState(false);
  const { googleKey, ...view } = p;
  if (googleKey === undefined) return <div className="mm" aria-hidden="true" />;
  if (googleKey && !googleDown) return <GoogleMap {...view} apiKey={googleKey} lang={lang} onFail={() => setGoogleDown(true)} />;
  return <LeafletMap {...view} />;
}
