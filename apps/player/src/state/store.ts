/* =============================================================================
   ÉTAT PARTAGÉ — LOT 2 (stabilisation production), correctif racine.
   Avant ce fichier, chaque écran (MatchDetail, OrganizerMatchView, BookingFlow,
   CreateMatchFlow, HistoryScreen...) copiait les données de démo dans son
   propre useState local — une mutation (rejoindre, réserver, annuler, noter)
   ne survivait jamais à une navigation. Ici : UNE seule carte des matchs, UNE
   seule liste de réservations, UNE seule liste de notes — tous les écrans qui
   les lisent voient exactement le même état, immédiatement après une action.

   Logique pure, sans React : chaque fonction `applyXxx` prend un StoreState et
   renvoie le suivant (+ un RuleResult le cas échéant) — jamais de useState ici,
   jamais un accès direct au DOM/localStorage. Testable sans monter un
   composant (voir tests/store.test.ts). `state/useAppStore.ts` est le seul
   fichier qui branche ça sur React (un useState + ces fonctions).

   RIEN n'est réimplémenté depuis @moubarat/core : chaque mutation métier
   (joinMatch, leaveMatch, removePlayer, canOrganizerAct, createMatch,
   canCancelBooking, applyRating, notify) appelle la règle canonique — ce
   fichier ne fait qu'orchestrer OÙ vit le résultat. */

import {
  activePlayers, joinMatch as coreJoinMatch, leaveMatch as coreLeaveMatch, removePlayer as coreRemovePlayer,
  canOrganizerAct, MATCH_TRANSITIONS, canTransition,
  createMatch as coreCreateMatch, isBlocking, canCancelBooking,
  notify, RECIPIENTS, applyRating as coreApplyRating,
  fail, ok,
  type Match, type MatchPlayer, type Booking, type Rating, type Notification, type MatchResult,
  type RuleResult, type TimeRange, type MatchFormat, type SkillLevel, type Sport, type Field,
} from '@moubarat/core';
import { epochMinutesOfDay } from '../lib/format.js';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from '../data/identity.js';
import { OPEN_MATCHES, MY_UPCOMING, PAST_ENTRIES, type FeedEntry } from '../data/matchesFeedDemo.js';
import { MY_RESERVATIONS, type MyReservation } from '../data/reservationsDemo.js';
import type { Blocker } from '../data/bookingDemo.js';
import { NOTIFICATIONS_SEED } from '../data/notificationsDemo.js';

export interface MatchRecord {
  match: Match;
  players: MatchPlayer[];
  /** Le code du lien du match (« app.moubarat.app/m/CODE », migration 0036) — absent tant que le serveur ne l'a pas servi (un match sur invitation ne le montre qu'à qui le connaît). */
  code?: string | undefined;
}

/** `city` — règle 34 (refonte-app-joueur/docs/regles.md) : choisie à l'onboarding, servie par
    /auth/me (lot 4b, règles 11/33 — « ville du joueur »). `null` tant qu'elle n'est pas connue :
    on ne filtre/trie jamais sur une donnée qu'on n'a pas. */
export interface Identity { name: string; sport: Sport | null; level: SkillLevel | null; city: string | null }

/** Forme de GET /venues/:venueId telle que servie (apps/api, modules/venues)
    — déjà camelCase, aucun remappage : ce que l'API dit, l'app l'affiche.
    `rating.visible=false` = pas assez d'avis pour afficher une moyenne
    (seuil VENUE_RATING_MIN_COUNT, core) — l'écran le dit, n'invente rien. */
export interface PricingRuleView {
  id: string; label: string; weekdays: number[]; startMin: number; endMin: number; rateDaPerHour: number;
  /** Une bande est propre à UN format (16/09/2026). */
  format: string;
}

export interface VenueDetail {
  id: string; name: string; wilaya: string; address: string; phone: string | null;
  /** Position servie par l'API (jamais affichée comme distance — aucune géolocalisation) : sert au lien « Itinéraire ». */
  lat: number | null; lng: number | null;
  description: string | null; equipments: string[]; photos: string[];
  fields: {
    id: string; name: string; sport: string; formats: string[]; hourlyRateDa: number;
    /** Seule source de vérité des formats du terrain, avec le tarif de base de
        chacun (16/09/2026) — `formats` n'en est que la projection. */
    formatPrices: { format: string; hourlyRateDa: number }[];
    surface: string | null; sizeLabel: string | null; indoor: boolean; status: string;
    /** Bandes tarifaires réelles du terrain (décision Aymen 04/09/2026) —
        les mêmes règles que celles qui chiffrent les créneaux. */
    pricingRules: PricingRuleView[];
  }[];
  openingHours: { weekday: number; startMin: number; endMin: number }[];
  rating: { avg: number | null; count: number; visible: boolean; minCount: number };
}

