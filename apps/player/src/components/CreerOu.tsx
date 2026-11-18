import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { MatchMap, type MapMarker, type MapTarget } from './MatchMap.js';
import { useT } from '../lib/i18n.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { freePlaceName, partnerSuggestions } from '../lib/freeMatch.js';
import { defaultFieldName, kmText, partnerUnderPin, partnersByDistance, placeSubtitle, type LatLng, type PlaceSuggestion } from '../lib/places.js';
import '../styles/match-view.css';
import '../styles/creer-ou.css';

/* Lot B, phase 1 — « Où tu joues ? » (maquettes 01_Ou_tu_joues et 02_Epingle, planches Cm-B1 et Cm-B1b). La carte s'ouvre tout de suite,
   centrée sur la ville du profil (la position n'est demandée qu'au toucher de « Ma position ») ; les centres partenaires sont sur la carte
   et dans le tiroir, du plus proche au plus loin. Un centre mène au parcours partenaire actuel, inchangé. « Mon terrain n'est pas dans la
   liste », une adresse choisie ou un simple glissement de la carte passent en MODE ÉPINGLE : l'épingle reste au centre, la carte bouge
   dessous, l'adresse suit ; « Nom du terrain » est obligatoire, proposé « Terrain · {quartier} » ; « C'est ici » garde le nom,
   l'adresse et la position. La carte elle-même est MatchMap (seul composant lié à une bibliothèque de carte). */

export interface PartnerPin { id: string; name: string; lat: number | null; lng: number | null; photo: string | null }
export interface ChosenPlace { name: string; area: string | null; address: string | null; wilaya: string | null; lat?: number; lng?: number }

const LIST_MAP_H = 440;
const PIN_MAP_H = 610;
const MAX_ADDRESSES = 5;

