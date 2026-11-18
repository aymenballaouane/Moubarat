import { useState } from 'react';
import { FORMAT_CAPACITY, type MatchFormat, type SkillLevel } from '@moubarat/core';
import { CreerTonMatch } from './CreerTonMatch.js';
import { CreerPublie } from './CreerMatch.js';
import { AlertsCard } from './AlertsCard.js';
import { OrganizerMatchView } from './OrganizerMatchView.js';
import { copyText } from '../lib/clipboard.js';
import { inviteHref, matchLink, matchLinkLabel } from '../lib/matchLink.js';
import { useLang } from '../lib/i18n.js';
import { firstOpenPeriod, freeMatchTitle, freeStarts, type FreePlaceInput } from '../lib/freeMatch.js';
import { reportRefusal } from '../lib/pasPossible.js';
import type { PeriodKey } from '../lib/reserverCreneau.js';
import { useToast } from '../lib/useToast.js';
import type { AppStore } from '../state/useAppStore.js';

/* Créer un match libre — le lieu vient de « Où tu joues ? » (BookingFlow, mode « match », CreerOu). Lot B, phase 1 (18/11/2026) : une seule
   page « Ton match » (CreerTonMatch) remplace les écrans Créneau et Détails ; puis l'écran « match en ligne » inchangé (S8 / S8P sans
   prix). Rien n'est réservé : « Publier » crée le match directement (POST /matches/free, règle core `createFreeMatch`) ; le bouton se
   désactive pendant l'envoi (un seul match même touché deux fois). « Modifier » et le retour rouvrent la carte sur le lieu choisi. */

type Screen = 'page' | 'publie' | 'mymatch';

function dayStartOf(index: number): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + index).getTime();
}

export function FreeMatchFlow({ store, place, onBackToPlace, onExit }: {
  store: AppStore;
  place: FreePlaceInput;
  /** Retour vers « Où tu joues ? » (« Modifier », ou le bouton retour). */
  onBackToPlace: () => void;
  onExit: () => void;
}) {
  const toast = useToast();
  const lang = useLang();
  const [now] = useState(() => Date.now());
  // Aujourd'hui s'il reste une heure possible, sinon demain.
  const [dayIndex, setDayIndex] = useState(() => (firstOpenPeriod(dayStartOf(0), now) !== null ? 0 : 1));
  const [duration, setDuration] = useState(90);
  const [period, setPeriod] = useState<PeriodKey>(() => firstOpenPeriod(dayStartOf(dayIndex), now) ?? 'soir');
  const [startMin, setStartMin] = useState<number | null>(null);
  const [screen, setScreen] = useState<Screen>('page');
  const [format, setFormat] = useState<MatchFormat>('5v5');
  const [level, setLevel] = useState<SkillLevel>('LOISIR');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'OPEN' | 'PRIVATE'>('OPEN');
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const created = createdId ? store.findMatch(createdId) : undefined;

  const dayStart = dayStartOf(dayIndex);
  const starts = freeStarts(dayStart, period, Date.now());

  function pickDay(i: number) {
    setDayIndex(i);
    setStartMin(null);
    const open = firstOpenPeriod(dayStartOf(i), Date.now());
    if (open !== null && freeStarts(dayStartOf(i), period, Date.now()).length === 0) setPeriod(open);
  }

  async function publish(chosen: 'OPEN' | 'PRIVATE') {
    if (publishing || startMin === null) return;   // un seul envoi à la fois
    setVisibility(chosen);
    setPublishing(true);
    const res = await store.publishFreeMatch({
      place, format, level, start: dayStart + startMin * 60_000, durationMin: duration,
      title: freeMatchTitle(place.name, format), note: note.trim() || undefined, visibility: chosen,
    });
    setPublishing(false);
    if (!res.ok) {
      if (res.code === 'MATCH_LOCKED' || res.code === 'SLOT_IN_PAST') setStartMin(null);
      if (reportRefusal(res)) return;   // chevauchement, restriction, accord retiré : la fenêtre « Pas possible »
      toast.show(res.message);
      return;
    }
    setCreatedId(res.matchId!);
    setScreen('publie');
  }

  const toastEl = <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>;

  if (screen === 'page') {
    return (
      <CreerTonMatch
        placeName={place.name} placeSub={[place.address ?? place.area ?? '', place.wilaya].map((x) => x.trim()).filter(Boolean).join(', ')}
        onEditPlace={onBackToPlace} onBack={onBackToPlace}
        dayIndex={dayIndex} onDay={pickDay} duration={duration} onDuration={setDuration}
        period={period} onPeriod={(k) => { setPeriod(k); setStartMin(null); }}
        starts={starts} startMin={startMin} onStart={setStartMin}
        format={format} onFormat={setFormat} level={level} onLevel={setLevel} note={note} onNote={setNote}
        publishing={publishing} onPublish={(v) => { void publish(v); }} toast={toastEl}
      />
    );
  }

  if (!created) return null;
  if (screen === 'publie') {
    const m = created.match;
    const code = created.code;
    return (
      <CreerPublie
        summary={{ sport: m.sport, format: m.format, startEpoch: m.range.start, endEpoch: m.range.end, venueName: place.name, fieldName: '', perPlayerDa: 0, places: FORMAT_CAPACITY[m.format] }}
        level={level} visibility={visibility} shareHref={code ? inviteHref({ code, format: m.format, start: m.range.start, placeName: place.name, wilaya: place.wilaya, pricePerPlayerDa: 0, missing: m.capacity - 1 }, lang) : '#'}
        linkLabel={code ? matchLinkLabel(code) : null} copied={copied}
        onCopy={() => { if (code) void copyText(matchLink(code)).then((ok) => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2500); } }); }}
        onSeeMatch={() => setScreen('mymatch')} onBack={onExit} toast={toastEl}
        alerts={<AlertsCard store={store} variant="organizer" />}
      />
    );
  }
  return <OrganizerMatchView match={created.match} players={created.players} onExit={onExit} store={store} />;
}