/** Un centre tel que le sert `GET /venues` (liste enrichie, A5) — assez pour une carte de l'Explorer et pour
    résoudre le nom d'un centre / d'un terrain à partir d'un id, sans charger sa fiche complète. La fiche
    (`VenueDetail`, horaires/tarifs/note détaillés) ne se charge que pour le centre qu'on ouvre. */
export interface VenueSummary {
  id: string; name: string; wilaya: string; address: string; lat: number | null; lng: number | null;
  /** Téléphone public du centre (BUG-7, 26/09/2026) — `null` si le centre ne l'a pas renseigné. */
  phone: string | null;
  description: string | null; equipments: string[];
  sports: string[]; formats: string[];
  /** Plus bas tarif horaire de base, tous formats confondus (field_format_prices) — `null` sans terrain. */
  priceFromDa: number | null;
  rating: VenueDetail['rating'];
  fields: {
    id: string; name: string; sport: string; formats: string[];
    formatPrices: { format: string; hourlyRateDa: number }[];
    surface: string | null; sizeLabel: string | null; indoor: boolean; status: string;
  }[];
}

export interface StoreState {
  matches: Record<string, MatchRecord>;
  reservations: MyReservation[];
  ratings: Rating[];
  consumedBookingIds: Record<string, true>;
  notifications: Notification[];
  identity: Identity;
  /** Compteur de référence de réservation (bookingReference, core) — Lot 2,
      passe de validation §5 : vivait avant en useState local à BookingFlow,
      remis à 481 à chaque remontage. Deux réservations faites dans la même
      session mais dans deux visites séparées de l'écran généraient la MÊME
      référence ("COM-0482" à chaque fois), et la seconde écrasait
      silencieusement la première dans state.reservations (upsert par id).
      Un compteur partagé, jamais réinitialisé tant que dure la session. */
  bookingSeq: number;
  /** Jeton Bearer de la session réelle (Lot 3B) — `null` avant connexion.
      Vit ici (plutôt que dans un état React séparé côté App.tsx) pour rester
      la même source unique que le reste : tout composant qui a déjà `store`
      peut lire `store.token` sans fil supplémentaire à faire passer. Le
      localStorage réel est géré par lib/session.ts, jamais ici directement
      (voir commentaire d'en-tête : logique pure, sans I/O). */
  token: string | null;

  /* --- Lot 3B, étape 2 (lectures seules) -----------------------------------
     `null` avant la première résolution réussie de GET /auth/me — jamais un
     objet vide fabriqué, l'absence honnête vaut mieux qu'une identité par
     défaut inventée. */
  me: { id: string; name: string; phone: string; role: string } | null;
  /** GET /me/ovr + GET /users/:id/rating — la partie du Profil qui a un vrai
      équivalent serveur. Les stats "(défis)" (victoires/défaites/forme) du
      même écran restent volontairement locales : elles dérivent du domaine
      Teams/Défis (teamsDemo.ts), hors périmètre de ce lot (flag désactivé) —
      les brancher aurait aussi changé leur sens (tous matchs vs défis
      seulement) sans autorisation de retoucher le libellé affiché. */
  profile: {
    ovr: number | null; ovrExplanation: string; matchesPlayed: number;
    ratingAvg: number | null; ratingCount: number; ratingVisible: boolean;
  } | null;
  /** GET /matches/:id/result, un par match PLAYED réellement mien — pas de
      route en lot pour "tous mes résultats" (cf. audit Lot 3A), d'où un
      Record rempli match par match plutôt qu'un tableau reçu d'un coup. */
  matchResults: Record<string, MatchResult>;
  /** Lot P1 (03/09/2026), point 3 — fiche RÉELLE du centre (GET /venues/:id),
      `null` tant qu'elle n'est pas chargée ou si l'appel a échoué : les
      écrans affichent alors une absence honnête, jamais la constante figée
      de data/venues.ts pour ces champs-là. */
  venue: VenueDetail | null;
  /** A8 (24/09/2026) — TOUS les centres actifs (GET /venues), pour l'Explorer et pour résoudre le nom du
      centre / du terrain d'un match ou d'une réservation à partir de son id (jamais « le centre courant »,
      faux dès qu'il y en a plusieurs). `venue` ci-dessus est la fiche du centre OUVERT (celui qu'on réserve). */
  venues: VenueSummary[];