export function CreerOu(p: {
  /** Tous les centres publiés (épingles de la carte, recherche). */
  partners: readonly PartnerPin[];
  /** Ceux de la ville du joueur (section « TERRAINS MOUBARAT PRÈS DE TOI ») ; vide : la section disparaît. */
  nearbyPartners: readonly PartnerPin[];
  city: LatLng;
  /** Le lieu déjà choisi (retour par « Modifier ») : la carte s'ouvre dessus, en mode épingle. */
  initial?: ChosenPlace | null;
  search: (q: string, near: LatLng) => Promise<{ results: PlaceSuggestion[]; unavailable: boolean }>;
  reverse: (lat: number, lng: number) => Promise<PlaceSuggestion | null>;
  openingId: string | null;
  error: string | null;
  onPickPartner: (id: string) => void;
  onConfirm: (place: ChosenPlace) => void;
  onBack: () => void;
}) {
  const t = useT();
  const startPin = Boolean(p.initial && p.initial.lat !== undefined);
  const [mode, setMode] = useState<'list' | 'pin'>(startPin ? 'pin' : 'list');
  const [mapKey, setMapKey] = useState(0);
  const [mapDown, setMapDown] = useState(false);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const seq = useRef(0);
  const goTo = (center: LatLng, zoom: number) => { seq.current += 1; setTarget({ center, zoom, seq: seq.current }); };
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const centerRef = useRef<LatLng>(startPin ? { lat: p.initial!.lat!, lng: p.initial!.lng! } : p.city);

  // Recherche : les centres d'abord, puis 5 adresses au plus (attente de 350 ms après la dernière lettre ; seule la dernière réponse compte).
  const [query, setQuery] = useState('');
  const [addresses, setAddresses] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const q = query.trim();
  useEffect(() => {
    setSearched(false);
    if (q.length < 3) { setAddresses([]); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void p.search(q, me ?? p.city).then((res) => {
        if (!alive) return;
        setAddresses(res.results.slice(0, MAX_ADDRESSES));
        setSearching(false);
        setSearched(true);
      });
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const partnerHits = q.length >= 2 ? partnerSuggestions(p.partners, q, 3) : [];

  // Mode épingle : l'endroit sous l'épingle, et le nom du terrain (proposé tant que le joueur ne l'a pas touché).
  const [under, setUnder] = useState<PlaceSuggestion | null>(null);
  const [looking, setLooking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState(p.initial?.name ?? '');
  const [touched, setTouched] = useState(Boolean(p.initial?.name));
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const [askPartner, setAskPartner] = useState<PartnerPin | null>(null);
  const lookSeq = useRef(0);
  const lookTimer = useRef<number | undefined>(undefined);
  function lookUp(c: LatLng) {
    window.clearTimeout(lookTimer.current);
    const mine = ++lookSeq.current;
    setLooking(true);
    lookTimer.current = window.setTimeout(() => {
      void p.reverse(c.lat, c.lng).then((place) => {
        if (mine !== lookSeq.current) return;
        setUnder(place);
        setLooking(false);
        if (!touchedRef.current) setName(defaultFieldName(place?.area, place?.wilaya, t('Terrain · {quartier}')));
      });
    }, 400);
  }
  useEffect(() => { if (startPin) lookUp(centerRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(lookTimer.current), []);

  function enterPin(at: LatLng | null, suggestion?: PlaceSuggestion) {
    setMode('pin');
    setAskPartner(null);
    if (suggestion) {
      setUnder(suggestion);
      setTouched(true);
      setName(suggestion.name);
    }
    if (at) { centerRef.current = at; goTo(at, 17); }
    if (!suggestion) lookUp(at ?? centerRef.current);
  }

  function locate() {
    if (!('geolocation' in navigator) || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(here);
        centerRef.current = here;
        goTo(here, 16);
        if (mode === 'pin') lookUp(here);
      },
      () => setLocating(false),   // refusée ou indisponible : la carte reste sur la ville, aucun message bloquant
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const markers = useMemo<MapMarker[]>(() => p.partners
    .filter((v): v is PartnerPin & { lat: number; lng: number } => v.lat !== null && v.lng !== null)
    .map((v) => ({ id: v.id, name: v.name, lat: v.lat, lng: v.lng })), [p.partners]);
  const nearby = partnersByDistance(p.nearbyPartners, me ?? p.city);
  const nearbyNoPos = p.nearbyPartners.filter((v) => v.lat === null || v.lng === null);

  const validName = freePlaceName(name);
  function confirm() {
    if (!validName) return;
    const c = centerRef.current;
    if (!mapDown && !askPartner) {
      const hit = partnerUnderPin(p.partners, c);
      if (hit) { setAskPartner(hit); return; }
    }
    p.onConfirm({
      name: validName, area: under?.area ?? null, address: under?.street ?? null, wilaya: under?.wilaya ?? null,
      ...(mapDown ? {} : { lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) }),
    });
  }

  const mapH = mode === 'pin' ? PIN_MAP_H : LIST_MAP_H;
  const back = () => { if (mode === 'pin') { setMode('list'); setAskPartner(null); } else p.onBack(); };

  return (
    <section className={`au-screen co co--${mode}`} id="s-creer-ou" style={{ ['--co-map-h' as string]: `${mapH}px` }}>
      <div className="co-map">
        {mapDown ? (
          <div className="co-map__down" role="status">
            <Icon id="i-wifi-off" />
            <span>{t('Carte indisponible. Réessaie.')}</span>
            <button type="button" className="co-retry mb-tap" onClick={() => { setMapDown(false); setMapKey((k) => k + 1); }}>{t('Réessayer')}</button>
          </div>
        ) : (
          <MatchMap
            key={mapKey} label={t('Où tu joues ?')}
            center={centerRef.current} zoom={startPin ? 17 : 13} target={target}
            markers={markers} dimMarkers={mode === 'pin'} me={me}
            onMarker={(id) => p.onPickPartner(id)}
            onMoveStart={() => setMoving(true)}
            onMoveEnd={(c, byUser) => {
              setMoving(false);
              centerRef.current = c;
              if (!byUser) return;
              if (mode === 'list') enterPin(null);   // faire glisser la carte = poser son terrain
              else { setAskPartner(null); lookUp(c); }
            }}
            onUnavailable={() => setMapDown(true)}
          />
        )}
        {mode === 'pin' && !mapDown ? (
          <div className="co-pin" data-moving={moving ? 'true' : undefined} aria-hidden="true">
            <span className="co-pin__tag">{t('Ton terrain')}</span>
            <span className="co-pin__tagtip" />
            <svg width="36" height="48" viewBox="0 0 36 48"><path d="M18 46C18 46 33 29 33 18A15 15 0 1 0 3 18C3 29 18 46 18 46Z" fill="#FF2B00" stroke="#0A0A0F" strokeWidth="2" /><circle cx="18" cy="18" r="6" fill="#FFFFFF" /></svg>
          </div>
        ) : null}
        <div className="co-top">
          <button type="button" className="co-round mb-tap" aria-label={t('Retour')} onClick={back}><Icon id="i-back" /></button>
          {mode === 'pin' && !mapDown ? <span className="co-hint">{t('Fais glisser la carte sur ton terrain')}</span> : null}
        </div>
        {!mapDown ? (
          <button type="button" className="co-round co-locate mb-tap" aria-label={t('Ma position')} aria-busy={locating || undefined} onClick={locate}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </button>
        ) : null}
      </div>

      <div className="co-drawer">
        <span className="co-grab" aria-hidden="true" />
        {mode === 'list' ? (
          <>
            <div className="co-head">
              <h1 className="co-h1">{t('Où tu joues ?')}</h1>
              <span className="co-step"><Ltr>1/2</Ltr></span>
            </div>
            <label className="co-search">
              <Icon id="i-search" />
              <input
                type="text" inputMode="search" enterKeyHint="search" autoComplete="off" dir="auto" maxLength={80} value={query}
                placeholder={t('Chercher un terrain ou une adresse')} aria-label={t('Chercher un terrain ou une adresse')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {p.error ? <p className="co-err" role="alert">{p.error}</p> : null}

            {q.length >= 2 ? (
              <div className="co-list">
                {partnerHits.map((v) => <PartnerRow key={v.id} v={v} km={null} busy={p.openingId === v.id} onPick={p.onPickPartner} />)}
                {addresses.map((a) => (
                  <button key={a.id} type="button" className="co-row co-row--place mb-tap" onClick={() => enterPin({ lat: a.lat, lng: a.lng }, a)}>
                    <span className="co-row__ic co-row__ic--pin"><Icon id="i-pin" /></span>
                    <span className="co-row__txt">
                      <b dir="auto">{a.name}</b>
                      {placeSubtitle(a) ? <span dir="auto">{placeSubtitle(a)}</span> : null}
                    </span>
                    <Icon id="i-arrow" className="co-row__go" />
                  </button>
                ))}
                {searching ? <p className="co-meta" role="status">{t('Recherche de l’adresse…')}</p> : null}
                {!searching && searched && partnerHits.length === 0 && addresses.length === 0 ? (
                  <div className="co-none">
                    <p className="co-meta">{t('Aucun lieu trouvé')}</p>
                    <button type="button" className="co-free mb-tap" onClick={() => enterPin(null)}>
                      <Icon id="i-pin" />{t('Montrer mon terrain sur la carte')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                {nearby.length + nearbyNoPos.length > 0 ? (
                  <>
                    <div className="co-label">{t('TERRAINS MOUBARAT PRÈS DE TOI')}</div>
                    <div className="co-list">
                      {nearby.map((v) => <PartnerRow key={v.id} v={v} km={v.km} busy={p.openingId === v.id} onPick={p.onPickPartner} />)}
                      {nearbyNoPos.map((v) => <PartnerRow key={v.id} v={v} km={null} busy={p.openingId === v.id} onPick={p.onPickPartner} />)}
                    </div>
                  </>
                ) : null}
              </>
            )}
            {q.length < 2 || (searched && (partnerHits.length > 0 || addresses.length > 0)) ? (
              <button type="button" className="co-free mb-tap" onClick={() => enterPin(null)}>
                <Icon id="i-pin" />{t('Mon terrain n’est pas dans la liste')}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="co-addr" aria-live="polite">
              <Icon id="i-pin" className="co-addr__ic" />
              <span className="co-addr__txt">
                {under ? (
                  <>
                    <b><Ltr>{under.street ?? under.name}</Ltr></b>
                    <span><Ltr>{[under.area, under.wilaya].filter(Boolean).join(' · ')}</Ltr></span>
                  </>
                ) : <span>{looking ? t('Recherche de l’adresse…') : ''}</span>}
              </span>
            </div>
            <input
              className="co-name" dir="auto" maxLength={80} value={name} aria-label={t('Nom du terrain')} placeholder={t('Nom du terrain')}
              onChange={(e) => { setTouched(true); setName(e.target.value); }}
            />
            <button type="button" className="mv-cta mb-tap" disabled={!validName} onClick={confirm}>{t('C’est ici')}</button>
          </>
        )}
      </div>

      {askPartner ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-labelledby="co-ask-t" onClick={() => setAskPartner(null)}>
          <div className="mb-sheet xp-cob co-ask" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="co-ask__t" id="co-ask-t">{fillTemplate(t('C’est {centre} ?'), { centre: askPartner.name })}</h3>
            <button type="button" className="mv-cta mb-tap" onClick={() => p.onPickPartner(askPartner.id)}>{t('Oui, c’est ce centre')}</button>
            <button type="button" className="co-ask__no mb-tap" onClick={() => { setAskPartner(null); p.onConfirm({
              name: validName ?? name, area: under?.area ?? null, address: under?.street ?? null, wilaya: under?.wilaya ?? null,
              lat: Number(centerRef.current.lat.toFixed(6)), lng: Number(centerRef.current.lng.toFixed(6)),
            }); }}>{t('Non, un autre terrain')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PartnerRow({ v, km, busy, onPick }: { v: PartnerPin; km: number | null; busy: boolean; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <button type="button" className="co-row mb-tap" aria-busy={busy || undefined} disabled={busy} onClick={() => onPick(v.id)}>
      <span className="co-row__ic co-row__ic--logo" aria-hidden="true">
        {v.photo ? <img src={v.photo} alt="" loading="lazy" /> : (
          <svg width="22" height="22" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
        )}
      </span>
      <span className="co-row__txt">
        <b><Ltr>{v.name}</Ltr></b>
        <span className="co-row__meta">
          <span className="co-badge">{t('PARTENAIRE')}</span>
          {km !== null ? <Ltr>{fillTemplate(t('{n} km'), { n: kmText(km) })}</Ltr> : null}
        </span>
      </span>
      <Icon id="i-arrow" className="co-row__go" />
    </button>
  );
}
