import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canCenterAct, CLOSURE_REASON_LABELS, type CenterRole, type ClosureReason, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import type { TimelineBlock } from '../data/planningDemo.js';
import {
  dayLabel, shiftDate, todayAlgiers, dayStartMs, weekdayOf,
  timelineBlocksFromApi, subscriptionBlocksFromApi, type ApiBookingRow, type ApiSubscriptionOccurrence,
} from '../lib/bookingsDetail.js';
import { hoursFromApi, asFieldStatus, formatLabel, type ApiVenueDetail } from '../lib/venueDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { hhmm } from '../lib/time.js';
import { fmt } from '../lib/format.js';
import { Icon } from './Icon.js';

interface PlanningProps {
  role: CenterRole; venueId: string; token: string; onToast: (message: string) => void;
  /** Navigation depuis un autre écran (16/09/2026, signalé par Aymen — le
      clic sur une résa existante ici ne faisait RIEN jusqu'ici, un vrai
      bug). `nonce` force la resynchronisation même sur une redemande
      identique (la prop ne changerait sinon pas de référence). */
  openRequest?: { date: string; nonce: number } | null;
  onOpenReservation?: (bookingId: string, date: string) => void;
}

const FIELD_SPORT_LABEL: Record<string, 'Football' | 'Padel' | 'Basket'> = { FOOTBALL: 'Football', PADEL: 'Padel', BASKET: 'Basket' };
const SPORTS = ['ALL', 'Football', 'Padel', 'Basket'] as const;
const BOOKABLE_SPORTS = ['Football', 'Padel', 'Basket'] as const;

/* Lot 3 (15/09/2026, demande d'Aymen) : création de réservation par clic ou
   glisser dans une case libre du Planning — reprend du benchmark
   (prototypes/crm-valide.html, section Planning) le clic snappé à 30 min, le
   dessiner-pour-créer (fantôme durée+prix), « Prochaine dispo » qui
   préremplit, les cases Fermé non cliquables. Explicitement reporté (voir le
   message envoyé à Aymen avant de coder) : glisser-déposer pour DÉPLACER une
   résa existante, redimensionner, « Bloquer une plage » (mécanisme blockSlot,
   toujours prévu mais pour un lot séparé). Le devis en direct réutilise
   GET /fields/:id/availability (déjà réel) — jamais une règle de prix
   recodée ici. */
const SNAP_MIN = 30;
// CLOSURE_REASON_LABELS vient désormais de @moubarat/core (chantier arabe RTL, 18/10/2026,
// lot 1) — était défini deux fois indépendamment (ici ET dans Centre.tsx), unifié.

interface ClosureItem {
  id: string; fieldId: string | null; fieldName: string | null;
  startMs: number; endMs: number; reason: ClosureReason; label: string | null;
}

interface AvailabilityBand { fromMin: number; toMin: number; rateDaPerHour: number; amountDa: number }
/* 16/09/2026 (demande d'Aymen) : un devis PAR FORMAT du terrain pour un même départ —
   le prix (base ET bandes) dépend du format. Terrain à un seul format : une seule entrée. */
interface AvailabilityFormatQuote { format: string; totalDa: number; bands: AvailabilityBand[] }
interface AvailabilityStart { startMin: number; label: string; start: number; end: number; byFormat: AvailabilityFormatQuote[] }