  /* --- Lot 3B, étape 3 (mutations) ----------------------------------------
     Annuaire de noms réels, rempli par GET /matches/:id (roster nominatif) —
     `MatchPlayer` (core) n'a pas de champ `name`, ce Record vit à part.
     Jamais vidé/remplacé en bloc : ne fait que grossir au fil des matchs
     réellement consultés (`applyMergePlayerNames`), comme un cache honnête —
     un id absent de ce dictionnaire n'a simplement pas encore été résolu. */
  playerNames: Record<string, string>;
}

/* --- Amorçage --------------------------------------------------------------
   Les trois anciennes listes figées (OPEN_MATCHES/MY_UPCOMING/PAST_ENTRIES)
   restent les DONNÉES DE DÉMO — elles deviennent la valeur INITIALE d'une
   seule carte mutable, exactement comme l'ancien registre `ALL` de
   matchesFeedDemo.ts, mais désormais réellement modifiable. */

export function initialState(): StoreState {
  const matches: Record<string, MatchRecord> = {};
  for (const e of [...MY_UPCOMING, ...OPEN_MATCHES, ...PAST_ENTRIES]) {
    matches[e.match.id] = { match: e.match, players: e.players };
  }
  return {
    matches,
    reservations: [...MY_RESERVATIONS],
    ratings: [],
    consumedBookingIds: {},
    bookingSeq: 481,
    notifications: [...NOTIFICATIONS_SEED],
    /* Nom par défaut avant résolution réelle (écran de connexion ou
       vérification GET /auth/me au chargement, useAppStore.ts) — jamais
       affiché à un utilisateur réellement authentifié, seulement transitoire. */
    identity: { name: CURRENT_USER_NAME, sport: null, level: null, city: null },
    token: null,
    me: null,
    profile: null,
    matchResults: {},
    playerNames: {},
    venue: null,
    venues: [],
  };
}

/* --- Sélecteurs -------------------------------------------------------------
   Dérivés à chaque lecture depuis LA carte — jamais une deuxième liste
   maintenue en parallèle qui pourrait diverger (spec §3, "une seule source
   de vérité"). */

export function findMatch(state: StoreState, matchId: string): MatchRecord | undefined {
  return state.matches[matchId];
}

function isUpcomingStatus(status: Match['status']): boolean {
  return status !== 'PLAYED' && status !== 'CANCELLED';
}

function isMine(e: MatchRecord): boolean {
  return e.match.organizerId === CURRENT_USER_ID || activePlayers(e.players).some((p) => p.userId === CURRENT_USER_ID);
}

/** Matchs où je participe/organise, pas encore joués/annulés — triés par
    coup d'envoi le plus proche (« Ton prochain match » veut dire chronologique,
    pas « premier de la liste »). */
export function myUpcoming(state: StoreState): FeedEntry[] {
  return Object.values(state.matches)
    .filter((e) => isUpcomingStatus(e.match.status) && isMine(e))
    .sort((a, b) => a.match.range.start - b.match.range.start)
    .map((e) => ({ match: e.match, players: e.players }));
}

/** TOUS mes matchs (organisés ou rejoints), quel que soit leur statut — à venir, joués, annulés : Mes matchs › Passés (lot 8) trie lui-même. */
export function myMatches(state: StoreState): FeedEntry[] {
  return Object.values(state.matches)
    .filter((e) => isMine(e))
    .sort((a, b) => b.match.range.start - a.match.range.start)
    .map((e) => ({ match: e.match, players: e.players }));
}

/** Matchs réellement browsables (Explorer, Home « Aujourd'hui ») — n'importe
    quel organisateur, tant que le match est publiquement visible et pas
    encore verrouillé/joué/annulé. Un match que JE publie apparaît ici au
    même titre qu'un autre — c'est exactement ce que l'écran de confirmation
    de Créer un match promet déjà à l'écran. */
