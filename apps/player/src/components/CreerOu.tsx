import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { MatchMap, type MapMarker, type MapTarget } from './MatchMap.js';
import { useT } from '../lib/i18n.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { freePlaceName, partnerSuggestions } from '../lib/freeMatch.js';
import { communityNear, communitySuggestions, defaultFieldName, kmText, newPlacesSession, partnerUnderPin, partnersByDistance, placeSubtitle, type CommunityPlace, type LatLng, type PlaceSuggestion } from '../lib/places.js';
import { useTn } from '../lib/i18n.js';
import '../styles/match-view.css';
import '../styles/creer-ou.css';

/* Lot B, phase 1 — « Où tu joues ? » (maquettes 01_Ou_tu_joues et 02_Epingle, planches Cm-B1 et Cm-B1b). La carte s'ouvre tout de suite,
   centrée sur la ville du profil (la position n'est demandée qu'au toucher de « Ma position ») ; les centres partenaires sont sur la carte
   et dans le tiroir, du plus proche au plus loin. Un centre mène au parcours partenaire actuel, inchangé. « Mon terrain n'est pas dans la
   liste », une adresse choisie ou un simple glissement de la carte passent en MODE ÉPINGLE : l'épingle reste au centre, la carte bouge
   dessous, l'adresse suit ; « Nom du terrain » est obligatoire, proposé « Terrain · {quartier} » ; « C'est ici » garde le nom,
   l'adresse et la position. La carte elle-même est MatchMap (seul composant lié à une bibliothèque de carte). */

export interface PartnerPin { id: string; name: string; lat: number | null; lng: number | null; photo: string | null }
export interface ChosenPlace {
  name: string; area: string | null; address: string | null; wilaya: string | null; lat?: number; lng?: number;
  /** Lot B, phase 6 : un terrain de la communauté choisi ; ou `share` : « Ajouter ce terrain à Moubarat ». */
  placeId?: string; share?: boolean;
}

const LIST_MAP_H = 440;
const PIN_MAP_H = 520;   // lot B, phase 6 : 610 → 520, la case « Ajouter ce terrain à Moubarat » doit tenir sous la carte (maquette Nos lieux d'abord, écran 2)
const MAX_ADDRESSES = 5;

