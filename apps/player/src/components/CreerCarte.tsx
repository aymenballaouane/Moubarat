import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon } from './Icon.js';
import { CreerHeader } from './CreerMatch.js';
import { useT } from '../lib/i18n.js';
import { freePlaceName } from '../lib/freeMatch.js';
import { placeSubtitle, type LatLng, type PlaceSuggestion } from '../lib/places.js';
import '../styles/creer-libre.css';
import '../styles/creer-carte.css';

/* Créer un match libre — « Où exactement ? » (lot « Match libre », phase adresses — GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet).
   Comme dans les applis de VTC : la carte bouge sous une épingle FIXE au centre ; on la lâche sur le terrain. Sous l'épingle, le nom de
   l'endroit (OpenStreetMap, via notre serveur). Le nom du lieu reste modifiable : c'est lui que verront les joueurs. « C'est ici » garde
   le nom, la position et la wilaya ; la suite (W3) est inchangée.

   Fond de carte : les images d'OpenStreetMap par défaut, avec leur mention obligatoire ; `VITE_MAP_TILES_URL` permet de passer à un autre
   fournisseur sans toucher au code (les serveurs d'OpenStreetMap ne sont pas faits pour une app très utilisée — docs/DECISIONS.md). */

const TILES_URL = import.meta.env.VITE_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_ATTRIBUTION = import.meta.env.VITE_MAP_TILES_ATTRIBUTION ?? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function CreerCarte(p: {
  center: LatLng;
  zoom: number;
  /** Le nom déjà connu (adresse choisie ou texte tapé) ; vide : le nom de l'endroit sous l'épingle le remplit. */
  initialName: string;
  onReverse: (lat: number, lng: number) => Promise<PlaceSuggestion | null>;
  onConfirm: (place: { name: string; lat: number; lng: number; osmWilaya: string | null }) => void;
  onBack: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [name, setName] = useState(p.initialName);
  const [touched, setTouched] = useState(p.initialName.trim() !== '');
  const [under, setUnder] = useState<PlaceSuggestion | null>(null);
  const [moving, setMoving] = useState(false);
  const reverseRef = useRef(p.onReverse);
  reverseRef.current = p.onReverse;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([p.center.lat, p.center.lng], p.zoom);
    L.tileLayer(TILES_URL, { maxZoom: 19, attribution: TILES_ATTRIBUTION }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    map.current = m;
    let timer: number | undefined;
    let seq = 0;
    const lookUp = () => {
      const c = m.getCenter();
      const mine = ++seq;
      void reverseRef.current(c.lat, c.lng).then((place) => {
        if (mine !== seq) return;
        setUnder(place);
        if (place && !touchedRef.current) setName(place.name);
      });
    };
    m.on('movestart', () => { setMoving(true); window.clearTimeout(timer); });
    m.on('moveend', () => { setMoving(false); window.clearTimeout(timer); timer = window.setTimeout(lookUp, 500); });
    lookUp();
    return () => { window.clearTimeout(timer); m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = freePlaceName(name);
  function confirm() {
    const c = map.current?.getCenter();
    if (!c || !valid) return;
    p.onConfirm({ name: valid, lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)), osmWilaya: under?.wilaya ?? null });
  }

  return (
    <section className="au-screen cr cl cc" id="s-creer-carte">
      <CreerHeader step={1} onBack={p.onBack} />
      <h1 className="rv2-h1 cl-h1 cc-h1">{t('Où exactement ?')}</h1>
      <p className="cc-hint">{t('Déplace la carte pour poser l’épingle sur le terrain.')}</p>
      <div className="cc-map">
        <div ref={box} className="cc-map__leaflet" dir="ltr" />
        <span className="cc-pin" data-moving={moving ? 'true' : undefined} aria-hidden="true"><Icon id="i-pin" /></span>
      </div>
      <p className="cc-under" aria-live="polite">
        {under ? <><b dir="auto">{under.name}</b>{placeSubtitle(under) ? <> · <span dir="auto">{placeSubtitle(under)}</span></> : null}</> : t('Recherche de l’adresse…')}
      </p>
      <label className="cv-q cc-label" htmlFor="cc-name">{t('Nom du lieu')}</label>
      <input
        id="cc-name" className="rsv-r3__name cc-name" dir="auto" maxLength={80} value={name}
        placeholder={t('Nom du terrain ou adresse')}
        onChange={(e) => { setTouched(true); setName(e.target.value); }}
      />
      <footer className="rsv-r3__foot cl-foot">
        <button type="button" className="mv-cta mb-tap" disabled={!valid} onClick={confirm}>{t('C’est ici')}</button>
      </footer>
    </section>
  );
}