export function openMatches(state: StoreState): FeedEntry[] {
  return Object.values(state.matches)
    .filter((e) => e.match.visibility === 'OPEN')
    .filter((e) => e.match.status === 'OPEN' || e.match.status === 'FULL' || e.match.status === 'LOCKED')
    .sort((a, b) => a.match.range.start - b.match.range.start)
    .map((e) => ({ match: e.match, players: e.players }));
}

/* --- Créneaux occupés (Booking + Réservation) --------------------------------
   `blockersFor` remplace le patron « chaque écran garde son propre
   Record<jour, Blocker[]> figé au montage » — Booking et Créer un match lisent
   désormais la MÊME disponibilité, dérivée du même état partagé.

   Lot 3C, P0 (audit du 31/08/2026, §4) : `INITIAL_BOOKINGS` (bookingDemo.ts)
   et `BOOKING_B` (matchDemo.ts) étaient injectés ici EN PERMANENCE, pour
   TOUS les utilisateurs — un créneau vendredi 18h-19h30 (BOOKING_B) et trois
   créneaux mock supplémentaires restaient bloqués à vie dans ce calcul, sans
   jamais pouvoir être "consommés" avec de vrais ids serveur. Retiré : cette
   fonction ne dérive plus QUE de state.matches/state.reservations, tous deux
   réels (GET /matches, /me/matches, /me/bookings). `INITIAL_BOOKINGS` reste
   légitimement utilisée ailleurs (ChallengesFlow.tsx, écran encore
   volontairement mock derrière TEAMS_CHALLENGES_ENABLED=false) — sa
   définition n'est pas supprimée, seul CE point de contamination l'est.
   `BOOKING_B`, elle, n'avait plus AUCUN autre usage réel depuis que la carte
   de raccourci démo de CreateMatchFlow a été retirée (Lot 3B étape 3) —
   supprimée de matchDemo.ts. Limite résiduelle assumée : `state.reservations`
   ne porte que MES réservations (GET /me/bookings), pas celles des autres
   joueurs sur ce terrain — le badge "créneaux dispo" d'Explorer reste donc
   une approximation honnête (jamais un chiffre mock), pas une garantie
   d'exhaustivité multi-utilisateur ; la vérité exhaustive reste
   GET /fields/:fieldId/availability, déjà utilisée par Réservation/Créer
   un match (Lot 3B étape 4). */

function rangeToBlocker(range: TimeRange, label: string): Blocker {
  return { startMin: epochMinutesOfDay(range.start), endMin: epochMinutesOfDay(range.end), label };
}

export function blockersFor(state: StoreState, weekday: number): Blocker[] {
  const fromMatches = Object.values(state.matches)
    .filter((e) => e.match.status !== 'CANCELLED')
    .filter((e) => new Date(e.match.range.start).getDay() === weekday)
    .map((e) => rangeToBlocker(e.match.range, 'réservé'));
  const fromReservations = state.reservations
    .filter((r) => isBlocking(r.booking))
    .filter((r) => new Date(r.booking.range.start).getDay() === weekday)
    .map((r) => rangeToBlocker(r.booking.range, 'réservé'));
  return [...fromMatches, ...fromReservations];
}

/** Engagements réels du joueur pour SCHEDULE_CONFLICT (core) — tous les
    matchs où je suis engagé + toutes mes réservations bloquantes, en excluant
    le match qu'on est en train de rejoindre (pas de faux conflit avec
    soi-même après une désinscription). */
function commitmentRanges(state: StoreState, excludingMatchId: string): TimeRange[] {
  const matchRanges = Object.values(state.matches)
    .filter((e) => e.match.id !== excludingMatchId && isUpcomingStatus(e.match.status) && isMine(e))
    .map((e) => e.match.range);
  const reservationRanges = state.reservations
    .filter((r) => isBlocking(r.booking) && r.booking.matchId !== excludingMatchId)
    .map((r) => r.booking.range);
  return [...matchRanges, ...reservationRanges];
}

export function isBookingConsumed(state: StoreState, bookingId: string): boolean {
  return Boolean(state.consumedBookingIds[bookingId]);
}

/* --- Aides internes ---------------------------------------------------------- */

