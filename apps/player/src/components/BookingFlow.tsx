import { useState } from 'react';
import { whatsappShareUrl, type MatchFormat, type Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { overlaps } from './SlotPicker.js';
import { ReserverCreneau } from './ReserverCreneau.js';
import { SportPills } from './SportPills.js';
import { CancelReservationSheet } from './CancelReservationSheet.js';
import { ReserverTicket, type TicketState } from './ReserverTicket.js';
import { VenuesTerrains } from './VenuesTerrains.js';
import { useT } from '../lib/i18n.js';
import { epochDayLabel, epochMinutesOfDay, fmt, hhmm, pickerDateForWeekday } from '../lib/format.js';
import { reportRefusal } from '../lib/pasPossible.js';
import { useToast } from '../lib/useToast.js';
import { useFieldAvailability } from '../lib/useFieldAvailability.js';
import {
  HOURS_START_MIN, HOURS_END_MIN, DAYS, dayLabel,
} from '../data/bookingDemo.js';
import { sportChoicesFor, fieldsForSport, fieldForFormat, formatChoicesFor } from '../lib/venueCatalog.js';
import { canCancelInApp, canCreateMatchOn, lateCancelNotice } from '../lib/reservationView.js';
import {
  defaultStart, resolveFormat, startsForFormat, type PeriodKey,
} from '../lib/reserverCreneau.js';
import { sportLabel } from '../lib/labels.js';
import {
  venueLocationLabel, venueMapsUrl, venuePhoneHref, sportIcon,
  fieldFormatsLabel, fieldFormatList, formatTariffs,
} from '../lib/venueView.js';
import type { BookingResume, MatchPrefill } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/booking-match.css';

type Screen = 'venues' | 'terrain' | 'slots' | 'external' | 'proof';

interface ProofState {
  /** Id réel de la réservation en base (Lot 3B, étape 3) — distinct de `ref`
      (référence humaine affichée) : POST /bookings/:id/cancel a besoin de
      CET id, jamais de la référence. */
  id: string;
  ref: string;
  when: string;
  name: string;
  /** Montant NET (après remise), tel que renvoyé par le serveur. */
  totalDa: number;
  /** Lot P1, point 2 — remise promo appliquée par le serveur, 0 sinon. */
  discountDa: number;
  external: boolean;
  cancelled: boolean;
  /** Absent cote "j'ai deja reserve par telephone" (Chemin B externe) —
      l'intention sport/format n'y est pas capturee, contrairement au
      chemin normal ci-dessous. */
  format?: MatchFormat | undefined;
  /** Epoch reel du creneau — sans lui, cancelProof() ne peut pas comparer un
      vrai "maintenant" au vrai debut du creneau (voir canCancelBooking()). */
  range: { start: number; end: number };
  /** Nom du centre/terrain réels, CAPTURÉS au moment de la confirmation (A7,
      22/09/2026) — jamais relus depuis un état "courant" qui pourrait avoir
      changé (sport re-choisi) entre la réservation et l'affichage du récap. */
  venueName: string;
  fieldName: string;
}

/** « Ta réservation » (R4, mode consultation) : le ticket d'une réservation EXISTANTE, ouvert depuis Mes matchs. */
function proofFromReservation(store: AppStore, bookingId: string): ProofState | null {
  const r = store.reservations.find((x) => x.booking.id === bookingId);
  if (!r) return null;
  const { booking } = r;
  const info = store.fieldInfo(booking.fieldId);
  return {
    id: booking.id, ref: r.reference ?? '—',
    when: `${epochDayLabel(booking.range.start)} · ${hhmm(epochMinutesOfDay(booking.range.start))} → ${hhmm(epochMinutesOfDay(booking.range.end))}`,
    name: booking.reservationName ?? '', totalDa: booking.priceTotal.amount, discountDa: 0,
    external: booking.source === 'PHONE' && !booking.verifiedByCenter, cancelled: booking.status === 'CANCELLED',
    format: r.format, range: booking.range, venueName: info?.venueName ?? 'Centre', fieldName: info?.field.name ?? '—',
  };
}

export function BookingFlow({ store, venuePicked, viewReservationId, mode, resume, onCreateMatch, onExit, onHome, onMyMatches }: {
  store: AppStore;
  /** Lot 6 : Réserver en mode « Créer un match » (maquette Reserver mode=match) — R1/R3 changent de titre et le CTA de R3 mène à la
      configuration du match (le créneau n'est réservé qu'à « Publier le match », BUG-3) au lieu du ticket. */
  mode?: 'match' | undefined;
  /** Retour de la configuration vers R3 : la sélection (jour, format, durée, heure) est reprise ; `taken` ouvre « Oups… ». */
  resume?: BookingResume | undefined;
  /** R4 consultation : id d'une réservation existante → le ticket s'ouvre directement (retour = Mes matchs). */
  viewReservationId?: string | undefined;
  /** « Voir mes matchs » du ticket (R4). */
  onMyMatches?: (() => void) | undefined;
  /** Le centre est déjà résolu avant d'entrer (carte Explorer/Home déjà tapée) — on saute alors
      R1 (« Trouve ton terrain », Lot 5) et on ouvre directement sa fiche. Absent/false : l'écran
      s'ouvre sur R1, qui choisit lui-même le centre (plusieurs centres réels désormais, A8+). */
  venuePicked?: boolean | undefined;
  onCreateMatch: (prefill: MatchPrefill) => void;
  onExit?: (() => void) | undefined;
  /** Cible REELLE du CTA « Retour a l'accueil » du recap — onExit revient au
      dernier onglet visite, ce qui dementait le libelle (revue Premium). */
  onHome?: (() => void) | undefined;
}) {
  const initialView = viewReservationId ? proofFromReservation(store, viewReservationId) : null;
  const matchMode = mode === 'match';
  const [screen, setScreen] = useState<Screen>(initialView ? 'proof' : resume ? 'slots' : venuePicked ? 'terrain' : 'venues');
  const t = useT();
  const toast = useToast();
  const venue = store.venue;

  /* Intention avant disponibilite (meme logique que Créer un match, demande
     directe d'Aymen 29/08/2026) : Sport -> Date -> Durée -> Créneaux. Le FORMAT
     ne se choisit plus avant : son prix dépend du créneau (16/09/2026, demande
     d'Aymen), donc il se choisit APRÈS le créneau, tous les formats du terrain
     côte à côte avec leur prix (voir SlotPicker) — jamais présélectionné. Pas
     de Niveau ici — une simple réservation n'ouvre pas d'inscription.
     A7 (22/09/2026) : sport RÉEL premier proposé par le centre — jamais 'FOOTBALL'
     en dur (un centre padel-only afficherait alors un sport inexistant). */
  const sportChoices = sportChoicesFor(venue);
  const [sport, setSport] = useState<Sport | null>(() => resume?.sport ?? sportChoices[0]?.value ?? null);
  function selectSport(v: Sport) { setSport(v); setSel(null); setFormat(null); setPreferredFormat(null); setExFormat(null); setExError(''); }
  const [format, setFormat] = useState<MatchFormat | null>(() => resume?.format ?? null);
  /* Rule 17 (jour) : la rangée de jours commence à AUJOURD'HUI, jamais un jour fixe de démo. */
  const [wd, setWd] = useState(() => resume?.weekday ?? new Date().getDay());
  const [dur, setDur] = useState(() => resume?.durationMin ?? 90);
  const [sel, setSel] = useState<number | null>(() => (resume && !resume.taken ? resume.startMin : null));
  /* R3 : le nom de la réservation est proposé d'office (maquette « Aymen Belkacem »), modifiable. */
  const [name, setName] = useState(store.identity.name);
  /* R3 : format du terrain touché à l'étape précédente (R2) ; le joueur peut en choisir un autre. */
  const [preferredFormat, setPreferredFormat] = useState<MatchFormat | null>(() => resume?.format ?? null);
  const [period, setPeriod] = useState<PeriodKey | null>(null);
  /** Départ refusé par le serveur (SLOT_TAKEN) : ouvre la feuille « Oups, il vient d'être pris » (R3). */
  const [taken, setTaken] = useState<{ startMin: number; fieldName: string } | null>(() => (resume?.taken ? { startMin: resume.startMin, fieldName: resume.fieldName } : null));
  /* Code promo retiré de l'écran R3 (maquette Reserver.dc.html n'en a pas, décision d'Aymen 25/10/2026) :
     les promos restent applicables aux réservations saisies au centre (CRM). */
  const [confirming, setConfirming] = useState(false);
  /** Créneaux refusés par le serveur (SLOT_TAKEN) pendant cette visite de
      l'écran, par jour — Lot 3B, étape 3 : le serveur devient la vérité
      instantanément, sans attendre un vrai calendrier temps réel côté
      apps/player (hors périmètre de cette étape, voir rapport). Sans ça, le
      créneau qui vient d'échouer resterait cliquable et échouerait à
      nouveau, silence trompeur sur ce qui vient d'être appris. */
  const [rejectedByDay, setRejectedByDay] = useState<Record<number, number[]>>(() => (resume?.taken ? { [resume.weekday]: [resume.startMin] } : {}));

  /** R1 (« Trouve ton terrain ») → R2 : charge la fiche réelle du centre choisi puis RÉ-INITIALISE
      le sport sur ce nouveau centre — `sport` se fige normalement une seule fois au montage
      (lazy useState ci-dessus), ce qui conviendrait à `venuePicked` (le centre est déjà le bon
      avant même le premier rendu) mais figerait à tort le sport d'un centre PRÉCÉDENT quand R1
      vient de charger le nouveau. Même geste que selectSport (remet aussi créneau/format
      à zéro) — changer de centre ne doit jamais laisser une sélection de l'ancien. */
  async function pickVenue(venueId: string) {
    const res = await store.selectVenue(venueId);
    if (!res.ok) return res;
    setSport(sportChoicesFor(store.venue)[0]?.value ?? null);
    setSel(null); setFormat(null); setExFormat(null); setExError(''); setPreferredFormat(null); setPeriod(null);
    setScreen('terrain');
    return res;
  }

  const [exWd, setExWd] = useState(6);
  const [exStart, setExStart] = useState(1200);
  const [exDur, setExDur] = useState(90);
  const [exName, setExName] = useState('');
  const [exFormat, setExFormat] = useState<MatchFormat | null>(null);
  const [exError, setExError] = useState('');
  const [exConfirming, setExConfirming] = useState(false);

  const [proof, setProof] = useState<ProofState | null>(initialView);
  /* L'annulation est irreversible : sheet de confirmation AVANT d'agir
     (spec §11.11), la regle canonique canCancelBooking reste inchangee. */
  const [confirmCancel, setConfirmCancel] = useState(false);

  /* Grille de créneaux occupés — dérivée de l'état partagé (Lot 2, §2), pour
     le calcul mock de secours de SlotPicker uniquement (voir sa prop
     remoteStarts ci-dessous : sans elle, jamais consultée). + les créneaux
     que le serveur vient de refuser (SLOT_TAKEN) pour ce jour, le temps de
     cette visite d'écran (voir rejectedByDay ci-dessus). */
  const blockers = [
    ...store.blockersFor(wd),
    ...(rejectedByDay[wd] ?? []).map((startMin) => ({ startMin, endMin: startMin + dur, label: 'réservé' })),
  ];

  /* Terrains RÉELS du centre (actifs). A7 (22/09/2026) : affectation AUTOMATIQUE
     du terrain (décision Aymen, cadrage §1.3 : « le joueur choisit un format »)
     — jamais un sélecteur de terrain côté joueur. `sportFields` = les terrains
     du sport en cours, dans l'ordre de remplissage (fieldsForSport,
     lib/venueCatalog.ts) ; le terrain RÉSERVÉ est celui qui porte le devis du
     créneau + format choisis (`chosenEntry.fieldId`, ci-dessous) — T1 pour du
     5v5/6v6, T2 pour du 7v7 (A7 bis : la première version ne prenait que le
     premier terrain du sport, T2 n'était jamais atteignable). Vide seulement si
     la fiche du centre est indisponible ou si aucun terrain actif n'existe pour
     ce sport (cas limite, pas rencontré sur un centre réel aujourd'hui). */
  const venueFields = venue ? venue.fields.filter((f) => f.status === 'ACTIVE') : [];
  const sportFields = sport ? fieldsForSport(venue, sport) : [];
  const sportFieldIds = sportFields.map((f) => f.id);

  /* Lot 3B, étape 4 : disponibilité RÉELLE (GET /fields/:fieldId/availability,
     via lib/useFieldAvailability.ts, fusionnée sur les terrains du sport) —
     remplace la grille mock de fieldAvailability(). Deux instances du même
     hook : une pour la grille de l'écran "slots" (jour/durée choisis), une pour
     le bandeau "départs libres aujourd'hui" de l'écran "terrain" (toujours le
     jour réel du jour, 90 min — le défaut du parcours normal, cf. `dur` plus
     haut). Liste vide tant que les terrains réels ne sont pas résolus — aucun
     appel réseau ce cas-là. */
  const todayWeekday = new Date().getDay();
  const todayAvailability = useFieldAvailability(store, sportFieldIds, todayWeekday, 90, (msg) => toast.show(msg));
  const slotsAvailability = useFieldAvailability(store, sportFieldIds, wd, dur, (msg) => toast.show(msg));
  const todayStarts = todayAvailability.starts ?? [];

  /* Revue adverse, Lot 3B étape 4 : `remoteStarts` remplaçant intégralement le
     calcul mock de SlotPicker (jamais `undefined` une fois affiché), le filet
     visuel instantané `rejectedByDay` (qui ne vivait QUE dans ce calcul mock,
     via `blockers`) n'était plus consulté — un créneau qui vient d'échouer en
     SLOT_TAKEN restait cliquable jusqu'au retour du `refresh()` réseau. Filtré
     ici explicitement, même primitive `overlaps` que SlotPicker (une seule
     implémentation, jamais retapée).
     Le créneau choisi porte ses formats : UN seul → déduit, aucun sélecteur ;
     plusieurs → `format` doit avoir été choisi dans SlotPicker. `chosenEntry` =
     le devis (donc le TERRAIN) à réserver. */
  const rejectedBlockers = (rejectedByDay[wd] ?? []).map((startMin) => ({ startMin, endMin: startMin + dur, label: 'réservé' }));
  const visibleSlots = slotsAvailability.starts?.filter((s) => !overlaps(rejectedBlockers, s.startMin, s.startMin + dur));
  /* R3 (patron Reserver.dc.html) : format → durée → heure. Le format actif est celui que le joueur a touché,
     sinon celui du terrain touché à l'étape précédente, sinon le premier proposé ; les heures sont celles
     où CE format est libre ; une heure est proposée d'office (18:00, sinon la première après) — la même
     que la maquette, jamais un départ inexistant. `chosenEntry` = le devis (donc le TERRAIN) à réserver. */
  const formatOptions = slotsAvailability.formats;
  const activeFormat = formatOptions ? resolveFormat(formatOptions, format, preferredFormat) : null;
  const formatStarts = visibleSlots ? startsForFormat(visibleSlots, activeFormat) : undefined;
  const activeSel = formatStarts
    ? (sel !== null && formatStarts.some((s) => s.startMin === sel) ? sel : defaultStart(formatStarts))
    : null;
  const chosenEntry = formatStarts?.find((s) => s.startMin === activeSel)?.byFormat.find((f) => f.format === activeFormat);
  const effectiveFormat: MatchFormat | null = chosenEntry?.format ?? null;
  const bookField = chosenEntry ? venue?.fields.find((f) => f.id === chosenEntry.fieldId) : undefined;
  const exFormatOptions = formatChoicesFor(sportFields);
  const venueName = venue?.name ?? 'Centre';

  /** Lot 3B, étape 3 : POST /bookings réel — plus de référence générée côté
      client (bookingReference() local, Lot 2), l'id ET la référence viennent
      de la réponse serveur (docs/LOT3A_AUDIT_COMPATIBILITE_API.md §8.1,
      confirmé le 30/08/2026). Sur SLOT_TAKEN : reste sur cet écran, efface
      SEULEMENT la sélection périmée, marque ce créneau refusé pour ce jour
      (grille honnête, voir rejectedByDay), message clair — proposition
      validée par Aymen dans l'addendum §8.3 de l'audit. */
  async function confirmSlot() {
    if (activeSel === null || name.trim().length < 2 || !effectiveFormat || !bookField) return;
    const startMin = activeSel;
    /* Mode « Créer un match » (Lot 6) : « Réserver et configurer le match » garde le créneau choisi et passe à la configuration — la
       réservation et le match partent ensemble à « Publier le match » (BUG-3, audit pré-lancement : abandonner ne laisse aucune
       réservation vivante). Le serveur tranche un créneau pris à ce moment-là (retour ici sur « Oups, il vient d'être pris »). */
    if (matchMode) {
      onCreateMatch({
        pendingSlot: {
          fieldId: bookField.id, date: slotsAvailability.date, startMin, durationMin: dur, format: effectiveFormat,
          total: chosenEntry!.quote.total, reservationName: name.trim(),
        },
        sport: sport ?? undefined, format: effectiveFormat,
      });
      return;
    }
    setConfirming(true);
    /* Lot 3B, étape 4 : `date` vient TEL QUEL du hook de disponibilité (le
       même déjà utilisé pour interroger le serveur pour ce jour) — jamais
       reconstruit via resolveNextWeekday/epochDateStamp à partir d'un epoch,
       seule garantie contre l'ambiguïté d'un créneau après minuit (le jour
       calendaire réel d'un epoch peut différer du jour interrogé — voir
       docs/DECISIONS.md, Lot 3B étape 4). */
    const res = await store.createBooking({
      fieldId: bookField.id, date: slotsAvailability.date, startMin, durationMin: dur, reservationName: name.trim(),
      format: effectiveFormat,
    });
    setConfirming(false);
    if (!res.ok) {
      /* SLOT_IN_PAST (Lot P1, point 1) traité comme SLOT_TAKEN : le départ
         refusé sort de la grille et de la sélection, sinon il resterait
         cliquable et échouerait à nouveau (revue adverse du lot). */
      if (res.code === 'SLOT_TAKEN' || res.code === 'SLOT_IN_PAST') {
        setRejectedByDay((r) => ({ ...r, [wd]: [...(r[wd] ?? []), startMin] }));
        setSel(null);
        slotsAvailability.refresh();
        /* SLOT_TAKEN : la feuille de repli parle à la place du toast (créneaux libres les plus proches) ; SLOT_IN_PAST
           (heure déjà passée) n'est la faute de personne — message serveur seul, pas de « quelqu'un d'autre ». */
        if (res.code === 'SLOT_TAKEN') { setTaken({ startMin, fieldName: bookField.name }); return; }
      }
      if (reportRefusal(res)) return;   // Lot 9 : une limite s'explique en fenêtre (« Pas possible pour l'instant »)
      toast.show(res.message);
      return;
    }
    const nextProof: ProofState = {
      id: res.booking!.id, ref: res.reference!, when: `${dayLabel(wd)} · ${hhmm(startMin)} → ${hhmm(startMin + dur)}`,
      name: name.trim(), totalDa: res.booking!.priceTotal.amount, discountDa: res.discountDa ?? 0,
      external: false, cancelled: false, format: effectiveFormat,
      range: res.booking!.range, venueName, fieldName: bookField.name,
    };
    setProof(nextProof);
    setSel(null);
    setFormat(null);
    setScreen('proof');
    /* Les DEUX hooks (bandeau "aujourd'hui" + grille "slots") sont deux
       instances React distinctes, même quand elles ciblent par coïncidence
       le même jour (ex. réserver "aujourd'hui" lui-même) — sans rafraîchir
       explicitement les deux, la grille resterait périmée si l'utilisateur
       revient réserver un DEUXIÈME créneau le même jour/durée sans changer
       ni l'un ni l'autre (bug trouvé en vérification live, pas au typecheck). */
    todayAvailability.refresh();
    slotsAvailability.refresh();
  }

  const exHourOptions: number[] = [];
  for (let m = HOURS_START_MIN; m < HOURS_END_MIN; m += 30) exHourOptions.push(m);

  /** Lot 3B, étape 3 : même route réelle que confirmSlot (POST /bookings,
      source PHONE) — remplace registerExternalBooking (core, local) : la
      vraie disponibilité/conflit est désormais tranchée par le serveur
      (SLOT_TAKEN), plus une approximation locale des créneaux occupés qui
      pouvait diverger. `centerNotified` (réponse serveur) pilote le message,
      plus un texte câblé en dur sur `external===true`. */
  async function confirmExternal() {
    const e = exStart + exDur;
    if (e > HOURS_END_MIN) {
      setExError('Ce créneau sort des horaires d’ouverture du centre.');
      return;
    }
    if (exFormatOptions.length > 1 && !exFormat) {
      setExError('Choisis le format de ta réservation.');
      return;
    }
    /* Terrain affecté par (sport, format) — même règle que le chemin en ligne ; un sport à UN
       seul format le déduit. */
    const exResolvedFormat = exFormat ?? (exFormatOptions.length === 1 ? exFormatOptions[0]!.value : null);
    const exField = sport && exResolvedFormat ? fieldForFormat(venue, sport, exResolvedFormat) : undefined;
    if (!exField || !exResolvedFormat) {
      setExError('Terrain indisponible pour le moment — réessaie dans un instant.');
      return;
    }
    setExError('');
    setExConfirming(true);
    /* BUG-10 (audit pré-lancement, 26/09/2026) : la date vient du JOUR choisi (même règle que les chips et que le
       chemin A), jamais d'un epoch recalculé avec l'heure — resolveNextWeekday(exWd, 1440) basculait au lendemain
       pour un départ à 00:00 (+1), et le serveur ajoutait encore `startMin = 1440` : déclaration posée une nuit trop
       tard (ouvert depuis le 04/09). `startMin` ≥ 1440 = après minuit du jour choisi, c'est le contrat de l'API. */
    const res = await store.createBooking({
      fieldId: exField.id, date: pickerDateForWeekday(exWd), startMin: exStart, durationMin: exDur,
      source: 'PHONE', reservationName: exName.trim(), format: exResolvedFormat,
    });
    setExConfirming(false);
    if (!res.ok) { if (!reportRefusal(res)) setExError(res.message); return; }
    const nextProof: ProofState = {
      id: res.booking!.id, ref: res.reference!, when: `${dayLabel(exWd)} · ${hhmm(exStart)} → ${hhmm(e)}`,
      name: exName.trim(), totalDa: res.booking!.priceTotal.amount, discountDa: 0, external: true, cancelled: false,
      format: exResolvedFormat,
      range: res.booking!.range, venueName, fieldName: exField.name,
    };
    setProof(nextProof);
    setScreen('proof');
    todayAvailability.refresh();
    slotsAvailability.refresh();
    toast.show(res.centerNotified ? 'Le centre est alerté : réservation téléphonique à confirmer.' : 'Réservation déclarée.');
  }

  /** Lot 3B, étape 3 : POST /bookings/:id/cancel réel (canCancelBooking,
      règle H-2, tranchée côté serveur — le seul juge maintenant, plus une
      copie locale de la même règle). `proof.id` (id réel), jamais `proof.ref`
      (référence humaine — l'API attend l'id de la réservation). Message affiché
      = celui du serveur (§18/§19, 25/10/2026) : lui seul sait si c'est une
      demi-absence, jamais un texte générique recomposé ici. */
  async function cancelProof() {
    if (!proof || proof.cancelled) return;
    const check = await store.cancelBooking(proof.id);
    if (!check.ok) {
      setConfirmCancel(false);
      toast.show(check.message);
      return;
    }
    setProof({ ...proof, cancelled: true });
    todayAvailability.refresh();
    slotsAvailability.refresh();
    toast.show(check.message ?? 'Annulée. Le créneau est libéré.');
  }

  /* Pivot Booking -> Create Match : le bouton existait deja mais jetait
     onCreateMatch() sans argument, forçant MatchFlow a repartir de zero a
     l'etape "sport" (finding #4 du spec Premium). Reutilise le VRAI Booking
     (id reel, deja dans store.reservations via createBooking) — plus une
     reconstruction locale (proofToBooking, retiree Lot 3B etape 3). */
  async function handleCreateMatch() {
    if (!proof || proof.cancelled) return;
    const real = store.reservations.find((r) => r.booking.id === proof.id)?.booking;
    if (!real) return;
    /* Comme MatchesScreen.createMatchOn : le flux Créer un match travaille sur le centre OUVERT — d'abord aligné
       sur le centre de CETTE réservation (mode consultation : elle peut être à un autre centre que celui ouvert). */
    const info = store.fieldInfo(real.fieldId);
    if (info && store.venue?.id !== info.venueId) {
      const switched = await store.selectVenue(info.venueId);
      if (!switched.ok) { toast.show(switched.message); return; }
    }
    onCreateMatch({
      booking: real, label: proof.when, ref: proof.ref,
      sport: (info?.field.sport as Sport | undefined) ?? sport ?? undefined, format: proof.format,
    });
  }

  /* R2 (patron Reserver.dc.html, estCentre) : une pastille "Libre ce soir" réserve
     direct sur le créneau du jour réel (90 min, le défaut du parcours normal — même
     geste que todayAvailability plus haut). */
  function pickQuickSlot(startMin: number) {
    /* La pastille porte son heure : le format est le premier réellement libre à cette heure (jamais un
       format qui n'y serait pas libre), l'affectation du terrain suit le format (A7). */
    const firstFormat = todayStarts.find((s) => s.startMin === startMin)?.byFormat[0]?.format ?? null;
    setWd(todayWeekday); setDur(90); setFormat(firstFormat); setPreferredFormat(null); setPeriod(null); setSel(startMin);
    setScreen('slots');
  }

  /* Taper un terrain ne le "réserve" pas lui-même — A7 (22/09/2026) : l'affectation
     reste automatique par (sport, format) à l'étape créneaux. Un terrain d'un AUTRE
     sport que celui en cours bascule juste l'intention sport (selectSport, même reset
     que le sélecteur de sport), jamais un sélecteur de terrain côté joueur. */
  function pickTerrain(f: { sport: string; formats: readonly string[] | string | null | undefined }) {
    if (f.sport !== sport) selectSport(f.sport as Sport);
    /* R3 s'ouvre sur le premier format de CE terrain (maquette) ; « Réserver » sans terrain touché
       s'ouvre sur le premier format du premier terrain (resolveFormat, ordre de remplissage). */
    setPreferredFormat(fieldFormatList(f.formats)[0] as MatchFormat | undefined ?? null);
    setFormat(null); setSel(null); setPeriod(null);
    setScreen('slots');
  }

  if (screen === 'venues') {
    return <VenuesTerrains store={store} onPick={pickVenue} onExit={onExit} matchMode={matchMode} />;
  }

  if (screen === 'terrain') {
    return (
      <section className="au-screen" id="s-terrain">
        <div className="bk-hero">
          <img src={heroPhoto} alt={`Terrain synthétique éclairé du ${venueName}`} />
          <span className="mb-photo__scrim" />
          <div className="bk-top">
            <button type="button" className="mb-back mb-back--glass mb-tap" aria-label={t('Retour')} onClick={() => (venuePicked ? onExit?.() : setScreen('venues'))}><Icon id="i-back" /></button>
            <a
              className="mb-back mb-back--glass mb-tap" aria-label={t('Partager')}
              href={whatsappShareUrl(`${venueName} — réserve ton terrain sur Moubarat.`)}
              target="_blank" rel="noopener noreferrer"
            ><Icon id="i-share" /></a>
          </div>
          <div className="bk-hero-info">
            {sport ? <span className="bk-herosport"><Icon id={sportIcon(sport)} className="mb-ic--sm" />{t(sportLabel(sport))}</span> : null}
            <h1 className="mb-d2">{venueName}</h1>
            {venue ? (
              <span className="bk-hero-loc mb-tag">
                {venueLocationLabel(venue)} · <a className="bk-link" href={venueMapsUrl(venue)} target="_blank" rel="noopener noreferrer">{t('Itinéraire →')}</a>
              </span>
            ) : null}
          </div>
        </div>
        <div className="bk-pad">
          {/* "Libre ce soir" (patron Reserver.dc.html) : pastilles RÉELLES (GET /fields/:fieldId/
              availability, jamais un horaire inventé) — remplace le bandeau texte d'avant, la
              disponibilité se lit directement sur les pastilles. Jusqu'à 4, jour réel du jour. */}
          <h2 className="bk-sec">{t('Libre ce soir')}</h2>
          {todayAvailability.starts === undefined ? (
            <p className="mb-meta" style={{ margin: '0 0 18px' }}>{t('Vérification des disponibilités…')}</p>
          ) : todayStarts.length > 0 ? (
            <div className="bk-quick__row">
              {todayStarts.slice(0, 4).map((s) => (
                <button key={s.startMin} type="button" className="bk-quick__pill mb-tap" onClick={() => pickQuickSlot(s.startMin)}>
                  <Ltr>{hhmm(s.startMin)}</Ltr>
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-meta" style={{ margin: '0 0 18px' }}>{t('Plus de départ libre aujourd’hui — regarde les prochains jours')}</p>
          )}

          {/* "Les terrains" (patron Reserver.dc.html) : remplace la grille de tarifs
              génériques d'avant — le prix exact par créneau ET par format apparaît déjà à
              l'étape suivante (SlotPicker), plus précis qu'un "dès" affiché deux fois. */}
          <h2 className="bk-sec">{t('Les terrains')}</h2>
          <div className="bk-terrains">
            {venueFields.map((f) => {
              const rates = formatTariffs(f).map((ft) => ft.baseRateDa);
              const fromDa = rates.length > 0 ? Math.min(...rates) : null;
              return (
                <button key={f.id} type="button" className="bk-terrain-row mb-tap" onClick={() => pickTerrain(f)}>
                  <span className="bk-terrain-row__pitch" aria-hidden="true" />
                  <span className="bk-terrain-row__body">
                    <span className="bk-terrain-row__name">{f.name}</span>
                    <span className="bk-terrain-row__meta">{fieldFormatsLabel(f.formats)}</span>
                  </span>
                  {fromDa !== null ? (
                    <span className="bk-terrain-row__price">
                      <span>{t('dès')}</span>
                      <b className="mb-price" data-unit="hour"><Ltr>{fmt(fromDa)}</Ltr><span className="mb-price__cur">{t('DA')}</span></b>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {venue ? null : <p className="mb-meta" style={{ margin: '4px 0 12px' }}>{t('Fiche du centre indisponible pour le moment — les créneaux et les prix ci-dessous restent réels.')}</p>}

          {/* BUG-7 (audit pré-lancement, 26/09/2026) : l'itinéraire est sur la photo (R2) ; le
              téléphone du centre reste, cliquable — hors maquette épurée, gardé sur décision
              d'Aymen (25/10/2026) : l'app renvoie au téléphone pour réserver par appel. Sans
              numéro renseigné, la ligne n'apparaît pas (rien d'inventé). */}
          {venue?.phone ? (
            <div className="bk-hours">
              <div className="bk-hours__row">
                <span>{t('Téléphone')}</span>
                <b><a className="bk-link" href={venuePhoneHref(venue.phone)}><Ltr>{venue.phone}</Ltr></a></b>
              </div>
            </div>
          ) : null}

          {/* Règle 21 (26/10/2026) : le bouton provisoire « J'ai déjà réservé par téléphone » est RETIRÉ (décision d'Aymen) — une réservation prise par téléphone se
              rattache désormais au compte par son numéro, saisi par le centre, et le joueur confirme « C'est bien toi ? ». */}
          <div className="mb-sticky-actions">
            <button type="button" className="mb-btn mb-btn--block" onClick={() => setScreen('slots')}>{t('Réserver')}</button>
          </div>
        </div>
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  if (screen === 'slots') {
    return (
      <ReserverCreneau
        matchMode={matchMode}
        venueName={venueName}
        onBack={() => setScreen('terrain')}
        weekday={wd}
        onSelectWeekday={(v) => { setWd(v); setSel(null); setPeriod(null); }}
        formatOptions={formatOptions}
        activeFormat={activeFormat}
        onSelectFormat={(f) => { setFormat(f); setPeriod(null); }}
        duration={dur}
        onSelectDuration={(v) => { setDur(v); setSel(null); setPeriod(null); }}
        allStarts={visibleSlots}
        selectedStart={activeSel}
        onSelectStart={setSel}
        period={period}
        onSelectPeriod={setPeriod}
        name={name}
        onName={setName}
        total={chosenEntry?.totalDa ?? null}
        fieldName={bookField?.name ?? null}
        canConfirm={activeSel !== null && name.trim().length >= 2 && !!effectiveFormat && !!bookField}
        confirming={confirming}
        onConfirm={confirmSlot}
        toast={<div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>}
        taken={taken}
        onTakeAlternative={(startMin) => { setSel(startMin); setPeriod(null); setTaken(null); }}
        onCloseTaken={() => setTaken(null)}
      />
    );
  }

  if (screen === 'external') {
    return (
      <section className="au-screen" id="s-external">
        <div className="bk-pad">
          <div className="bk-top">
            <button type="button" className="mb-back mb-tap" aria-label="Retour" onClick={() => setScreen('terrain')}><Icon id="i-back" /></button>
            <span className="bk-step">Chemin B</span>
            <span className="mb-back-spacer" />
          </div>
          <h2 className="mb-d2" style={{ margin: '14px 0 4px' }}>Déjà réservé ?</h2>
          <p className="mb-meta" style={{ margin: '0 0 18px' }}>
            Tu as appelé le centre ? Déclare ta réservation : elle bloque le créneau et le centre la confirme.
          </p>

          <SportPills sport={sport} options={sportChoices} onSelect={selectSport} />

          <div className="bk-row">
            <span className="mb-field__label" style={{ minWidth: 52, margin: 0 }}>Jour</span>
            <div className="bk-row" style={{ margin: 0 }}>
              {DAYS.map((d) => (
                <button
                  key={d.weekday} type="button" className="mb-chip" aria-pressed={exWd === d.weekday}
                  onClick={() => setExWd(d.weekday)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bk-row" style={{ gap: 10 }}>
            <label className="mb-field" style={{ flex: 1 }}>
              <span className="mb-field__label">Heure</span>
              <select className="mb-field__control" value={exStart} onChange={(e) => { setExStart(Number(e.target.value)); setExError(''); }}>
                {exHourOptions.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
              </select>
            </label>
            <label className="mb-field" style={{ flex: 1 }}>
              <span className="mb-field__label">Durée</span>
              <select className="mb-field__control" value={exDur} onChange={(e) => { setExDur(Number(e.target.value)); setExError(''); }}>
                <option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option>
              </select>
            </label>
          </div>
          {exFormatOptions.length > 1 ? (
            <div className="cm-sub" style={{ marginTop: 4 }}>
              <p className="hm-section-label">Format</p>
              <div className="cm-chips">
                {exFormatOptions.map((f) => (
                  <button key={f.value} type="button" className="mb-chip" aria-pressed={exFormat === f.value} onClick={() => { setExFormat(f.value); setExError(''); }}>
                    {f.value} · {f.capacity} joueurs
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="mb-field" style={{ marginTop: 4 }}>
            <span className="mb-field__label">Au nom de qui ?</span>
            <input
              className="mb-field__control" placeholder="Le nom donné au téléphone" maxLength={40}
              value={exName} onChange={(e) => { setExName(e.target.value); setExError(''); }}
            />
          </label>
          <p className={`au-error${exError ? ' on' : ''}`} style={{ marginTop: 10 }}><Icon id="i-x" className="mb-ic--sm" /><span>{exError}</span></p>

          <div style={{ flex: 1 }} />
          <button
            type="button" className="mb-btn mb-btn--block" data-loading={exConfirming ? 'true' : undefined}
            disabled={exName.trim().length < 2 || exConfirming} onClick={confirmExternal}
          >
            Déclarer ma réservation
          </button>
          <p className="mb-meta" style={{ textAlign: 'center', margin: '10px 0 0' }}>Le centre reçoit une alerte et confirme ta réservation.</p>
        </div>
        <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      </section>
    );
  }

  if (!proof) return null;

  /* Le ticket (R4) : un seul composant pour la confirmation et la consultation. Les droits d'agir
     (annuler, créer un match) sont ceux du core, jugés sur la réservation réelle du store. */
  const nowMs = Date.now();
  const live = store.reservations.find((r) => r.booking.id === proof.id)?.booking;
  /* Match lié ENCORE vivant : l'annulation l'emporte avec elle (cascade serveur, BUG-1) — la feuille le dit. */
  const linked = live?.matchId ? store.findMatch(live.matchId) : undefined;
  const liveMatch = linked && linked.match.status !== 'CANCELLED' && linked.match.status !== 'PLAYED' ? linked : undefined;
  const ticketState: TicketState = proof.cancelled ? 'cancelled' : proof.range.end <= nowMs ? 'past' : proof.external ? 'pending' : 'reserved';
  const shareText = `J’ai réservé ${proof.when} à ${proof.venueName}. Code ${proof.ref}.`;

  return (
    <ReserverTicket
      mode={viewReservationId ? 'view' : 'confirm'}
      state={ticketState}
      venueName={proof.venueName}
      fieldName={proof.fieldName}
      format={proof.format ?? null}
      totalDa={proof.totalDa}
      code={proof.ref}
      rangeStart={proof.range.start}
      rangeEnd={proof.range.end}
      canCancel={!proof.cancelled && !!live && canCancelInApp(live, nowMs)}
      canCreateMatch={!proof.cancelled && !!live && canCreateMatchOn(live, nowMs)}
      late={lateCancelNotice(proof.range.start, nowMs) !== null}
      shareUrl={whatsappShareUrl(shareText)}
      onBack={viewReservationId ? onExit : undefined}
      onCancel={() => setConfirmCancel(true)}
      onCreateMatch={handleCreateMatch}
      onMyMatches={onMyMatches ?? onHome}
      now={nowMs}
      toast={<div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>}
      sheet={confirmCancel && live ? (
        <CancelReservationSheet
          booking={live} venueName={proof.venueName} fieldName={proof.fieldName}
          match={liveMatch ? { start: liveMatch.match.range.start, players: liveMatch.players } : null}
          busy={false}
          onKeep={() => setConfirmCancel(false)}
          onConfirm={() => { setConfirmCancel(false); cancelProof(); }}
        />
      ) : null}
    />
  );
}