export function CreerOu(p: {
  /** Tous les centres publiés (épingles de la carte, recherche). */
  partners: readonly PartnerPin[];
  /** Ceux de la ville du joueur (section « TERRAINS MOUBARAT PRÈS DE TOI ») ; vide : la section disparaît. */
  nearbyPartners: readonly PartnerPin[];
  city: LatLng;
  /** Le lieu déjà choisi (retour par « Modifier ») : la carte s'ouvre dessus, en mode épingle. */
  initial?: ChosenPlace | null;
  search: (q: string, near: LatLng, session: string) => Promise<{ results: PlaceSuggestion[]; unavailable: boolean }>;
  /** Lot B, phase 5 : la position d'une suggestion de Google (elle n'en a pas), au toucher. */
  details: (s: PlaceSuggestion, session: string) => Promise<PlaceSuggestion | null>;
  /** Lot B, phase 5 : la clé de la carte Google (`null` : carte de secours). */
  mapConfig: () => Promise<string | null>;
  /** Lot B, phase 6 : les terrains de la communauté autour d'un point (vérifiés, plus ceux que j'ai ajoutés). */
  loadCommunity: (near: LatLng) => Promise<CommunityPlace[]>;
  reverse: (lat: number, lng: number) => Promise<PlaceSuggestion | null>;
  openingId: string | null;
  error: string | null;
  onPickPartner: (id: string) => void;
  onConfirm: (place: ChosenPlace) => void;
  onBack: () => void;
}) {
  const t = useT();
  const tn = useTn();
  const startPin = Boolean(p.initial && p.initial.lat !== undefined);
  const [mode, setMode] = useState<'list' | 'pin'>(startPin ? 'pin' : 'list');
  const [mapKey, setMapKey] = useState(0);
  const [mapDown, setMapDown] = useState(false);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const seq = useRef(0);
  const goTo = (center: LatLng, zoom: number) => { seq.current += 1; setTarget({ center, zoom, seq: seq.current }); };
  const [me, setMe] = useState<LatLng | null>(null);
  const [googleKey, setGoogleKey] = useState<string | null | undefined>(undefined);
  // Lot B, phase 6 : les terrains de la communauté (carte, recherche, « C'est l'un de ces terrains ? »), chargés une fois autour de la ville.
  const [community, setCommunity] = useState<CommunityPlace[]>([]);
  useEffect(() => { let alive = true; void p.loadCommunity(p.city).then((list) => { if (alive) setCommunity(list); }); return () => { alive = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Le terrain de la communauté choisi (liste, carte ou « C'est lui ») ; glisser la carte loin de lui ou changer son nom l'oublie.
  const [chosen, setChosen] = useState<CommunityPlace | null>(null);
  const [share, setShare] = useState(true);
  const [askNear, setAskNear] = useState<(CommunityPlace & { m: number })[] | null>(null);
  useEffect(() => { let alive = true; void p.mapConfig().then((k) => { if (alive) setGoogleKey(k); }); return () => { alive = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [locating, setLocating] = useState(false);
  const centerRef = useRef<LatLng>(startPin ? { lat: p.initial!.lat!, lng: p.initial!.lng! } : p.city);

  // Recherche : les centres d'abord, puis 5 adresses au plus (attente de 350 ms après la dernière lettre ; seule la dernière réponse compte).
  const [query, setQuery] = useState('');
  const [addresses, setAddresses] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const q = query.trim();
  // Une « session » de recherche (Google facture ensemble la frappe et le choix de l'adresse) : neuve après chaque adresse choisie.
  const session = useRef(newPlacesSession());
  const [resolving, setResolving] = useState<string | null>(null);
  useEffect(() => {
    setSearched(false);
    if (q.length < 3) { setAddresses([]); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void p.search(q, me ?? p.city, session.current).then((res) => {
        if (!alive) return;
        setAddresses(res.results.slice(0, MAX_ADDRESSES));
        setSearching(false);
        setSearched(true);
      });
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const partnerHits = q.length >= 2 ? partnerSuggestions(p.partners, q, 3) : [];
  const communityHits = q.length >= 2 ? communitySuggestions(community, q, 3) : [];

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
    setChosen(null);
    if (suggestion) {
      setUnder(suggestion);
      setTouched(true);
      setName(suggestion.name);
    }
    if (at) { centerRef.current = at; goTo(at, 17); }
    if (!suggestion) lookUp(at ?? centerRef.current);
  }

  /** Une adresse touchée : sa position tout de suite (OpenStreetMap), ou demandée à Google d'abord. Google muet : l'épingle se pose
      là où est la carte, avec le nom de l'adresse — le joueur la fait glisser sur son terrain. */
  async function pickAddress(a: PlaceSuggestion) {
    if (resolving) return;
    if (a.lat !== null && a.lng !== null && !a.needsDetails) { enterPin({ lat: a.lat, lng: a.lng }, a); return; }
    setResolving(a.id);
    const full = await p.details(a, session.current);
    session.current = newPlacesSession();
    setResolving(null);
    if (full && full.lat !== null && full.lng !== null) enterPin({ lat: full.lat, lng: full.lng }, full);
    else enterPin(null, a);
  }

  /** Un terrain de la communauté choisi : l'épingle s'y pose, avec son nom et son adresse. */
  function pickCommunity(c: CommunityPlace) {
    enterPin({ lat: c.lat, lng: c.lng }, { id: c.id, name: c.name, detail: '', wilaya: c.wilaya, street: c.address, area: c.area, lat: c.lat, lng: c.lng });
    setChosen(c);
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

  const markers = useMemo<MapMarker[]>(() => [
    ...community.map((c) => ({ id: `c:${c.id}`, name: c.name, lat: c.lat, lng: c.lng, kind: 'community' as const })),
    ...p.partners
      .filter((v): v is PartnerPin & { lat: number; lng: number } => v.lat !== null && v.lng !== null)
      .map((v) => ({ id: v.id, name: v.name, lat: v.lat, lng: v.lng })),
  ], [p.partners, community]);
  function onMarker(id: string) {
    if (!id.startsWith('c:')) { p.onPickPartner(id); return; }
    const c = community.find((x) => `c:${x.id}` === id);
    if (c) pickCommunity(c);
  }
  const nearby = partnersByDistance(p.nearbyPartners, me ?? p.city);
  const nearbyNoPos = p.nearbyPartners.filter((v) => v.lat === null || v.lng === null);

  const validName = freePlaceName(name);
  function confirmHere(opts: { checkNear: boolean }) {
    const c = centerRef.current;
    if (chosen) { p.onConfirm({ name: chosen.name, area: chosen.area, address: chosen.address, wilaya: chosen.wilaya, lat: chosen.lat, lng: chosen.lng, placeId: chosen.id }); return; }
    if (opts.checkNear && !mapDown) {
      const near = communityNear(community, c);
      if (near.length > 0) { setAskNear(near.slice(0, 3)); return; }
    }
    p.onConfirm({
      name: validName ?? name, area: under?.area ?? null, address: under?.street ?? null, wilaya: under?.wilaya ?? null,
      ...(mapDown ? {} : { lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)), share }),
    });
  }
  function confirm() {
    if (!validName) return;
    const c = centerRef.current;
    if (!mapDown && !askPartner && !chosen) {
      const hit = partnerUnderPin(p.partners, c);
      if (hit) { setAskPartner(hit); return; }
    }
    confirmHere({ checkNear: true });
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
            key={mapKey} label={t('Où tu joues ?')} googleKey={googleKey}
            center={centerRef.current} zoom={startPin ? 17 : 13} target={target}
            markers={markers} dimMarkers={mode === 'pin'} me={me}
            onMarker={onMarker}
            onMoveStart={() => setMoving(true)}
            onMoveEnd={(c, byUser) => {
              setMoving(false);
              centerRef.current = c;
              if (!byUser) return;
              if (mode === 'list') enterPin(null);   // faire glisser la carte = poser son terrain
              else {
                setAskPartner(null);
                if (chosen && communityNear([chosen], c, 40).length === 0) setChosen(null);   // loin du terrain choisi : c'est un autre terrain
                if (!chosen || communityNear([chosen], c, 40).length === 0) lookUp(c);
              }
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
                {partnerHits.length > 0 ? <div className="co-label">{t('TERRAINS MOUBARAT')}</div> : null}
                {partnerHits.map((v) => <PartnerRow key={v.id} v={v} km={null} busy={p.openingId === v.id} onPick={p.onPickPartner} />)}
                {communityHits.length > 0 ? <div className="co-label">{t('TERRAINS DE LA COMMUNAUTÉ')}</div> : null}
                {communityHits.map((c) => <CommunityRow key={c.id} c={c} onPick={() => pickCommunity(c)} />)}
                {addresses.length > 0 ? <div className="co-label">{t('ADRESSES')}</div> : null}
                {addresses.map((a) => (
                  <button key={a.id} type="button" className="co-row co-row--place mb-tap" aria-busy={resolving === a.id || undefined} disabled={resolving !== null} onClick={() => { void pickAddress(a); }}>
                    <span className="co-row__ic co-row__ic--pin"><Icon id="i-pin" /></span>
                    <span className="co-row__txt">
                      <b dir="auto">{a.name}</b>
                      {placeSubtitle(a) ? <span dir="auto">{placeSubtitle(a)}</span> : null}
                    </span>
                    <Icon id="i-arrow" className="co-row__go" />
                  </button>
                ))}
                {searching ? <p className="co-meta" role="status">{t('Recherche de l’adresse…')}</p> : null}
                {!searching && searched && partnerHits.length === 0 && communityHits.length === 0 && addresses.length === 0 ? (
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
            {q.length < 2 || (searched && (partnerHits.length > 0 || communityHits.length > 0 || addresses.length > 0)) ? (
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
              onChange={(e) => { setTouched(true); setName(e.target.value); if (chosen) setChosen(null); }}
            />
            {chosen ? (
              <div className="co-known">
                <span className="co-known__chip">{t('TERRAIN DE LA COMMUNAUTÉ')}</span>
                {chosen.matchCount > 0 ? <span className="co-known__n">{tn('{n} matchs joués ici', chosen.matchCount)}</span> : null}
              </div>
            ) : !mapDown ? (
              <label className="co-share">
                <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                <span className="co-share__txt">
                  <b>{t('Ajouter ce terrain à Moubarat')}</b>
                  <span>{t('Les autres joueurs le trouveront dans la recherche, après une vérification par Moubarat.')}</span>
                </span>
              </label>
            ) : null}
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
            <button type="button" className="co-ask__no mb-tap" onClick={() => { setAskPartner(null); confirmHere({ checkNear: true }); }}>{t('Non, un autre terrain')}</button>
          </div>
        </div>
      ) : null}

      {askNear ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-labelledby="co-near-t" onClick={() => setAskNear(null)}>
          <div className="mb-sheet xp-cob co-ask co-near" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="co-ask__t" id="co-near-t">{t('C’est l’un de ces terrains ?')}</h3>
            <p className="co-near__sub">{t('Des joueurs ont déjà ajouté un terrain tout près de ton épingle.')}</p>
            {askNear.map((c) => (
              <button key={c.id} type="button" className="co-row co-row--near mb-tap" onClick={() => { setAskNear(null); p.onConfirm({ name: c.name, area: c.area, address: c.address, wilaya: c.wilaya, lat: c.lat, lng: c.lng, placeId: c.id }); }}>
                <span className="co-row__ic co-row__ic--community"><BallIcon /></span>
                <span className="co-row__txt">
                  <b><Ltr>{c.name}</Ltr></b>
                  <span>{[fillTemplate(t('à {n} m'), { n: String(c.m) }), c.matchCount > 0 ? tn('{n} matchs joués ici', c.matchCount) : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="co-near__yes">{t('C’est lui')}</span>
              </button>
            ))}
            <button type="button" className="co-ask__no mb-tap" onClick={() => { setAskNear(null); confirmHere({ checkNear: false }); }}>{t('Non, c’est un autre terrain')}</button>
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

/** Lot B, phase 6 : un terrain de la communauté dans la recherche (maquette « Nos lieux d'abord », 1). */
function CommunityRow({ c, onPick }: { c: CommunityPlace; onPick: () => void }) {
  const t = useT();
  const tn = useTn();
  // Comme une fiche d'entreprise (demande d'Aymen du 19/11/2026) : l'adresse sous le nom, sinon le quartier, sinon la wilaya.
  const where = c.address ?? c.area ?? c.wilaya;
  const meta = c.verified ? (c.matchCount > 0 ? tn('{n} matchs joués ici', c.matchCount) : '') : t('Ajouté par toi · à vérifier');
  return (
    <button type="button" className="co-row mb-tap" onClick={onPick}>
      <span className="co-row__ic co-row__ic--community" aria-hidden="true"><BallIcon /></span>
      <span className="co-row__txt">
        <b><Ltr>{c.name}</Ltr></b>
        <span><Ltr>{where}</Ltr>{meta ? <> · {meta}</> : null}</span>
      </span>
      {c.verified ? <svg className="co-row__ok" aria-label={t('Vérifié par Moubarat')} role="img" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg> : null}
    </button>
  );
}

/** Un stade de la communauté : un ballon de foot (la même icône que sur la carte, map/types.ts). */
function BallIcon() {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.6l3.7 2.7-1.4 4.3H9.7l-1.4-4.3z" /><path d="M12 3v4.6M20.6 9.4l-4.9.9M17.4 19.4l-3.1-4.8M6.6 19.4l3.1-4.8M3.4 9.4l4.9.9" /></svg>;
}