function notFound(): RuleResult {
  return fail('FORBIDDEN', 'Match introuvable.');
}

function putMatch(state: StoreState, matchId: string, match: Match, players: MatchPlayer[]): StoreState {
  return { ...state, matches: { ...state.matches, [matchId]: { match, players } } };
}

function upsertReservation(reservations: MyReservation[], booking: Booking, format?: MatchFormat, reference?: string): MyReservation[] {
  const idx = reservations.findIndex((r) => r.booking.id === booking.id);
  // La référence connue survit à une mise à jour qui ne la répète pas (ex. applyCreateMatch, qui ne relie que le match).
  const ref = reference ?? (idx === -1 ? undefined : reservations[idx]!.reference);
  const entry: MyReservation = { booking, ...(format !== undefined ? { format } : {}), ...(ref !== undefined ? { reference: ref } : {}) };
  if (idx === -1) return [...reservations, entry];
  const next = [...reservations];
  next[idx] = entry;
  return next;
}

/* --- Actions match ------------------------------------------------------------ */

export function applyJoinMatch(state: StoreState, matchId: string, now: number): { state: StoreState; result: RuleResult } {
  const entry = state.matches[matchId];
  if (!entry) return { state, result: notFound() };
  const commitments = commitmentRanges(state, matchId);
  const mut = coreJoinMatch(entry.match, entry.players, CURRENT_USER_ID, commitments, now);
  if (!mut.result.ok || !mut.players) return { state, result: mut.result };
  const nextMatch: Match = { ...entry.match, status: mut.status ?? entry.match.status };
  return { state: putMatch(state, matchId, nextMatch, mut.players), result: mut.result };
}

export function applyLeaveMatch(state: StoreState, matchId: string, now: number): { state: StoreState; result: RuleResult } {
  const entry = state.matches[matchId];
  if (!entry) return { state, result: notFound() };
  const mut = coreLeaveMatch(entry.match, entry.players, CURRENT_USER_ID, now);
  if (!mut.result.ok || !mut.players) return { state, result: mut.result };
  const nextMatch: Match = { ...entry.match, status: mut.status ?? entry.match.status };
  return { state: putMatch(state, matchId, nextMatch, mut.players), result: mut.result };
}

/** Ferme les inscriptions. Pas de réouverture : décision produit (Lot 2, §13) —
    le core n'offre aucune transition LOCKED → OPEN/FULL, garder un bouton qui
    ne peut jamais réussir n'a pas de sens. Retiré côté UI (OrganizerMatchView),
    pas remplacé ici. */
export function applyCloseRegistrations(state: StoreState, matchId: string, now: number): { state: StoreState; result: RuleResult } {
  const entry = state.matches[matchId];
  if (!entry) return { state, result: notFound() };
  const check = canOrganizerAct(entry.match, CURRENT_USER_ID, 'CLOSE_REGISTRATIONS', now);
  if (!check.ok) return { state, result: check };
  if (!canTransition(MATCH_TRANSITIONS, entry.match.status, 'LOCKED')) {
    return { state, result: fail('INVALID_TRANSITION', 'Ce match ne peut pas être verrouillé dans son état actuel.') };
  }
  const nextMatch: Match = { ...entry.match, status: 'LOCKED' };
  return { state: putMatch(state, matchId, nextMatch, entry.players), result: ok };
}

/** Annule le match ET notifie réellement les joueurs inscrits (Lot 2, §12) —
    MATCH_CANCELLED, core.notify()/RECIPIENTS.matchCancelled (jamais
    l'organisateur lui-même). Le toast affiché par OrganizerMatchView
    ("les joueurs inscrits sont notifiés") n'était pas vrai avant ce
    câblage — il l'est maintenant. */
export function applyCancelMatch(state: StoreState, matchId: string, now: number): { state: StoreState; result: RuleResult } {
  const entry = state.matches[matchId];
  if (!entry) return { state, result: notFound() };
  const check = canOrganizerAct(entry.match, CURRENT_USER_ID, 'CANCEL_MATCH', now);
  if (!check.ok) return { state, result: check };
  const nextMatch: Match = { ...entry.match, status: 'CANCELLED' };
  const joinedIds = activePlayers(entry.players).map((p) => p.userId);
  const recipients = RECIPIENTS.matchCancelled(joinedIds, CURRENT_USER_ID);
  const nextNotifications = recipients.length > 0
    ? [...state.notifications, ...notify(recipients, 'MATCH_CANCELLED', matchId, now)]
    : state.notifications;
  const next = putMatch(state, matchId, nextMatch, entry.players);
  return { state: { ...next, notifications: nextNotifications }, result: ok };
}

