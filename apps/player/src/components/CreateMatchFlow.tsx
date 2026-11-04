import { useEffect, useState } from 'react';
import { FORMAT_CAPACITY, matchShareText, whatsappShareUrl, type Booking, type MatchFormat, type SkillLevel, type Sport } from '@moubarat/core';
import { ClaimCard, useClaimAnswer } from './ClaimCard.js';
import { CreerConfig, CreerCreneau, CreerPublie, type MatchSummary, type ResaCardData } from './CreerMatch.js';
import { OrganizerMatchView } from './OrganizerMatchView.js';
import { epochDayTimeLabel } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { inviteHref, matchLink, matchLinkLabel } from '../lib/matchLink.js';
import { dayParts, durationText, eligibleReservations, formatBadge, slotStartEpoch, weekdayOfDate } from '../lib/createMatch.js';
import { perPlayerShown } from '../lib/price.js';
import { reportRefusal } from '../lib/pasPossible.js';
import { useToast } from '../lib/useToast.js';
import { fieldFormatList } from '../lib/venueView.js';
import type { BookingResume, MatchPrefill, PendingSlotPrefill } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';

/* Créer un match (Lot 6, Creer.dc.html) — trois étapes : Créneau → Détails → Publié. Remplace l'ancien parcours (fourche
   « as-tu déjà réservé ? », déclaration par téléphone, écran « Ton match », vérification) :
   - C0 « Ton créneau » : les réservations sans match du joueur (règle core `canCreateMatchOn`) + « Réserver un autre créneau »
     (Réserver en mode match : R1 → R2 → R3, puis directement ici). Aucune réservation à ouvrir : on part droit sur R1.
   - C1 « Configure ton match » : l'aperçu, le niveau, « Qui peut venir ? » (ouvert à tous / sur invitation — seulement par le lien, règle 6 ; retiré au lot 10 de
     l'audit tant qu'aucun lien n'ouvrait le match, rétabli avec les liens de match du lot 7), un mot aux joueurs (facultatif). PLUS DE NOM LIBRE (règle 41) :
     le match porte le nom de son centre.
   - C2 « Ton match est en ligne » : partage WhatsApp, ligne du lien à copier (app.moubarat.app/m/CODE), « Voir le match ».
   Un créneau choisi en R3 n'est PAS réservé avant « Publier le match » (BUG-3) : la réservation et le match partent ensemble ;
   le prix, la capacité et l'éligibilité viennent du core, jamais recalculés ici (seul l'arrondi d'affichage, règle 13). */

type Screen = 'creneau' | 'config' | 'publie' | 'mymatch';

interface CreateMatchFlowProps {
  store: AppStore;
  onExit: () => void;
  /** « Réserver un autre créneau » / aucune réservation à ouvrir : Réserver en mode match. */
  onBookAnother: () => void;
  /** « Changer de créneau » (ou créneau pris à la publication) : retour à R3, sélection reprise. */
  onChangeSlot: (resume: BookingResume) => void;
  prefill?: MatchPrefill | undefined;
}

interface ReservationSource { booking: Booking; format: MatchFormat | undefined; sport: Sport | undefined }