function nowMinClamped(openStart: number, openEnd: number): number | null {
  const d = new Date();
  const min = d.getHours() * 60 + d.getMinutes();
  if (min < openStart || min > openEnd) return null;
  return min;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

interface DayField { id: string; name: string; sport: string; active: boolean }

/* Chantier CRM — Planning + Réservations (05/09/2026) : lecture réelle via
   GET /venues/:venueId (terrains + horaires du jour) et
   GET /venues/:venueId/bookings (créneaux du jour) — plus jamais
   PLANNING_DEMO. Les fermetures exceptionnelles restent toujours vides :
   aucune route ne lit la table `closures` du schéma gelé (docs/PASSATION.md
   §5.6) — jamais inventées ici. Chargement indépendant de Réservations
   (décision d'Aymen : pas de cache partagé entre les deux écrans).

   Correctif (06/09/2026, relecture Aymen) : `?includeArchived=1` — un
   terrain archivé DEPUIS reste sur la grille pour un jour PASSÉ où il avait
   réellement une réservation (l'historique ne doit rien perdre en
   archivant un terrain), mais n'apparaît jamais comme une ligne vide sur un
   jour sans activité pour lui (aujourd'hui, par exemple) : sa ligne n'existe
   que si `blocks` en contient au moins un pour ce jour précis. Les boutons
   de filtre par terrain, eux, ne listent que les terrains ACTIFS — inutile
   de proposer de basculer un terrain qui n'existe plus. */
export function Planning({ role, venueId, token, onToast, openRequest, onOpenReservation }: PlanningProps) {
  const canCreate = canCenterAct(role, 'CREATE_BOOKING').ok;

  const [zoom, setZoom] = useState<'x' | 'c'>('x');
  const [sport, setSport] = useState<(typeof SPORTS)[number]>('ALL');
  const [date, setDate] = useState(todayAlgiers());
  const [fieldFilter, setFieldFilter] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState<DayField[]>([]);
  const [openRange, setOpenRange] = useState<[number, number] | null>(null);
  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);
  const [closures, setClosures] = useState<ClosureItem[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  // Navigation depuis Réservations (« Ouvrir dans le planning ») — se cale
  // sur la date demandée. `nonce` en dépendance : `openRequest?.date` seul
  // ne redéclencherait pas l'effet pour une redemande de la MÊME date.
  useEffect(() => {
    if (openRequest) setDate(openRequest.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  const fetchDay = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const [venueRes, bookingsRes, closuresRes] = await Promise.all([
        apiFetch<{ venue: ApiVenueDetail }>(`/venues/${venueId}?includeArchived=1`, { token }),
        apiFetch<{ bookings: ApiBookingRow[]; subscriptions: ApiSubscriptionOccurrence[] }>(`/venues/${venueId}/bookings?date=${date}`, { token }),
        apiFetch<{ closures: ClosureItem[] }>(`/venues/${venueId}/closures`, { token }),
      ]);
      const allFields = venueRes.venue.fields
        .map((f) => ({ id: f.id, name: f.name, sport: f.sport, active: asFieldStatus(f.status) === 'ACTIVE' }));
      setFields(allFields);
      setFieldFilter((prev) => {
        const next: Record<string, boolean> = {};
        for (const f of allFields.filter((f) => f.active)) next[f.name] = prev[f.name] ?? true;
        return next;
      });
      const hours = hoursFromApi(venueRes.venue.openingHours)[weekdayOf(date)] ?? null;
      setOpenRange(hours);
      const dayStart = dayStartMs(date);
      setBlocks([
        ...timelineBlocksFromApi(bookingsRes.bookings, dayStart),
        ...subscriptionBlocksFromApi(bookingsRes.subscriptions, dayStart),
      ]);
      // Une fermeture couvre toute la journée d'exploitation (queue après
      // minuit comprise) — ne garder que celles qui recoupent VRAIMENT la
      // fenêtre affichée [0, 2880) de ce jour, jamais tout ce que renvoie
      // l'API pour le centre (passées, futures, autres jours).
      setClosures(closuresRes.closures.filter((c) => {
        const s = Math.round((c.startMs - dayStart) / 60_000);
        const e = Math.round((c.endMs - dayStart) / 60_000);
        return e > 0 && s < 2880;
      }));
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token, date]);

  useEffect(() => { void fetchDay(); }, [fetchDay]);

  const [openStartMin, openEndMin] = openRange ?? [480, 1440];
  const total = openEndMin - openStartMin;
  const pct = (min: number) => ((min - openStartMin) / total) * 100;

  // Les blocs eux-mêmes portent le nom du TERRAIN (fieldName, pas son id) —
  // le filtre par terrain et par sport travaille donc sur ce même nom, comme
  // en démo, jamais un index de position dans la liste.
  const fieldByName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
  const namesWithBlocksToday = useMemo(() => new Set(blocks.map((b) => b.field)), [blocks]);
  const visibleFieldNames = fields
    .filter((f) => f.active || namesWithBlocksToday.has(f.name))
    .map((f) => f.name)
    .filter((name) => {
      const f = fieldByName.get(name)!;
      if (sport !== 'ALL' && FIELD_SPORT_LABEL[f.sport] !== sport) return false;
      // Le bouton de filtre n'existe que pour les terrains actifs (voir plus
      // bas) : un terrain archivé n'a pas d'entrée dans `fieldFilter`, donc
      // `!== false` le laisserait toujours visible — correct, il n'est déjà
      // affiché que parce qu'il a une activité réelle ce jour-là.
      return fieldFilter[name] !== false;
    });

  const hourTicks = useMemo(() => {
    const out: number[] = [];
    for (let m = openStartMin; m <= openEndMin; m += 60) out.push(m);
    return out;
  }, [openStartMin, openEndMin]);

  const nowMin = date === todayAlgiers() ? nowMinClamped(openStartMin, openEndMin) : null;

  // Auto-scroll vers "maintenant" (ou +4h si hors horaires) au chargement et
  // au retour en vue Étendue — fidèle au prototype (_go/_target,
  // renderDayTimeline). Sans ça, la vue s'ouvre à 08:00 et il faut tirer la
  // barre de défilement à la main pour voir l'heure actuelle.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (zoom === 'c' || load.kind !== 'ready') return;
    const targetMin = nowMin ?? openStartMin + 240;
    const contentWidth = 1560; // doit rester synchro avec le min-width de .tl-head/.tl-row (crm.css)
    const target = Math.max(0, ((targetMin - openStartMin) / total) * contentWidth - 460);
    let tries = 4;
    let raf1 = 0, raf2 = 0, timeout = 0;
    const go = () => {
      const el = scrollRef.current;
      if (el && el.clientWidth > 0) el.scrollLeft = target;
      if ((!el || el.scrollLeft < 10) && tries > 0) { tries -= 1; timeout = window.setTimeout(go, 60); }
    };
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(go); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(timeout); };
  }, [zoom, nowMin, openStartMin, total, load.kind]);

  // Fermetures exceptionnelles (Lot 2, déjà réelles) regroupées PAR TERRAIN,
  // en minutes de LA journée affichée — même clip que les blocs de résa
  // (timelineBlocksFromApi), jamais une deuxième convention de temps.
  const closuresByField = useMemo(() => {
    const dayStart = dayStartMs(date);
    const map = new Map<string, { startMin: number; endMin: number; label: string }[]>();
    for (const c of closures) {
      const startMin = Math.round((c.startMs - dayStart) / 60_000);
      const endMin = Math.round((c.endMs - dayStart) / 60_000);
      const label = `${CLOSURE_REASON_LABELS[c.reason]}${c.label ? ` — ${c.label}` : ''}`;
      const targetNames = c.fieldId
        ? (c.fieldName ? [c.fieldName] : [])
        : fields.map((f) => f.name);
      for (const name of targetNames) {
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push({ startMin, endMin, label });
      }
    }
    return map;
  }, [closures, fields, date]);

  function closedAtMin(fieldName: string, min: number): { closed: boolean; label?: string } {
    const hit = (closuresByField.get(fieldName) ?? []).find((r) => min >= r.startMin && min < r.endMin);
    return hit ? { closed: true, label: hit.label } : { closed: false };
  }

  /* Création par clic ou glisser dans une case libre (Lot 3). `sel` ne porte
     jamais l'état d'un bloc existant : cliquer une résa déjà là redirige
     vers Réservations — câblé pour de vrai le 16/09/2026 (signalé par
     Aymen : jusque-là un TimelineBlockView sans onClick, ce commentaire
     décrivait un comportement qui n'existait pas encore). Glisser-déposer
     pour DÉPLACER une résa existante reste hors périmètre — Modifier
     (formulaire, écran Réservations) est le seul chemin. */
  const [sel, setSel] = useState<{ field: string; startMin: number } | null>(null);
  const [formName, setFormName] = useState('');
  const [formTel, setFormTel] = useState('');
  const [formDur, setFormDur] = useState(60);
  const [formSource, setFormSource] = useState<'WALK_IN' | 'PHONE'>('WALK_IN');
  /* Format d'une résa créée au comptoir/téléphone : OBLIGATOIRE dès que le terrain
     en propose plusieurs (comme dans l'app joueur), choisi explicitement avec le
     prix de chacun affiché — jamais présélectionné. Terrain à un seul format :
     aucun sélecteur, le serveur le déduit. */
  const [formFormat, setFormFormat] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [quote, setQuote] = useState<AvailabilityStart | 'unavailable' | 'loading' | null>(null);

  function openCreatePanel(fieldName: string, startMin: number, durationMin: number) {
    setSel({ field: fieldName, startMin });
    setFormName(''); setFormTel(''); setFormDur(durationMin); setFormSource('WALK_IN');
    setFormFormat(null);
    setFormError('');
  }

  /* Devis en direct (exigence n°2 d'Aymen) : jamais une règle de prix
     recodée ici — on relit GET /fields/:id/availability (déjà réel, déjà
     testé), et on cherche le départ exact demandé dans sa réponse. Absent
     de la liste = indisponible (conflit, fermeture, hors horaires — le
     serveur tranchera avec le bon message si on force quand même l'envoi).
     includeInProgress=1 : un client au téléphone MAINTENANT reste un
     départ valable pour le staff (voir bookings/service.ts, forceVerified). */
  useEffect(() => {
    if (!sel) { setQuote(null); return; }
    const f = fieldByName.get(sel.field);
    if (!f) return;
    let cancelled = false;
    setQuote('loading');
    apiFetch<{ starts: AvailabilityStart[] }>(
      `/fields/${f.id}/availability?date=${date}&duration=${formDur}&step=${SNAP_MIN}&includeInProgress=1`, { token },
    ).then((res) => {
      if (cancelled) return;
      setQuote(res.starts.find((s) => s.startMin === sel.startMin) ?? 'unavailable');
    }).catch(() => { if (!cancelled) setQuote('unavailable'); });
    return () => { cancelled = true; };
  }, [sel, formDur, date, token, fieldByName]);

  /* Terrain à plusieurs formats : le devis à afficher est celui du format choisi (rien
     tant qu'il n'est pas choisi) ; un seul format : le sien, déduit. */
  const quoteFormats = quote !== null && typeof quote === 'object' ? quote.byFormat : [];
  const multiFormat = quoteFormats.length > 1;
  const activeQuote = quoteFormats.length === 1 ? quoteFormats[0]! : (quoteFormats.find((q) => q.format === formFormat) ?? null);

  async function submitCreate() {
    if (!sel) return;
    const f = fieldByName.get(sel.field);
    if (!f) return;
    setFormError('');
    if (formName.trim().length < 2) { setFormError('Indique un nom pour la réservation.'); return; }
    if (multiFormat && !activeQuote) { setFormError('Choisis le format de la réservation.'); return; }
    setFormSubmitting(true);
    try {
      const created = await apiFetch<{ booking: { id: string; claimStatus?: 'PENDING' | null } }>('/bookings', {
        method: 'POST', token,
        body: {
          fieldId: f.id, date, startMin: sel.startMin, durationMin: formDur,
          source: formSource, reservationName: formName.trim(),
          ...(activeQuote ? { format: activeQuote.format } : {}),
          ...(formTel.trim() ? { customerPhone: formTel.trim() } : {}),
        },
      });
      /* Règle 21 : le numéro saisi est celui d'un compte joueur — il vient de recevoir « C'est bien toi ? ». */
      onToast(created.booking.claimStatus === 'PENDING' ? 'Réservation créée. Ce numéro est celui d’un joueur Moubarat : il est prévenu et doit confirmer.' : 'Réservation créée.');
      setSel(null);
      void fetchDay();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setFormSubmitting(false);
    }
  }

  /* Glisser pour créer : le clic simple (aucun mouvement) est laissé au
     gestionnaire onClick de la case — dragMovedRef distingue les deux,
     comme dans le prototype (dragMoved), pour ne jamais déclencher les
     deux à la fois sur un même geste. */
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  function minuteAtClientX(fieldName: string, clientX: number): number {
    const el = laneRefs.current[fieldName];
    if (!el) return openStartMin;
    const r = el.getBoundingClientRect();
    const raw = openStartMin + ((clientX - r.left) / r.width) * total;
    return Math.max(openStartMin, Math.min(Math.round(raw / SNAP_MIN) * SNAP_MIN, openEndMin));
  }

  const [dragField, setDragField] = useState<string | null>(null);
  const dragM0 = useRef(0);
  const dragMovedRef = useRef(false);
  // dragA/dragDur : LA valeur qui compte pour onUp est celle des refs,
  // toujours à jour ; le state jumeau ne sert qu'à faire re-peindre le
  // fantôme. onUp est défini dans la MÊME fermeture d'effet que onMove
  // (l'effet ne se relance qu'au changement de dragField, jamais à chaque
  // pointermove) — lire le STATE depuis onUp y lirait la valeur du moment où
  // l'effet a démarré, jamais les mises à jour suivantes (fermeture figée,
  // bug trouvé en vérification navigateur : le glisser retombait toujours
  // sur 30 min par défaut, quelle que soit la distance parcourue).
  const dragARef = useRef(0);
  const dragDurRef = useRef(SNAP_MIN);
  const [dragA, setDragA] = useState(0);
  const [dragDur, setDragDur] = useState(SNAP_MIN);
  const [dragQuoteDa, setDragQuoteDa] = useState<number | 'bad' | null>(null);
  const [dragQuoteFrom, setDragQuoteFrom] = useState(false);

  useEffect(() => {
    if (!dragField) return;
    const fieldName = dragField;
    function onMove(e: PointerEvent) {
      const m = minuteAtClientX(fieldName, e.clientX);
      if (m !== dragM0.current) dragMovedRef.current = true;
      const a = Math.min(dragM0.current, m), z = Math.max(dragM0.current, m);
      const dur = Math.max(SNAP_MIN, z - a);
      dragARef.current = a; dragDurRef.current = dur;
      setDragA(a); setDragDur(dur);
    }
    function onUp() {
      setDragField(null);
      if (!dragMovedRef.current) return; // clic simple : onClick s'en charge
      const info = closedAtMin(fieldName, dragARef.current);
      if (info.closed) { onToast(`Ce créneau est fermé${info.label ? ` (${info.label})` : ''}.`); return; }
      openCreatePanel(fieldName, dragARef.current, dragDurRef.current);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragField]);

  useEffect(() => {
    if (!dragField) { setDragQuoteDa(null); return; }
    const f = fieldByName.get(dragField);
    if (!f) return;
    if (closedAtMin(dragField, dragA).closed) { setDragQuoteDa('bad'); return; }
    let cancelled = false;
    apiFetch<{ starts: AvailabilityStart[] }>(
      `/fields/${f.id}/availability?date=${date}&duration=${dragDur}&step=${SNAP_MIN}&includeInProgress=1`, { token },
    ).then((res) => {
      if (cancelled) return;
      const hit = res.starts.find((s) => s.startMin === dragA);
      // Plusieurs formats : « dès X » = le prix le plus bas, un fait, pas une recommandation.
      setDragQuoteFrom((hit?.byFormat.length ?? 0) > 1);
      setDragQuoteDa(hit ? Math.min(...hit.byFormat.map((q) => q.totalDa)) : 'bad');
    }).catch(() => { if (!cancelled) setDragQuoteDa('bad'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragField, dragA, dragDur, date, token]);

  /* « Prochaine dispo » (exigence n°1) : cherche sur plusieurs jours et
     terrains via la nouvelle route serveur (jamais un moteur recodé ici). */
  const [naSport, setNaSport] = useState<(typeof BOOKABLE_SPORTS)[number]>('Football');
  const [naDur, setNaDur] = useState(90);
  const [naSearching, setNaSearching] = useState(false);
  const [naResult, setNaResult] = useState<
    null | { found: false } | { found: true; date: string; fieldName: string; startMin: number; label: string; format?: string; totalDa?: number }
  >(null);

  async function searchNextAvailability() {
    setNaSearching(true); setNaResult(null);
    const sportCode = (Object.entries(FIELD_SPORT_LABEL).find(([, label]) => label === naSport)?.[0]) ?? 'FOOTBALL';
    try {
      const res = await apiFetch<{ found: boolean; date?: string; fieldName?: string; startMin?: number; label?: string; format?: string; totalDa?: number }>(
        `/venues/${venueId}/next-availability?sport=${sportCode}&duration=${naDur}`, { token },
      );
      setNaResult(res.found
        ? {
          found: true, date: res.date!, fieldName: res.fieldName!, startMin: res.startMin!, label: res.label!,
          ...(res.format !== undefined ? { format: res.format } : {}), ...(res.totalDa !== undefined ? { totalDa: res.totalDa } : {}),
        }
        : { found: false });
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setNaSearching(false);
    }
  }

  function bookNextAvailability(hit: { date: string; fieldName: string; startMin: number }) {
    setDate(hit.date);
    openCreatePanel(hit.fieldName, hit.startMin, naDur);
  }

  return (
    <section className="cm-view on">
      <div className="pl-bar">
        <div className="grp">
          <button type="button" className="on">Jour</button>
          <button type="button" disabled title="Vue semaine — a venir">Semaine</button>
        </div>
        <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setDate(todayAlgiers())}>Aujourd'hui</button>
        <button type="button" className="nav mb-btn mb-btn--ghost mb-btn--sm" style={{ minWidth: 34 }} aria-label="Jour precedent" onClick={() => setDate((d) => shiftDate(d, -1))}>‹</button>
        <b style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--fs-d4)', color: 'var(--text)',
          textTransform: 'uppercase', minWidth: 150, textAlign: 'center',
        }}>{dayLabel(date)}</b>
        <button type="button" className="nav mb-btn mb-btn--ghost mb-btn--sm" style={{ minWidth: 34 }} aria-label="Jour suivant" onClick={() => setDate((d) => shiftDate(d, 1))}>›</button>
        {/* CRM-2 (27/09/2026) : « Aller à une date » — présent dans le prototype gelé (crm-valide.html, #pl-date),
            jamais câblé jusqu'ici ; une valeur vide (champ effacé) est ignorée, comme dans le prototype. */}
        <input
          type="date" className="mb-field__control" aria-label="Aller à une date" title="Aller à une date"
          value={date} style={{ maxWidth: 150, margin: 0 }}
          onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
        />
        <span className="hrs" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gold)', textTransform: 'uppercase' }}>
          {openRange ? `Ouvert ${hhmm(openStartMin)} → ${hhmm(openEndMin)}` : 'Fermé ce jour-là'}
        </span>
        <span style={{ flex: 1 }} />
        <div className="grp">
          {fields.filter((f) => f.active).map((f) => (
            <button
              key={f.id}
              type="button"
              className={fieldFilter[f.name] !== false ? 'on' : ''}
              onClick={() => setFieldFilter((s) => ({ ...s, [f.name]: s[f.name] === false }))}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="grp">
          {SPORTS.map((s) => (
            <button key={s} type="button" className={sport === s ? 'on' : ''} onClick={() => setSport(s)}>
              {s === 'ALL' ? 'Tous' : s}
            </button>
          ))}
        </div>
        <div className="grp">
          <button type="button" className={zoom === 'x' ? 'on' : ''} onClick={() => setZoom('x')}>Étendu</button>
          <button type="button" className={zoom === 'c' ? 'on' : ''} onClick={() => setZoom('c')}>Compact</button>
        </div>
      </div>

      {canCreate ? (
        <div className="pl-next">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
            Prochaine dispo
          </span>
          <select className="mb-field__control" style={{ maxWidth: 120 }} value={naSport} onChange={(e) => setNaSport(e.target.value as typeof naSport)}>
            {BOOKABLE_SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="mb-field__control" style={{ maxWidth: 100 }} value={naDur} onChange={(e) => setNaDur(Number(e.target.value))}>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
            <option value={120}>120 min</option>
          </select>
          <button type="button" className="mb-btn mb-btn--sm" disabled={naSearching} onClick={() => { void searchNextAvailability(); }}>
            {naSearching ? 'Recherche…' : 'Chercher'}
          </button>
          {naResult ? (
            <span className="res">
              {naResult.found ? (
                <>
                  Prochain créneau : <b>{naResult.label}</b> — {naResult.fieldName} — {dayLabel(naResult.date)}
                  {naResult.format !== undefined && naResult.totalDa !== undefined ? ` — dès ${fmt(naResult.totalDa)} DA en ${naResult.format}` : ''}
                  <button
                    type="button" className="mb-btn mb-btn--sm" style={{ marginLeft: 8 }}
                    onClick={() => bookNextAvailability(naResult)}
                  >
                    Réserver
                  </button>
                </>
              ) : 'Rien sous 8 jours pour ces critères.'}
            </span>
          ) : null}
        </div>
      ) : null}

      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchDay(); }}>Réessayer</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement du planning…</p></div>
      ) : !openRange ? (
        <p className="cm-note">Le centre est fermé ce jour-là.</p>
      ) : (
        <>
          <div ref={scrollRef} className={`tl-wrap${zoom === 'c' ? ' compact' : ''}`}>
            <div className="tl-head">
              <div className="tl-fname" style={{ border: 0 }} />
              <div className="tl-hours">
                {hourTicks.map((m) => (
                  <i key={m} style={{ left: `${pct(m)}%` }}>{hhmm(m).slice(0, 2)}h</i>
                ))}
              </div>
            </div>
            {visibleFieldNames.map((name) => {
              const fieldBlocks = blocks.filter((b) => b.field === name);
              return (
                <div className="tl-row" key={name}>
                  <div className="tl-fname">{name}</div>
                  <div
                    ref={(el) => { laneRefs.current[name] = el; }}
                    className="tl-lane"
                    style={{
                      backgroundImage:
                        'linear-gradient(90deg,var(--line-strong) 1px,transparent 1px),' +
                        'linear-gradient(90deg,var(--line) 1px,transparent 1px)',
                      backgroundSize: `${(60 / total) * 100}% 100%,${(30 / total) * 100}% 100%`,
                      cursor: canCreate ? 'crosshair' : undefined,
                    }}
                    onPointerDown={(e) => {
                      if (!canCreate || e.target !== e.currentTarget) return;
                      const m = minuteAtClientX(name, e.clientX);
                      dragM0.current = m; dragMovedRef.current = false;
                      dragARef.current = m; dragDurRef.current = SNAP_MIN;
                      setDragA(m); setDragDur(SNAP_MIN);
                      setDragField(name);
                    }}
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (dragMovedRef.current) { dragMovedRef.current = false; return; }
                      const m = minuteAtClientX(name, e.clientX);
                      const info = closedAtMin(name, m);
                      if (info.closed) { onToast(`Ce créneau est fermé${info.label ? ` (${info.label})` : ''}.`); return; }
                      if (!canCreate) { onToast(`${name} · ${hhmm(m)} — libre. En ${role === 'STAFF' ? 'Staff' : role}, tu peux consulter et pointer les présences, pas créer.`); return; }
                      openCreatePanel(name, m, 60);
                    }}
                  >
                    {(closuresByField.get(name) ?? []).map((c, i) => {
                      const s = Math.max(c.startMin, openStartMin);
                      const e = Math.min(c.endMin, openEndMin);
                      if (e <= s) return null;
                      return (
                        <div key={`closure-${i}`} className="tl-block k-closed" style={{ left: `${pct(s)}%`, width: `${((e - s) / total) * 100}%` }} title={c.label}>
                          <b>Fermé</b><span>{c.label}</span>
                        </div>
                      );
                    })}
                    {fieldBlocks.map((b) => (
                      <TimelineBlockView
                        key={b.id} block={b} pct={pct} total={total}
                        {...(onOpenReservation ? { onOpen: (id: string) => onOpenReservation(id, date) } : {})}
                      />
                    ))}
                    {dragField === name ? (
                      <div className={`tl-ghost${dragQuoteDa === 'bad' ? ' bad' : ''}`} style={{ left: `${pct(dragA)}%`, width: `${(dragDur / total) * 100}%` }}>
                        {dragQuoteDa === 'bad' ? 'Indisponible'
                          : dragQuoteDa === null ? `${hhmm(dragA)} → ${hhmm(dragA + dragDur)}`
                            : `${hhmm(dragA)} → ${hhmm(dragA + dragDur)} · ${dragQuoteFrom ? 'dès ' : ''}${fmt(dragQuoteDa)} DA`}
                      </div>
                    ) : null}
                    {nowMin !== null ? <div className="tl-now" style={{ left: `${pct(nowMin)}%` }} /> : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tl-legend">
            <i><span className="tl-block k-resa sw" />Réservé</i>
            <i><span className="tl-block k-match sw" />Match</i>
            <i><span className="tl-block k-phone sw" />Tél. à vérifier</i>
            <i><span className="tl-block k-abo sw" />Abonnement</i>
            <i><span className="tl-block k-closed sw" />Fermé</i>
            <i>✓ Honoré / Payé</i>
            <i>✕ No-show</i>
            <i>Ligne rouge · maintenant</i>
          </div>
        </>
      )}

      <div className="cm-panel">
        {sel ? (
          <>
            <div className="row">
              <span className="d"><b>{sel.field} · {hhmm(sel.startMin)}</b> · libre — {dayLabel(date)}</span>
            </div>
            <div className="cm-sub">
              <label>
                <span>Au nom de qui ?</span>
                <input className="mb-field__control" style={{ minWidth: 150 }} maxLength={40} value={formName} onChange={(e) => { setFormName(e.target.value); setFormError(''); }} />
              </label>
              <label>
                <span>Téléphone</span>
                <input className="mb-field__control" style={{ minWidth: 130 }} placeholder="05 50 00 00 00" maxLength={20} value={formTel} onChange={(e) => setFormTel(e.target.value)} />
              </label>
              <label>
                <span>Durée</span>
                <select className="mb-field__control" style={{ minWidth: 96 }} value={formDur} onChange={(e) => setFormDur(Number(e.target.value))}>
                  {[30, 60, 90, 120, 150, 180, 240, 300, 360].map((d) => <option key={d} value={d}>{d} min</option>)}
                </select>
              </label>
              <label>
                <span>Canal</span>
                <select className="mb-field__control" value={formSource} onChange={(e) => setFormSource(e.target.value as 'WALK_IN' | 'PHONE')}>
                  <option value="WALK_IN">Comptoir</option>
                  <option value="PHONE">Téléphone</option>
                </select>
              </label>
              {multiFormat ? (
                <div className="pl-fmts" role="group" aria-label="Format de la réservation">
                  <span className="pl-fmts__label">Format</span>
                  {quoteFormats.map((q) => (
                    <button
                      key={q.format} type="button" className="pl-fmt" aria-pressed={formFormat === q.format}
                      onClick={() => { setFormFormat(q.format); setFormError(''); }}
                    >
                      <b>{formatLabel(q.format)}</b><span>{fmt(q.totalDa)} DA</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="cm-quote">
                {quote === 'loading' || quote === null ? 'Calcul du devis…'
                  : quote === 'unavailable' ? 'Indisponible sur ce créneau (conflit, fermeture ou hors horaires).'
                    : !activeQuote ? 'Le prix dépend du format — choisis-en un.'
                      : (
                        <>
                          Tarif calculé{multiFormat ? ` (${formatLabel(activeQuote.format)})` : ''} : <b>{fmt(activeQuote.totalDa)} DA</b><br />
                          {activeQuote.bands.map((b, i) => (
                            <span key={i}>{hhmm(b.fromMin)}→{hhmm(b.toMin)} · {fmt(Math.round(b.amountDa))} DA{i < activeQuote.bands.length - 1 ? <br /> : null}</span>
                          ))}
                        </>
                      )}
              </span>
              <button
                type="button" className="mb-btn mb-btn--sm"
                disabled={formSubmitting || quote === 'unavailable' || quote === null || quote === 'loading' || !activeQuote}
                onClick={() => { void submitCreate(); }}
              >
                {formSubmitting ? 'Création…' : 'Créer la réservation'}
              </button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setSel(null)}>Annuler</button>
            </div>
            {formError ? <p className="mb-field__error"><Icon id="i-x" className="mb-ic--sm" />{formError}</p> : null}
          </>
        ) : (
          <div className="row">
            <span className="d">Clique une case libre pour créer une réservation, ou une réservation dans Réservations pour sa fiche complète. Déplacer/redimensionner arrivent dans une étape séparée.</span>
          </div>
        )}
      </div>
    </section>
  );
}

/* Clic sur une résa existante → sa fiche dans Réservations (16/09/2026,
   signalé par Aymen — ne faisait RIEN avant ce correctif, malgré un
   commentaire plus haut qui affirmait le contraire). Jamais pour un
   abonnement (`abo`, pas de fiche résa réelle côté Réservations) ni un
   futur blocage (`block`, mécanisme blockSlot pas encore construit). */
function TimelineBlockView({ block: b, pct, total, onOpen }: {
  block: TimelineBlock; pct: (m: number) => number; total: number; onOpen?: (id: string) => void;
}) {
  const wPct = (b.durationMin / total) * 100;
  const narrow = wPct < 7.5;
  const openable = onOpen !== undefined && (b.kind === 'resa' || b.kind === 'match' || b.kind === 'phone');
  return (
    <div
      className={`tl-block k-${b.kind}${b.status ? ` st-${b.status}` : ''}${narrow ? ' tl-block--s' : ''}`}
      title={`${b.title} · ${hhmm(b.startMin)}→${hhmm(b.startMin + b.durationMin)}`}
      style={{ left: `${pct(b.startMin)}%`, width: `${wPct}%`, cursor: openable ? 'pointer' : undefined }}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? (e) => { e.stopPropagation(); onOpen!(b.id); } : undefined}
      onKeyDown={openable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onOpen!(b.id); } : undefined}
    >
      <b>{b.title}{b.status === 'PAID' ? <em> ✓</em> : b.status === 'NO_SHOW' ? ' ✕' : ''}</b>
      <span>{b.subtitle}</span>
    </div>
  );
}