/** Exclure un joueur — disponible OPEN/FULL/LOCKED, jusqu'au coup d'envoi
    (Lot 2, §14 : le core l'autorise déjà via canOrganizerAct, l'UI ne doit
    pas être plus restrictive que la règle qu'elle applique). Propage le
    statut dérivé (mut.status) en plus du roster — libérer une place sur un
    match FULL doit le faire redevenir OPEN partout, pas seulement dans le
    compteur de joueurs. */
export function applyKickPlayer(state: StoreState, matchId: string, targetId: string, now: number): { state: StoreState; result: RuleResult } {
  const entry = state.matches[matchId];
  if (!entry) return { state, result: notFound() };
  const mut = coreRemovePlayer(entry.match, entry.players, CURRENT_USER_ID, targetId, now);
  if (!mut.result.ok || !mut.players) return { state, result: mut.result };
  const nextMatch: Match = { ...entry.match, status: mut.status ?? entry.match.status };
  return { state: putMatch(state, matchId, nextMatch, mut.players), result: mut.result };
}

/* --- Publication d'un match (Créer un match) ----------------------------------- */

export interface PublishMatchInput {
  id: string;
  booking: Booking;
  field: Pick<Field, 'id' | 'sport' | 'formats'>;
  venueId: string;
  title: string;
  description?: string | undefined;
  format: MatchFormat;
  level: SkillLevel;
  capacity: number;
  visibility: 'OPEN' | 'PRIVATE';
  now: number;
}

/** Publie un match ET le fait réellement rejoindre la carte partagée (Lot 2,
    §6) — Home/Explorer/Mes matchs le voient dès la prochaine lecture, plus
    besoin qu'un écran de confirmation promette une visibilité qu'il ne
    tenait pas. Marque aussi la réservation consommée (§10) : impossible de
    publier deux fois un match sur la même réservation (id réel serveur). */
export function applyPublishMatch(state: StoreState, input: PublishMatchInput): { state: StoreState; result: RuleResult; match?: Match } {
  if (state.consumedBookingIds[input.booking.id]) {
    return { state, result: fail('BOOKING_HAS_MATCH', 'Un match existe déjà sur cette réservation.') };
  }
  const { result, match, organizerEntry } = coreCreateMatch({
    id: input.id, booking: input.booking, field: input.field, venueId: input.venueId,
    title: input.title, description: input.description, format: input.format, level: input.level,
    capacity: input.capacity, visibility: input.visibility, organizerId: CURRENT_USER_ID, now: input.now,
  });
  if (!result.ok || !match || !organizerEntry) return { state, result };
  const nextMatches = { ...state.matches, [match.id]: { match, players: [organizerEntry] } };
  const nextConsumed = { ...state.consumedBookingIds, [input.booking.id]: true as const };
  const linkedBooking: Booking = { ...input.booking, matchId: match.id };
  const nextReservations = upsertReservation(state.reservations, linkedBooking, input.format);
  return {
    state: { ...state, matches: nextMatches, consumedBookingIds: nextConsumed, reservations: nextReservations },
    result, match,
  };
}

/* --- Réservations (Réserver un terrain, déclarer par téléphone) --------------- */

/** Prochain numéro de séquence pour `core.bookingReference()` — un seul
    compteur partagé (Lot 2, passe de validation §5) : avant, chaque
    remontage de BookingFlow repartait de 481, donc une deuxième réservation
    faite dans une deuxième visite du même écran générait la MÊME référence
    que la première (ex. "COM-0482" les deux fois) et l'écrasait
    silencieusement dans `reservations` (upsert par id). */
export function applyNextBookingSeq(state: StoreState): { state: StoreState; seq: number } {
  const seq = state.bookingSeq + 1;
  return { state: { ...state, bookingSeq: seq }, seq };
}

/** Enregistre une réservation confirmée dans la liste partagée — visible
    immédiatement dans Mes réservations (Lot 2, §2) et dans blockersFor()
    pour tout écran qui affiche la grille de créneaux. */