export function CreateMatchFlow({ store, onExit, onBookAnother, onChangeSlot, prefill }: CreateMatchFlowProps) {
  const toast = useToast();
  const [now] = useState(() => Date.now());

  const [source, setSource] = useState<ReservationSource | null>(() =>
    prefill?.booking ? { booking: prefill.booking, format: prefill.format, sport: prefill.sport } : null);
  const [pending, setPending] = useState<PendingSlotPrefill | null>(prefill?.pendingSlot ?? null);
  const [pendingSport] = useState<Sport | undefined>(prefill?.pendingSlot ? prefill.sport : undefined);
  const [screen, setScreen] = useState<Screen>(prefill ? 'config' : 'creneau');
  const [level, setLevel] = useState<SkillLevel>('LOISIR');
  const [visibility, setVisibility] = useState<'OPEN' | 'PRIVATE'>('OPEN');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [createdMatchId, setCreatedMatchId] = useState<string | null>(null);
  const createdEntry = createdMatchId ? store.findMatch(createdMatchId) : undefined;

  /* C0 : les réservations où un match peut s'ouvrir. */
  const cards = eligibleReservations(store.reservations, now);
  /* Règle 21 : « C'est bien toi ? » — les réservations saisies par un centre à ton numéro, en tête de « Ton créneau ». */
  const claimAnswer = useClaimAnswer(store, () => undefined);   // déjà dans « Créer un match » : « Créer un match sur ce créneau » referme la feuille, la réservation confirmée est la carte suivante
  useEffect(() => { void store.loadClaims(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* Rien à ouvrir en match : on part droit sur Réserver (mode match), comme « Réserver un autre créneau ». */
  useEffect(() => {
    if (screen === 'creneau' && cards.length === 0 && store.claims.length === 0) onBookAnother();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, cards.length, store.claims.length]);

  const cardData: ResaCardData[] = cards.map((r) => {
    const info = store.fieldInfo(r.booking.fieldId);
    const parts = dayParts(r.booking.range.start);
    const start = new Date(r.booking.range.start);
    const sport = (info?.field.sport ?? 'FOOTBALL') as Sport;
    const formats = fieldFormatList(info?.field.formats);
    return {
      id: r.booking.id, weekdayKey: parts.weekdayKey, date: parts.date,
      hour: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
      duration: durationText(Math.round((r.booking.range.end - r.booking.range.start) / 60_000)),
      venueName: info?.venueName ?? 'Centre', fieldName: info?.field.name ?? '—', sport,
      format: (r.format ?? (formats.length === 1 ? formats[0] : formats[0]) ?? '5v5') as MatchFormat,
      totalDa: r.booking.priceTotal.amount,
    };
  });

  /** C0 → C1 : le flux travaille sur le centre OUVERT (OrganizerMatchView, titres) — d'abord aligné sur le centre de CETTE
      réservation (même geste que Mes matchs › Créer un match). */
  async function pickReservation(id: string) {
    if (openingId !== null) return;
    const r = cards.find((x) => x.booking.id === id);
    if (!r) return;
    const info = store.fieldInfo(r.booking.fieldId);
    if (info && store.venue?.id !== info.venueId) {
      setOpeningId(id);
      const switched = await store.selectVenue(info.venueId);
      setOpeningId(null);
      if (!switched.ok) { toast.show(switched.message); return; }
    }
    setSource({ booking: r.booking, format: r.format, sport: info?.field.sport as Sport | undefined });
    setPending(null);
    setScreen('config');
  }

  /* --- Ce qui sera publié ------------------------------------------------------------------------------------- */
  const bookingFieldId = source?.booking.fieldId ?? pending?.fieldId ?? null;
  const info = bookingFieldId ? store.fieldInfo(bookingFieldId) : undefined;
  const venueName = info?.venueName ?? store.venue?.name ?? 'Centre';
  const fieldFormats = fieldFormatList(info?.field.formats);
  /* Format du match = celui de la réservation (jamais un choix libre de l'organisateur). Résa historique sans format sur un
     terrain mono-format : l'unique format du terrain (le serveur applique la même règle). Sinon inconnu : le match ne part pas. */
  const knownFormat: MatchFormat | null = pending
    ? pending.format
    : source ? (source.format ?? (fieldFormats.length === 1 ? (fieldFormats[0] as MatchFormat) : null)) : null;
  const shownFormat: MatchFormat = knownFormat ?? ((fieldFormats[0] as MatchFormat | undefined) ?? '5v5');
  const places = FORMAT_CAPACITY[shownFormat];
  const totalDa = source ? source.booking.priceTotal.amount : pending ? pending.total.amount : 0;
  const startEpoch = source ? source.booking.range.start : pending ? slotStartEpoch(pending.date, pending.startMin) : now;
  const endEpoch = source ? source.booking.range.end : pending ? startEpoch + pending.durationMin * 60_000 : now;
  const sport = (source?.sport ?? pendingSport ?? info?.field.sport ?? 'FOOTBALL') as Sport;
  const summary: MatchSummary = {
    sport, format: shownFormat, startEpoch, endEpoch, venueName,
    fieldName: info?.field.name ?? '—', perPlayerDa: perPlayerShown(totalDa, places), places,
  };
  const formatError = knownFormat === null && (source !== null || pending !== null)
    ? `Le format de cette réservation n’est pas connu et ce terrain en propose plusieurs — contacte le centre${store.venue?.phone ? ` (${store.venue.phone})` : ''} pour créer le match.`
    : null;

  /** Retour à R3 avec la sélection reprise (créneau pas encore réservé), ou à la liste C0 (réservation existante). */
  function changeSlot(taken: boolean) {
    if (pending) {
      onChangeSlot({
        sport, weekday: weekdayOfDate(pending.date), durationMin: pending.durationMin, format: pending.format,
        startMin: pending.startMin, taken, fieldName: info?.field.name ?? '',
      });
      return;
    }
    setSource(null);
    setScreen('creneau');
  }

  /** Publier : POST /bookings (créneau en attente) PUIS POST /matches — dans cet ordre, sur le serveur (le core exige une
      réservation réelle pour ouvrir un match). Créneau pris entre-temps : retour à R3 sur « Oups, il vient d'être pris »,
      rien n'a été réservé. Réservation posée mais match refusé : la réservation est réelle, elle reste ici (« Publier »
      réessaie SUR elle, jamais une deuxième) et visible dans Mes réservations. */
  async function publish() {
    if (publishing || knownFormat === null) return;
    if (!source && !pending) return;
    setPublishing(true);
    let bookingId = source?.booking.id ?? null;
    if (bookingId === null && pending) {
      const booked = await store.createBooking({
        fieldId: pending.fieldId, date: pending.date, startMin: pending.startMin, durationMin: pending.durationMin,
        format: pending.format, reservationName: pending.reservationName,
      });
      if (!booked.ok) {
        setPublishing(false);
        if (booked.code === 'SLOT_TAKEN' || booked.code === 'SLOT_IN_PAST') { changeSlot(booked.code === 'SLOT_TAKEN'); return; }
        if (reportRefusal(booked)) return;   // Lot 9 : une limite s'explique en fenêtre
        toast.show(booked.message);
        return;
      }
      setSource({ booking: booked.booking!, format: pending.format, sport });
      setPending(null);
      bookingId = booked.booking!.id;
    }
    const res = await store.publishMatch({
      bookingId: bookingId!, title: venueName, note: note.trim() || undefined, level, visibility,
    });
    setPublishing(false);
    if (!res.ok) { toast.show(res.message); return; }
    setCreatedMatchId(res.matchId!);
    setScreen('publie');
  }

  const toastEl = <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>;

  if (screen === 'creneau') {
    return (
      <>
        <CreerCreneau
          cards={cardData} onPick={(id) => { void pickReservation(id); }} onBookAnother={onBookAnother} onBack={onExit}
          claimSlot={store.claims.map((c) => <ClaimCard key={c.bookingId} claim={c} busy={claimAnswer.busy} onAnswer={(kind) => { void claimAnswer.answer(c, kind); }} />)}
        />
        {claimAnswer.sheet}
      </>
    );
  }

  if (screen === 'config') {
    return (
      <CreerConfig
        summary={summary} level={level} onLevel={setLevel} visibility={visibility} onVisibility={setVisibility} note={note} onNote={setNote}
        publishing={publishing} error={formatError}
        onChangeSlot={() => changeSlot(false)}
        onBack={() => { if (pending) changeSlot(false); else if (prefill?.booking) onExit(); else setScreen('creneau'); }}
        onPublish={() => { void publish(); }}
        toast={toastEl}
      />
    );
  }

  if (screen === 'publie') {
    if (!createdEntry) return null;
    const m = createdEntry.match;
    const code = createdEntry.code;
    const waText = matchShareText({
      title: `${venueName} ${formatBadge(m.format)}`, venueName,
      dayLabel: epochDayTimeLabel(m.range.start).split(' · ')[0] ?? '', timeLabel: epochDayTimeLabel(m.range.start).split(' · ')[1] ?? '',
      pricePerPlayerDa: m.pricePerPlayer.amount, spotsLeft: m.capacity - 1,
    });
    return (
      <CreerPublie
        summary={{ ...summary, format: m.format, perPlayerDa: m.pricePerPlayer.amount, places: m.capacity }}
        level={level} visibility={visibility} shareHref={code ? inviteHref(code) : whatsappShareUrl(waText)}
        linkLabel={code ? matchLinkLabel(code) : null} copied={copied}
        onCopy={() => { if (code) void copyText(matchLink(code)).then((ok) => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2500); } }); }}
        onSeeMatch={() => setScreen('mymatch')} onBack={onExit} toast={toastEl}
      />
    );
  }

  if (!createdEntry) return null;
  return <OrganizerMatchView match={createdEntry.match} players={createdEntry.players} onExit={onExit} store={store} />;
}