export function applyRegisterBooking(state: StoreState, booking: Booking, format?: MatchFormat, reference?: string): StoreState {
  return { ...state, reservations: upsertReservation(state.reservations, booking, format, reference) };
}

/** Un match vient d'être publié sur MA réservation (POST /matches) : le lien `booking.matchId` est posé dans la liste
    partagée, comme le serveur l'a fait en base — sans lui, Mes réservations proposait encore « Créer un match » sur une
    réservation qui en avait déjà un, et l'annulation locale ne savait pas quel match venait de tomber avec elle
    (trouvé en vérification live, BUG-8, 26/09/2026). Réservation inconnue localement : rien à faire. */
export function applyLinkReservationToMatch(state: StoreState, bookingId: string, matchId: string): StoreState {
  const idx = state.reservations.findIndex((r) => r.booking.id === bookingId);
  if (idx === -1) return state;
  const next = [...state.reservations];
  next[idx] = { ...next[idx]!, booking: { ...next[idx]!.booking, matchId } };
  return { ...state, reservations: next };
}

export function applyCancelBooking(state: StoreState, bookingId: string, now: number): { state: StoreState; result: RuleResult } {
  const idx = state.reservations.findIndex((r) => r.booking.id === bookingId);
  if (idx === -1) return { state, result: notFound() };
  const current = state.reservations[idx]!;
  const check = canCancelBooking(current.booking, now);
  if (!check.ok) return { state, result: check };
  const next = [...state.reservations];
  next[idx] = { ...current, booking: { ...current.booking, status: 'CANCELLED' } };
  return { state: { ...state, reservations: next }, result: ok };
}

/* --- Notation ------------------------------------------------------------------ */

export function applyRateMatch(state: StoreState, rating: Rating): StoreState {
  return { ...state, ratings: coreApplyRating(state.ratings, rating) };
}

/* --- Identité (onboarding) ------------------------------------------------------ */

export function applySetIdentity(state: StoreState, identity: Identity): StoreState {
  return { ...state, identity };
}

/* --- Session (Lot 3B) ------------------------------------------------------ */

export function applySetToken(state: StoreState, token: string | null): StoreState {
  return { ...state, token };
}

/* --- Lectures serveur (Lot 3B, étape 2) ------------------------------------
   Remplacent entièrement la carte/liste correspondante — jamais un merge
   avec les données de démo : une fois connecté, l'écran doit montrer la
   vérité serveur, y compris quand elle est honnêtement vide (un nouveau
   compte n'a réellement aucun match), pas un mélange réel+fictif. */

export function applyReplaceMatches(state: StoreState, records: readonly MatchRecord[]): StoreState {
  const matches: Record<string, MatchRecord> = {};
  for (const r of records) matches[r.match.id] = r;
  return { ...state, matches };
}

export function applyReplaceReservations(state: StoreState, reservations: readonly MyReservation[]): StoreState {
  return { ...state, reservations: [...reservations] };
}

export function applyReplaceNotifications(state: StoreState, notifications: readonly Notification[]): StoreState {
  return { ...state, notifications: [...notifications] };
}

export function applySetMe(state: StoreState, me: StoreState['me']): StoreState {
  return { ...state, me };
}

export function applySetProfile(state: StoreState, profile: StoreState['profile']): StoreState {
  return { ...state, profile };
}

export function applySetVenue(state: StoreState, venue: VenueDetail | null): StoreState {
  return { ...state, venue };
}

export function applySetVenues(state: StoreState, venues: VenueSummary[]): StoreState {
  return { ...state, venues };
}

/* --- Résolution centre/terrain par identifiant (A8) ---------------------------
   Un match, une réservation ou une notification porte un venueId/fieldId : le nom à afficher se lit d'après
   CET id, jamais d'après « le centre courant » (faux dès que l'app connaît plusieurs centres). Source : la
   liste des centres, puis la fiche ouverte (qui couvre un centre pas — ou plus — listé). */

export function venueSummaryOf(state: StoreState, venueId: string): VenueSummary | undefined {
  return state.venues.find((v) => v.id === venueId);
}

/** Nom du centre ; « Centre » seulement si l'id est inconnu (centre suspendu depuis, liste pas chargée). */
export function venueNameOf(state: StoreState, venueId: string): string {
  return venueSummaryOf(state, venueId)?.name ?? (state.venue?.id === venueId ? state.venue.name : 'Centre');
}

export interface FieldInfo { venueId: string; venueName: string; field: VenueSummary['fields'][number] }

export function fieldInfoOf(state: StoreState, fieldId: string): FieldInfo | undefined {
  for (const v of state.venues) {
    const field = v.fields.find((f) => f.id === fieldId);
    if (field) return { venueId: v.id, venueName: v.name, field };
  }
  const open = state.venue;
  const field = open?.fields.find((f) => f.id === fieldId);
  return open && field ? { venueId: open.id, venueName: open.name, field } : undefined;
}

export function applySetMatchResults(state: StoreState, results: Record<string, MatchResult>): StoreState {
  return { ...state, matchResults: { ...state.matchResults, ...results } };
}

/** Matchs PLAYED réellement joués par moi (organisateur ou inscrit), avec
    leur résultat s'il est déjà chargé (state.matchResults) — équivalent réel
    de l'ancien PastEntry (matchesFeedDemo.ts), utilisé par Historique et
    l'aperçu du Profil.

    Lot 3C, P0 (score) : un match PLAYED dont le résultat n'est PAS encore
    saisi n'est plus omis — avant ce correctif, un match qui vient d'être
    joué mais n'a pas encore de score devenait invisible PARTOUT (déjà exclu
    de myUpcoming() dès qu'il quitte le statut "à venir", et ici caché tant
    qu'aucun score n'existe) : aucun écran ne permettait à l'organisateur de
    même DÉCOUVRIR qu'un match attend sa saisie, rendant l'action de
    saisie du score ajoutée dans ce lot inatteignable en pratique. */
export interface RealPastEntry { match: Match; players: MatchPlayer[]; result: MatchResult | undefined }

export function myPastEntries(state: StoreState): RealPastEntry[] {
  return Object.values(state.matches)
    .filter((e) => e.match.status === 'PLAYED' && isMine(e))
    .map((e) => ({ match: e.match, players: e.players, result: state.matchResults[e.match.id] }))
    .sort((a, b) => b.match.range.start - a.match.range.start);
}

/* --- Mutations réelles (Lot 3B, étape 3) ------------------------------------
   Ces fonctions restent pures (aucun appel réseau ici, comme le reste du
   fichier) : elles reçoivent le résultat DÉJÀ obtenu du serveur (réponse
   HTTP mappée) et l'appliquent à l'état local — c'est useAppStore.ts qui
   fait l'appel réseau, jamais store.ts. La règle « la réponse serveur
   devient la vérité » se traduit ici par : on n'écrit jamais AVANT d'avoir
   la réponse, ces fonctions ne sont appelées qu'une fois le serveur confirmé. */

/** Insère/remplace UN SEUL match — après une création réelle, un join/leave
    (roster+statut retrouvés via un re-fetch GET /matches/:id), ou un
    changement de statut confirmé (verrouillage, annulation). Jamais un
    remplacement de la carte entière (`applyReplaceMatches`, étape 2) : ici
    on ne touche que ce qui vient d'être confirmé, le reste de la carte
    (potentiellement plus rafraîchi) reste intact. */
export function applyUpsertMatch(state: StoreState, record: MatchRecord): StoreState {
  return { ...state, matches: { ...state.matches, [record.match.id]: record } };
}

/** Fusionne des noms réels dans l'annuaire (GET /matches/:id, roster
    nominatif) — jamais un remplacement, un id déjà connu par ailleurs
    (ex. moi-même) doit pouvoir cohabiter avec des ids nouvellement résolus. */
export function applyMergePlayerNames(state: StoreState, names: Record<string, string>): StoreState {
  return { ...state, playerNames: { ...state.playerNames, ...names } };
}

/** Patch minimal du statut d'UNE réservation après confirmation serveur
    (annulation) — pas un recalcul local de la règle (canCancelBooking a déjà
    tranché côté serveur), juste l'écho de ce que le serveur vient de
    confirmer avoir fait. */
export function applyPatchBookingStatus(state: StoreState, bookingId: string, status: Booking['status']): StoreState {
  return {
    ...state,
    reservations: state.reservations.map((r) => r.booking.id === bookingId ? { ...r, booking: { ...r.booking, status } } : r),
  };
}
