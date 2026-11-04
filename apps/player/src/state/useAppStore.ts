import { useEffect, useRef, useState } from 'react';
import type { Booking, Match, MatchFormat, MatchPlayer, MatchResult, MatchStatus, MatchTeam, Notification, Rating, SkillLevel, Sport } from '@moubarat/core';
import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import {
  initialState, findMatch, myUpcoming, myMatches, openMatches, blockersFor, isBookingConsumed, myPastEntries,
  applyRegisterBooking, applyRateMatch, applySetIdentity,
  applyNextBookingSeq, applySetToken, applySetMe, applySetProfile, applyReplaceMatches,
  applyReplaceReservations, applyReplaceNotifications, applySetMatchResults, applySetVenue, applySetVenues,
  venueNameOf, venueSummaryOf, fieldInfoOf, type VenueDetail, type VenueSummary,
  applyUpsertMatch, applyMergePlayerNames, applyPatchBookingStatus, applyLinkReservationToMatch,
  type StoreState, type Identity, type MatchRecord,
} from './store.js';
import { loadToken, saveToken, clearToken, loadPrefs, savePrefs, clearPrefs, saveAuthNotice } from '../lib/session.js';
import { loadPushToken, savePushToken, clearPushToken } from '../lib/native.js';
import { fetchMatchPreview } from '../lib/matchPreview.js';
import type { MatchContact } from '../lib/contacts.js';
import type { ProfileSummary } from '../lib/profileView.js';
import type { NotificationSettings } from '../lib/notificationSettings.js';
import type { Claim } from '../lib/claimView.js';
import { apiFetch, setUnauthorizedHandler, ApiError, actionResultFromError, type ActionResult } from '../lib/api.js';
import { setCurrentUserId } from '../data/identity.js';
import {
  FEED_PAGE_SIZE, dayCountsQueryString, feedQueryString, feedTotalAllDaysQueryString, mergeById, type FeedParams,
} from '../lib/feedQuery.js';
import {
  matchFromApi, syntheticPlayersFromCount, matchPlayersFromDetail, bookingFromApi,
  notificationFromApi, matchResultFromApi, availabilityStartsFromApi, venueSummaryFromApi,
  friendMatchFromApi,
  type ApiPublicMatch, type ApiBooking, type ApiNotification, type ApiMatchResult,
  type ApiAvailabilityResponse, type AvailabilityStart, type ApiVenueSummary,
  type ApiAvailabilitySummary, type VenueAvailability, type ApiFriendMatch, type FriendMatchEntry,
} from '../lib/mappers.js';

interface MeResponse {
  user: { id: string; name: string; phone: string; role: string };
  needsLegalConsent: boolean; needsNameChange?: boolean;
  /** Règles 28-30 (24/10/2026) : pseudo/mot de passe/nouveaux accords pas encore posés. */
  needsAccessSetup?: boolean;
  /** Ville choisie à l'onboarding (règle 34 — déjà servie par /auth/me, jamais lue côté app avant
      le lot 4b : « ville du joueur » des règles 11/33). */
  profile?: { city: string | null };
}
interface OvrResponse { ovr: number | null; explanation: string; inputs: { matchesPlayed: number } }
interface RatingResponse { avg: number | null; count: number; visible: boolean }
type ApiMatchWithRoster = ApiPublicMatch & { joinedCount: number; viewerJoined: boolean; viewerTeam?: 'A' | 'B' | null };

/* Pagination par curseur (mise à l'échelle L3, 25/09/2026 — contrat côté API : apps/api/src/lib/cursor.ts). Chaque liste
   servie par page renvoie `nextCursor` (`null` = dernière page) ; `limit` absent = l'ancien plafond, donc le chargement
   initial ci-dessous ne change pas — seul « Afficher plus » demande la suite. */
export type PagedList = 'notifications' | 'reservations' | 'myMatches';
type PageCursors = Record<PagedList, string | null>;
const NO_CURSORS: PageCursors = { notifications: null, reservations: null, myMatches: null };
/** Taille d'une page demandée par « Afficher plus » (les listes du joueur : notifications, réservations, matchs). */
const LIST_PAGE_SIZE = 30;

/** Fil des matchs de l'Explorer (filtres côté serveur) : les identifiants dans l'ordre reçu — les matchs eux-mêmes
    vivent dans `state.matches`, une seule source. */
interface FeedState {
  ids: string[];
  nextCursor: string | null;
  /** Nombre de matchs correspondant aux filtres (première page seulement) ; `null` = pas encore lu. */
  total: number | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  loadingMore: boolean;
}
const EMPTY_FEED: FeedState = { ids: [], nextCursor: null, total: null, status: 'idle', error: null, loadingMore: false };

function recordFromApi(w: ApiMatchWithRoster, meId: string, now: number): MatchRecord {
  return { match: matchFromApi(w), players: syntheticPlayersFromCount(w.id, w.joinedCount, w.viewerJoined, meId, now, w.viewerTeam), code: w.code ?? undefined };
}
type ApiPlayerNamed = { userId: string; name: string; joinedAt: number; team?: 'A' | 'B' | null };
type ApiMatchWithPlayers = ApiPublicMatch & { players: ApiPlayerNamed[] };

/** Résultat d'une résolution "qui suis-je + toutes mes données de lecture" —
    un seul objet composé en un seul `setState`, pour ne jamais laisser
    React re-rendre entre deux morceaux partiels (Lot 3B, étape 2). */
interface Bootstrapped {
  me: MeResponse['user'];
  /* C7 (audit produit 21/09/2026) : compte déjà existant (créé avant ce lot, ou dont la version
     acceptée des CGU/confidentialité a changé) — App.tsx affiche LegalConsentGate avant le Home
     tant que ce n'est pas résolu, jamais un accès silencieux. */
  needsLegalConsent: boolean;
  /* Unicité du nom d'affichage (25/09/2026) : doublon hérité d'avant la règle — le compte garde son nom jusqu'à ce que le
     joueur en choisisse un autre ; App.tsx affiche NameChangeGate (même mécanique que le consentement). */
  needsNameChange: boolean;
  /* Règles 28-30 (24/10/2026) : pseudo/mot de passe/nouveaux accords pas encore posés
     (password_hash NULL) — App.tsx affiche AccessSetupGate, même mécanique. */
  needsAccessSetup: boolean;
  identity: Identity;
  matches: MatchRecord[];
  reservations: { booking: Booking; format?: MatchFormat; reference?: string }[];
  notifications: Notification[];
  profile: NonNullable<StoreState['profile']>;
  matchResults: Record<string, MatchResult>;
  ratings: Rating[];
  /** Lot P1, point 3 — GET /venues/:id ; `null` si l'appel a échoué. */
  venue: VenueDetail | null;
  /** A8 — GET /venues (tous les centres actifs) ; `null` si l'appel a échoué (≠ liste vide : « aucun centre »). */
  venues: VenueSummary[] | null;
  /** L3 — curseurs de la page SUIVANTE de chaque liste du joueur (`null` = rien de plus à charger). */
  cursors: PageCursors;
}

/** Un seul aller-retour /auth/me (déjà nécessaire pour valider le jeton),
    puis toutes les lectures de la V1 en parallèle (Lot 3B, étape 2 — ordre
    de priorité d'Aymen : profil, matchs, réservations, notifications).
    Chaque lecture échoue indépendamment sans faire tomber les autres —
    repli sur les données de démo existantes plutôt qu'un écran cassé (voir
    le rapport de fin d'étape pour la liste des écarts connus). */
async function loadEverything(token: string): Promise<Bootstrapped> {
  const meRes = await apiFetch<MeResponse>('/auth/me', { token });
  const me = meRes.user;
  setCurrentUserId(me.id);
  const prefs = loadPrefs();
  const identity: Identity = { name: me.name, sport: prefs.sport, level: prefs.level, city: meRes.profile?.city ?? null };

  // Centres (A7 puis A8, cadrage multi-centre/scalabilité) : TOUS les centres actifs (GET /venues, pour
  // l'Explorer et la résolution des noms), et la fiche complète (GET /venues/:id) du centre OUVERT — par
  // défaut le premier de la liste ; l'Explorer en ouvre un autre (`selectVenue`). Le choix du terrain/
  // sport/format se fait dynamiquement à l'écran, à partir de `store.venue` (lib/venueCatalog.ts), jamais
  // capturé une fois pour toutes au démarrage.
  let venueDetail: VenueDetail | null = null;
  let venues: VenueSummary[] | null = null;
  try {
    const venuesRes = await apiFetch<{ venues: ApiVenueSummary[] }>('/venues');
    venues = venuesRes.venues.map(venueSummaryFromApi);
    const venue = venues[0];
    if (venue) {
      // Lot P1, point 3 : la fiche complète (description, équipements,
      // horaires, note) — la liste /venues ne porte ni horaires ni note.
      // Échec ici = fiche `null` (absence honnête à l'écran), pas une
      // retombée silencieuse sur data/venues.ts.
      try {
        venueDetail = (await apiFetch<{ venue: VenueDetail }>(`/venues/${venue.id}`)).venue;
      } catch (e) {
        console.error(`GET /venues/${venue.id}`, e);
      }
    }
  } catch (e) {
    console.error('GET /venues', e);
  }

  const [openRes, mineRes, bookingsRes, notifRes, ovrRes, ratingRes] = await Promise.all([
    apiFetch<{ matches: ApiMatchWithRoster[] }>('/matches', { token })
      .catch((e) => { console.error('GET /matches', e); return null; }),
    apiFetch<{ matches: ApiMatchWithRoster[]; nextCursor: string | null }>('/me/matches', { token })
      .catch((e) => { console.error('GET /me/matches', e); return null; }),
    apiFetch<{ bookings: ApiBooking[]; nextCursor: string | null }>('/me/bookings', { token })
      .catch((e) => { console.error('GET /me/bookings', e); return null; }),
    apiFetch<{ notifications: ApiNotification[]; nextCursor: string | null }>('/me/notifications', { token })
      .catch((e) => { console.error('GET /me/notifications', e); return null; }),
    apiFetch<OvrResponse>('/me/ovr', { token })
      .catch((e) => { console.error('GET /me/ovr', e); return null; }),
    apiFetch<RatingResponse>(`/users/${me.id}/rating`, { token })
      .catch((e) => { console.error('GET /users/:id/rating', e); return null; }),
  ]);

  const now = Date.now();
  const byId = new Map<string, MatchRecord>();
  for (const w of [...(openRes?.matches ?? []), ...(mineRes?.matches ?? [])]) {
    byId.set(w.id, recordFromApi(w, me.id, now));
  }
  const matches = [...byId.values()];

  const reservations = (bookingsRes?.bookings ?? []).map((w) => ({
    booking: bookingFromApi(w, me.id),
    ...(w.format !== null ? { format: w.format as MatchFormat } : {}),
    ...(w.reference ? { reference: w.reference } : {}),
  }));
  const notifications = (notifRes?.notifications ?? []).map(notificationFromApi);

  const profile: NonNullable<StoreState['profile']> = {
    ovr: ovrRes?.ovr ?? null,
    ovrExplanation: ovrRes?.explanation ?? '',
    matchesPlayed: ovrRes?.inputs.matchesPlayed ?? 0,
    ratingAvg: ratingRes?.avg ?? null,
    ratingCount: ratingRes?.count ?? 0,
    ratingVisible: ratingRes?.visible ?? false,
  };

  // Résultats + MA note (si posée) des matchs PLAYED dont je suis organisateur/inscrit — UN seul
  // appel en lot (F3, cadrage multi-centre/scalabilité 22/09/2026 : avant, un aller-retour par match
  // PAR type de donnée, jusqu'à 100+ requêtes pour un joueur de 50 matchs — voir
  // apps/api/src/modules/results/routes.ts GET /me/match-results). Sans lui, une note fraîchement
  // soumise disparaîtrait de l'écran au moindre refresh (toujours vrai, juste plus un aller-retour).
  const matchResults: Record<string, MatchResult> = {};
  let ratings: Rating[] = [];
  try {
    const res = await apiFetch<{ results: Record<string, ApiMatchResult>; ratings: Record<string, Rating> }>(
      '/me/match-results', { token },
    );
    for (const [id, r] of Object.entries(res.results)) matchResults[id] = matchResultFromApi(r);
    ratings = Object.values(res.ratings);
  } catch (e) {
    console.error('GET /me/match-results', e);
  }

  return {
    me, needsLegalConsent: meRes.needsLegalConsent, needsNameChange: meRes.needsNameChange === true,
    needsAccessSetup: meRes.needsAccessSetup === true, identity, matches, reservations, notifications,
    profile, matchResults, ratings, venue: venueDetail, venues,
    cursors: {
      notifications: notifRes?.nextCursor ?? null,
      reservations: bookingsRes?.nextCursor ?? null,
      myMatches: mineRes?.nextCursor ?? null,
    },
  };
}

/** Recharge UN match avec son roster nominatif réel (GET /matches/:id) —
    seule route qui renvoie des noms, jamais les listes (Lot 3B, étape 3
    point 5 : "roster nominatif réel"). Retourne aussi le dictionnaire de
    noms à fusionner (state.playerNames) séparément du MatchRecord, puisque
    MatchPlayer (core) n'a pas de champ `name`. */
async function fetchMatchDetail(token: string | null, matchId: string): Promise<{ record: MatchRecord; names: Record<string, string> }> {
  const res = await apiFetch<{ match: ApiMatchWithPlayers }>(`/matches/${matchId}`, { token });
  const players = matchPlayersFromDetail(matchId, res.match.players);
  const names: Record<string, string> = {};
  for (const p of res.match.players) names[p.userId] = p.name;
  return { record: { match: matchFromApi(res.match), players, code: res.match.code ?? undefined }, names };
}

/** Seul point de contact entre React et l'état partagé (store.ts, logique pure
    testable sans React) — App.tsx appelle ce hook une fois et distribue le
    résultat aux écrans, comme il le faisait déjà pour `notifications` seul.

    Lot 3B : socle auth/session, puis lectures (étape 2), puis mutations
    réelles (étape 3) — chaque action métier fait maintenant un aller-retour
    réseau réel ; la réponse serveur (ou un re-fetch ciblé de la ressource
    concernée) devient la source de vérité, jamais une reconstruction locale
    optimiste. */
export function useAppStore() {
  const [state, setState] = useState<StoreState>(() => ({ ...initialState(), token: loadToken() }));
  /* Vrai le temps de la résolution complète (identité + toutes les lectures)
     — App.tsx s'en sert pour ne rien afficher tant que l'app n'a pas de
     vérité serveur cohérente à montrer, que ce soit au chargement (jeton
     déjà en local) ou juste après une connexion réussie (voir `login`). */
  const [bootstrapping, setBootstrapping] = useState<boolean>(() => loadToken() !== null);
  /** Lot 3C, P0 §3 : le chargement initial a échoué SANS que la session soit
      réellement invalide (réseau coupé, API injoignable, 5xx) — distinct de
      `null`. App.tsx s'en sert pour montrer un état honnête « impossible de
      contacter le serveur » avec un vrai bouton réessayer, plutôt que de
      laisser tomber le rendu sur le Home (qui afficherait alors les données
      de démo utilisées pour amorcer initialState() — matchs/réservations
      FICTIFS présentés comme réels, exactement ce que l'app ne doit jamais
      faire) ou, pire, déconnecter un utilisateur dont la session était en
      fait toujours valide. */
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  /* C7 (audit produit 21/09/2026) : volontairement HORS de StoreState (pas besoin de reducer testable
     pour un simple booléen posé par le bootstrap et remis à zéro par une seule action serveur). */
  const [needsLegalConsent, setNeedsLegalConsent] = useState(false);
  /* Même raison : un drapeau posé par le bootstrap, remis à zéro par une seule action serveur (PATCH /me). */
  const [needsNameChange, setNeedsNameChange] = useState(false);
  /* Même raison : un drapeau posé par le bootstrap, remis à zéro par POST /me/access-setup. */
  const [needsAccessSetup, setNeedsAccessSetup] = useState(false);
  /* A8 : la liste des centres n'a pas pu être lue (réseau/5xx) — distinct d'une liste VIDE (« aucun centre
     partenaire ») : l'Explorer propose alors « Réessayer » au lieu d'affirmer qu'il n'y a rien. Hors
     StoreState pour la même raison que `needsLegalConsent` (un simple drapeau posé par une lecture). */
  const [venuesError, setVenuesError] = useState(false);
  /* A8 : ce qu'il reste à jouer aujourd'hui par centre (GET /venues/availability-summary) — chargé à
     l'ouverture de l'Explorer › Terrains, jamais au démarrage (une donnée qui vieillit vite, que seul cet
     écran affiche). `null` tant que pas lu ou en échec : les cartes omettent alors l'indication plutôt que
     d'afficher « 0 créneau » à tort. */
  const [venueAvailability, setVenueAvailability] = useState<Record<string, VenueAvailability> | null>(null);
  /* Lot 4b, règle 11 point 5 — « Tes amis jouent bientôt » (GET /me/friends-matches) : chargé par
     HomeScreen à l'affichage, jamais au bootstrap (lecture seule secondaire, hors core). `[]` tant que
     pas lu ou en échec : la section se cache alors, honnête, jamais une fausse liste vide affichée
     comme "aucun ami ne joue". */
  const [friendsMatches, setFriendsMatches] = useState<FriendMatchEntry[]>([]);
  /* Lot 10 — le résumé du Profil (GET /me/profile-summary) : chargé à l'ouverture de Profil, de Modifier le profil et de Mes accords ; `null` tant que pas lu. */
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  /* L3 (25/09/2026) : « Afficher plus » — curseur de la page suivante de chaque liste du joueur, et la liste en train
     de se charger (un seul chargement à la fois par liste : un double appui ne double rien). Hors StoreState : un simple
     état de pagination posé par les lectures. */
  const [cursors, setCursors] = useState<PageCursors>(NO_CURSORS);
  const [loadingMore, setLoadingMore] = useState<Record<PagedList, boolean>>({ notifications: false, reservations: false, myMatches: false });
  /* L3 : le fil de l'Explorer › Matchs (filtres côté serveur, curseur). `feedRequest` numérote les requêtes : la réponse
     d'un filtre déjà remplacé par un autre (frappe rapide, changement de jour) est jetée, jamais affichée. */
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
  const feedRequest = useRef(0);
  const feedParams = useRef<FeedParams | null>(null);
  /** Compteur de la pastille « Tous » quand un jour précis est choisi (le `total` de la page ne compte que ce jour). */
  const [feedTotalAllDays, setFeedTotalAllDays] = useState<number | null>(null);
  /** Nombre de matchs du fil par jour (bandeau de jours) : `null` tant que non lu ou en échec — jamais un « 0 » inventé. */
  const [feedDayCounts, setFeedDayCounts] = useState<Record<string, number> | null>(null);

  function applyBootstrapped(b: Bootstrapped) {
    setNeedsLegalConsent(b.needsLegalConsent);
    setNeedsNameChange(b.needsNameChange);
    setNeedsAccessSetup(b.needsAccessSetup);
    setState((s) => {
      let next = applySetMe(s, b.me);
      next = applySetIdentity(next, b.identity);
      next = applyReplaceMatches(next, b.matches);
      next = applyReplaceReservations(next, b.reservations);
      next = applyReplaceNotifications(next, b.notifications);
      next = applySetProfile(next, b.profile);
      next = applySetMatchResults(next, b.matchResults);
      for (const r of b.ratings) next = applyRateMatch(next, r);
      next = applySetVenue(next, b.venue);
      if (b.venues) next = applySetVenues(next, b.venues);
      return next;
    });
    setVenuesError(b.venues === null);
    setCursors(b.cursors);
    setFeed(EMPTY_FEED); // un nouveau chargement initial repart d'un fil vierge
  }

  /** Distingue une session RÉELLEMENT invalide (401 — le serveur a
      explicitement rejeté le jeton) d'un incident réseau/serveur (rien à voir
      avec la validité de la session : connexion coupée, timeout, 5xx). Seul
      le premier cas justifie d'effacer le jeton local — Lot 3C, P0 §3, avant
      ce correctif les deux étaient confondus (`.catch` inconditionnel), une
      simple coupure réseau déconnectait un utilisateur dont la session était
      toujours valide côté serveur. */
  function isRealSessionInvalid(e: unknown): boolean {
    return e instanceof ApiError && e.statusCode === 401;
  }

  function bootstrapErrorMessage(e: unknown): string {
    return e instanceof ApiError ? e.message : 'Connexion impossible. Vérifie ta connexion et réessaie.';
  }

  function runBootstrap(token: string, onSettled?: () => void) {
    let cancelled = false;
    setBootstrapError(null);
    loadEverything(token)
      .then((b) => { if (!cancelled) applyBootstrapped(b); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isRealSessionInvalid(e)) {
          clearToken();
          setState((s) => applySetToken(s, null));
        } else {
          setBootstrapError(bootstrapErrorMessage(e));
        }
      })
      .finally(() => { if (!cancelled) { setBootstrapping(false); onSettled?.(); } });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    const token = loadToken();
    if (!token) { setBootstrapping(false); return; }
    return runBootstrap(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Relance le chargement initial sur le même jeton local — bouton
      « Réessayer » de l'état hors-ligne (App.tsx). N'efface jamais le jeton
      lui-même : seul un vrai 401 pendant CETTE tentative le ferait. */
  function retryBootstrap(): void {
    const token = loadToken();
    if (!token) return;
    setBootstrapping(true);
    runBootstrap(token);
  }

  useEffect(() => {
    // 401 sur n'importe quel appel authentifié en cours de session (jeton
    // expiré/révoqué entre deux actions) — même traitement que l'échec du
    // bootstrap ci-dessus : jamais un état "connecté" que le serveur dément.
    setUnauthorizedHandler((info) => {
      // Compte suspendu (JO7) : le message du serveur est gardé pour l'écran de connexion — jamais une
      // déconnexion muette. Posé AVANT l'effacement du jeton : c'est lui qui déclenche l'écran de connexion.
      if (info.suspended && info.message) saveAuthNotice(info.message);
      clearToken();
      setState((s) => applySetToken(s, null));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const token = state.token;
  const meId = state.me?.id ?? null;

  /** Rejoue un GET /matches/:id après une mutation qui a changé le roster
      (join/leave/kick) — la "re-lecture de la ressource concernée" demandée
      plutôt qu'une reconstruction locale du roster/compteur. */
  async function refreshMatchDetail(matchId: string): Promise<void> {
    const { record, names } = await fetchMatchDetail(token, matchId);
    setState((s) => applyMergePlayerNames(applyUpsertMatch(s, record), names));
  }

  /** Lot 3C, P0 §6 : re-fetch réel de GET /me/notifications — avant ce
      correctif, `state.notifications` n'était rempli qu'UNE SEULE FOIS, au
      bootstrap (`useEffect` à deps `[]`), jamais rejoué ensuite. Un joueur
      qui réserve puis quitte l'app (ou la laisse simplement en arrière-plan,
      cas standard PWA) n'avait alors AUCUN moyen d'apprendre une annulation
      avant de rouvrir complètement l'app — risque opérationnel réel, pas
      seulement "pas de push". Échec silencieux (garde le dernier état connu,
      pas de toast) : un re-fetch en arrière-plan qui échoue ne doit jamais
      interrompre l'utilisateur avec une erreur sur une action qu'il n'a pas
      demandée. */
  async function refreshNotifications(): Promise<void> {
    if (!token) return;
    try {
      const res = await apiFetch<{ notifications: ApiNotification[]; nextCursor: string | null }>('/me/notifications', { token });
      // L3 : FUSION avec ce qui est déjà chargé (les pages « Afficher plus » ne disparaissent pas à chaque reprise
      // d'app) ; le curseur n'est repris de cette première page que si rien de plus ancien n'a été chargé.
      setState((s) => {
        const merged = mergeById(s.notifications, res.notifications.map(notificationFromApi), (n) => n.id)
          .sort((a, b) => b.createdAt - a.createdAt);
        return applyReplaceNotifications(s, merged);
      });
      setCursors((c) => (c.notifications === null ? { ...c, notifications: res.nextCursor } : c));
    } catch (e) { console.error('GET /me/notifications (refresh)', e); }
  }

  useEffect(() => {
    // Deux déclencheurs suffisent pour un re-fetch "suffisamment frais"
    // (Aymen, Lot 3C §6 — pas de polling, pas de push) : revenir sur l'app
    // depuis l'arrière-plan (PWA laissée ouverte, cas standard mobile) et
    // reprendre le focus de l'onglet (bascule d'app sur desktop/navigateur).
    // Les DEUX event listeners sont nécessaires : `visibilitychange` ne se
    // déclenche pas toujours de façon fiable sur tous les navigateurs mobiles
    // à la reprise, `focus` couvre ce cas en plus.
    function onResume() {
      if (document.visibilityState === 'visible') void refreshNotifications();
    }
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    // lecture directe
    matches: state.matches,
    reservations: state.reservations,
    ratings: state.ratings,
    notifications: state.notifications,
    identity: state.identity,
    token: state.token,
    me: state.me,
    profile: state.profile,
    playerNames: state.playerNames,
    venue: state.venue,
    /** A8 — tous les centres actifs, et l'échec éventuel de leur lecture (≠ liste vide). */
    venues: state.venues,
    venuesError,
    venueAvailability,
    /** Nom du centre / infos du terrain d'après leur ID (un match, une réservation, une notification) —
        jamais « le centre courant ». */
    venueName: (venueId: string) => venueNameOf(state, venueId),
    venueSummary: (venueId: string) => venueSummaryOf(state, venueId),
    fieldInfo: (fieldId: string) => fieldInfoOf(state, fieldId),
    /** Ouvre un centre : charge sa fiche complète (GET /venues/:id) si ce n'est pas déjà celui d'ouvert —
        BookingFlow/CreateMatchFlow lisent `store.venue`. */
    selectVenue: async (venueId: string): Promise<ActionResult> => {
      if (state.venue?.id === venueId) return { ok: true };
      try {
        const res = await apiFetch<{ venue: VenueDetail }>(`/venues/${venueId}`);
        setState((s) => applySetVenue(s, res.venue));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Relit la liste des centres (« Réessayer » de l'Explorer). */
    refreshVenues: async (): Promise<ActionResult> => {
      try {
        const res = await apiFetch<{ venues: ApiVenueSummary[] }>('/venues');
        setState((s) => applySetVenues(s, res.venues.map(venueSummaryFromApi)));
        setVenuesError(false);
        return { ok: true };
      } catch (e) {
        setVenuesError(true);
        return actionResultFromError(e);
      }
    },
    /** Ce qu'il reste à jouer aujourd'hui par centre. Échec silencieux (garde la dernière valeur connue) :
        une indication secondaire ne doit jamais bloquer ni alerter l'écran. */
    loadVenueAvailability: async (): Promise<void> => {
      try {
        const res = await apiFetch<ApiAvailabilitySummary>('/venues/availability-summary');
        setVenueAvailability(Object.fromEntries(res.venues.map((v) => [v.venueId, {
          freeStarts: v.freeStarts, nextStartMin: v.nextStartMin, eveningStarts: v.eveningStarts,
        }])));
      } catch (e) { console.error('GET /venues/availability-summary', e); }
    },
    /** « Tes amis jouent bientôt » (règle 11 point 5) — chargé par HomeScreen à l'affichage. Échec
        silencieux (garde la dernière valeur connue) : une section secondaire du Home ne doit jamais
        bloquer ni alerter l'écran, elle se cache simplement si vide. */
    friendsMatches,
    loadFriendsMatches: async (): Promise<void> => {
      if (!state.token || !state.me) return;
      try {
        const res = await apiFetch<{ matches: ApiFriendMatch[] }>('/me/friends-matches', { token: state.token });
        setFriendsMatches(res.matches.map((m) => friendMatchFromApi(m, state.me!.id, Date.now())));
      } catch (e) { console.error('GET /me/friends-matches', e); }
    },
    /* --- Profil et données (Lot 10) --------------------------------------------------------------------------------------- */
    profileSummary,
    /** GET /me/profile-summary : statistiques, fiabilité (jamais celle d'un autre), terrains, potes, accords, ville/sports/niveau. Échec : garde la dernière valeur, renvoie l'erreur. */
    loadProfileSummary: async (): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<ProfileSummary>('/me/profile-summary', { token });
        setProfileSummary(res);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « Enregistrer » de Modifier le profil : PATCH /me/profile (ville, sports, niveau, genre, prénom, nom) puis, si le pseudo a changé, PATCH /me (unicité, règle du core). */
    saveProfile: async (p: {
      firstName?: string; lastName?: string; city?: string | null; sports?: string[]; level?: string | null; gender?: string | null; pseudo?: string;
    }): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const { pseudo, ...fields } = p;
        if (Object.keys(fields).length > 0) await apiFetch('/me/profile', { method: 'PATCH', token, body: fields });
        if (pseudo !== undefined) {
          const res = await apiFetch<{ user: MeResponse['user'] }>('/me', { method: 'PATCH', token, body: { name: pseudo } });
          setState((st) => applySetMe(applySetIdentity(st, { ...st.identity, name: res.user.name }), res.user));
        }
        const fresh = await apiFetch<ProfileSummary>('/me/profile-summary', { token });
        setProfileSummary(fresh);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « Mes accords » : PATCH /me/consents. Le serveur répond l'état réel ; il est reporté dans le résumé. */
    setConsents: async (c: { phoneVisible?: boolean; promoOptIn?: boolean }): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<{ phoneVisible: boolean; promoOptIn: boolean }>('/me/consents', { method: 'PATCH', token, body: c });
        setProfileSummary((cur) => (cur ? { ...cur, profile: { ...cur.profile, phoneVisible: res.phoneVisible, promoOptIn: res.promoOptIn } } : cur));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /* --- « C'est bien toi ? » (règle 21) -------------------------------------------------------------------------------- */
    /** Les réservations que des centres ont saisies à MON numéro et qui attendent ma réponse. */
    claims,
    loadClaims: async (): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<{ claims: Claim[] }>('/me/claims', { token });
        setClaims(res.claims);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « C'est moi » / « Ce n'est pas moi ». Dans les deux cas la demande disparaît ; après « C'est moi » la réservation devient la mienne (Mes réservations relue). */
    answerClaim: async (bookingId: string, answer: 'confirm' | 'decline'): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        await apiFetch(`/me/claims/${bookingId}/${answer}`, { method: 'POST', token });
        setClaims((cur) => cur.filter((c) => c.bookingId !== bookingId));
        if (answer === 'confirm') {
          const res = await apiFetch<{ bookings: ApiBooking[]; nextCursor: string | null }>(`/me/bookings?limit=${LIST_PAGE_SIZE}`, { token });
          const meId = state.me?.id ?? '';
          const incoming = res.bookings.map((w) => ({
            booking: bookingFromApi(w, meId), ...(w.format !== null ? { format: w.format as MatchFormat } : {}),
            ...(w.reference ? { reference: w.reference } : {}),
          }));
          setState((st) => applyReplaceReservations(st, mergeById(st.reservations, incoming, (r) => r.booking.id)));
        }
        return { ok: true };
      } catch (e) {
        // Déjà répondu / plus d'actualité : la demande n'a plus lieu d'être — relire la liste plutôt que de laisser une carte morte.
        void (async () => { try { const r = await apiFetch<{ claims: Claim[] }>('/me/claims', { token }); setClaims(r.claims); } catch { /* garde la liste */ } })();
        return actionResultFromError(e);
      }
    },
    /* --- Notifications (Lot 11) ------------------------------------------------------------------------------------------- */
    notificationSettings,
    /** GET /me/notification-settings : les trois interrupteurs de « Réglages des notifications ». */
    loadNotificationSettings: async (): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        setNotificationSettings(await apiFetch<NotificationSettings>('/me/notification-settings', { token }));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** PATCH /me/notification-settings : le serveur répond l'état réel (« bons plans » est le même réglage que dans Mes accords). */
    setNotificationSettings: async (patch: Partial<NotificationSettings>): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<NotificationSettings>('/me/notification-settings', { method: 'PATCH', token, body: patch });
        setNotificationSettings(res);
        setProfileSummary((cur) => (cur ? { ...cur, profile: { ...cur.profile, promoOptIn: res.promos } } : cur));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « Préviens-moi si ça se libère » sur un match complet : l'état de l'alerte, puis son activation / retrait. `null` = on ne sait pas (réseau). */
    matchWatching: async (matchId: string): Promise<boolean | null> => {
      if (!token) return null;
      try { return (await apiFetch<{ watching: boolean }>(`/matches/${matchId}/watch`, { token })).watching; } catch { return null; }
    },
    setMatchWatch: async (matchId: string, on: boolean): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        await apiFetch(`/matches/${matchId}/watch`, { method: on ? 'PUT' : 'DELETE', token });
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « Signaler » un joueur ou un match (audit 26/10, P1-10) : POST /reports, envoyé au support. `duplicate` : déjà signalé et pas encore traité. */
    sendReport: async (target: { type: 'PLAYER' | 'MATCH'; id: string }, reason: string, note: string): Promise<ActionResult & { duplicate?: boolean }> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<{ ok: boolean; duplicate: boolean }>('/reports', { method: 'POST', token, body: { targetType: target.type, targetId: target.id, reason, ...(note !== '' ? { note } : {}) } });
        return { ok: true, duplicate: res.duplicate };
      } catch (e) { return actionResultFromError(e); }
    },
    /** « M'alerter si un match est créé » sur un jour sans match : l'alerte existe-t-elle (pour ce jour et ce sport) ? `day` = « AAAA-MM-JJ ». */
    dayAlertActive: async (day: string, sport: Sport | null): Promise<boolean | null> => {
      if (!token) return null;
      try {
        const res = await apiFetch<{ alerts: { day: string; sport: Sport | null }[] }>(`/me/day-alerts?day=${day}`, { token });
        return res.alerts.some((a) => a.sport === sport);
      } catch { return null; }
    },
    setDayAlert: async (day: string, sport: Sport | null, on: boolean): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        await apiFetch('/me/day-alerts', { method: on ? 'PUT' : 'DELETE', token, body: { day, ...(sport !== null ? { sport } : {}) } });
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Changement de numéro (règle 28) : 1) le code part du NOUVEAU numéro (POST /auth/otp/request, mêmes plafonds que partout) ; 2) il est prouvé ici (POST /me/phone). */
    requestPhoneCode: async (e164: string): Promise<ActionResult> => {
      try {
        await apiFetch('/auth/otp/request', { method: 'POST', body: { phone: e164 } });
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    confirmPhoneChange: async (e164: string, code: string, currentPassword: string): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        const res = await apiFetch<{ user: MeResponse['user'] }>('/me/phone', { method: 'POST', token, body: { phone: e164, code, currentPassword } });
        setState((st) => applySetMe(st, res.user));
        setProfileSummary((cur) => (cur ? { ...cur, me: { ...cur.me, phone: res.user.phone } } : cur));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Changement de mot de passe : l'actuel, puis le nouveau (POST /me/password). Un faux actuel = 403 (jamais une déconnexion). */
    changePassword: async (currentPassword: string, newPassword: string): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        await apiFetch('/me/password', { method: 'POST', token, body: { currentPassword, newPassword } });
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    bootstrapping,
    /** Lot 3C, P0 §3 — non-`null` seulement quand le chargement initial a
        échoué pour une raison qui n'invalide PAS la session (réseau/5xx) :
        App.tsx s'en sert pour montrer un état honnête hors-ligne au lieu de
        rendre le Home avec les données de démo restées en place. */
    bootstrapError,
    retryBootstrap,
    /** C7 (audit produit 21/09/2026) : App.tsx affiche LegalConsentGate tant que c'est vrai, avant
        tout autre écran — compte déjà existant qui n'a jamais accepté, ou dont la version acceptée
        est périmée. */
    needsLegalConsent,
    acceptLegalConsent: async () => {
      if (!state.token) return;
      await apiFetch('/me/legal-consent', { method: 'POST', token: state.token });
      setNeedsLegalConsent(false);
    },
    /** Unicité du nom d'affichage (25/09/2026) : App.tsx affiche NameChangeGate tant que c'est vrai — le compte partageait
        son nom avec un joueur plus ancien (doublon d'avant la règle). */
    needsNameChange,
    /** PATCH /me. Jette l'ApiError du serveur (`NAME_TAKEN`, `NAME_INVALID`, `RATE_LIMITED`…) : l'écran affiche son message.
        En cas de succès le nom est remplacé partout (compte, identité) et la garde tombe. */
    changeDisplayName: async (name: string): Promise<void> => {
      if (!state.token) return;
      const res = await apiFetch<{ user: MeResponse['user']; needsNameChange: boolean }>('/me', {
        method: 'PATCH', token: state.token, body: { name },
      });
      setState((s) => applySetMe(applySetIdentity(s, { ...s.identity, name: res.user.name }), res.user));
      setNeedsNameChange(res.needsNameChange);
    },

    /* Règles 28-30 (24/10/2026) : App.tsx affiche AccessSetupGate tant que c'est vrai — compte
       antérieur à ce lot, sans pseudo au format actuel ni mot de passe ni nouveaux accords.
       POST /me/access-setup. Jette l'ApiError du serveur (NAME_TAKEN, PASSWORD_INVALID…) :
       l'écran affiche son message. */
    needsAccessSetup,
    completeAccessSetup: async (params: {
      pseudo: string; password: string; ageConfirmed: boolean; phoneVisible: boolean; promoOptIn: boolean;
    }): Promise<void> => {
      if (!state.token) return;
      const res = await apiFetch<{ user: MeResponse['user']; needsAccessSetup: boolean }>('/me/access-setup', {
        method: 'POST', token: state.token, body: params,
      });
      setState((s) => applySetMe(applySetIdentity(s, { ...s.identity, name: res.user.name }), res.user));
      setNeedsAccessSetup(res.needsAccessSetup);
    },

    /* --- Pagination (L3, 25/09/2026) ------------------------------------- */
    /** Reste-t-il des éléments plus anciens à charger pour cette liste ? */
    hasMore: (list: PagedList): boolean => cursors[list] !== null,
    isLoadingMore: (list: PagedList): boolean => loadingMore[list],
    /** « Afficher plus » : charge la page suivante de la liste et l'AJOUTE à ce qui est affiché. Un seul chargement
        à la fois par liste ; en cas d'échec le curseur est conservé (le joueur peut réessayer) et l'erreur rendue. */
    loadMore: async (list: PagedList): Promise<ActionResult> => {
      const cursor = cursors[list];
      if (!token || !state.me || cursor === null || loadingMore[list]) return { ok: true };
      const meId = state.me.id;
      setLoadingMore((l) => ({ ...l, [list]: true }));
      try {
        const qs = `?limit=${LIST_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`;
        if (list === 'notifications') {
          const res = await apiFetch<{ notifications: ApiNotification[]; nextCursor: string | null }>(`/me/notifications${qs}`, { token });
          setState((s) => applyReplaceNotifications(s, mergeById(s.notifications, res.notifications.map(notificationFromApi), (n) => n.id)));
          setCursors((c) => ({ ...c, notifications: res.nextCursor }));
        } else if (list === 'reservations') {
          const res = await apiFetch<{ bookings: ApiBooking[]; nextCursor: string | null }>(`/me/bookings${qs}`, { token });
          const incoming = res.bookings.map((w) => ({
            booking: bookingFromApi(w, meId), ...(w.format !== null ? { format: w.format as MatchFormat } : {}),
            ...(w.reference ? { reference: w.reference } : {}),
          }));
          setState((s) => applyReplaceReservations(s, mergeById(s.reservations, incoming, (r) => r.booking.id)));
          setCursors((c) => ({ ...c, reservations: res.nextCursor }));
        } else {
          const res = await apiFetch<{ matches: ApiMatchWithRoster[]; nextCursor: string | null }>(`/me/matches${qs}`, { token });
          const now = Date.now();
          setState((s) => res.matches.reduce((acc, w) => applyUpsertMatch(acc, recordFromApi(w, meId, now)), s));
          setCursors((c) => ({ ...c, myMatches: res.nextCursor }));
        }
        return { ok: true };
      } catch (e) {
        return actionResultFromError(e);
      } finally {
        setLoadingMore((l) => ({ ...l, [list]: false }));
      }
    },

    /* --- Fil de l'Explorer › Matchs (filtres côté serveur) ---------------- */
    /** Le fil filtré : les matchs (depuis `state.matches`, une seule source — un match rejoint se met à jour ici aussi),
        le total, et l'état de chargement. */
    feed: {
      entries: feed.ids.flatMap((id) => { const r = state.matches[id]; return r ? [{ match: r.match, players: r.players }] : []; }),
      total: feed.total, totalAllDays: feedTotalAllDays, hasMore: feed.nextCursor !== null,
      status: feed.status, error: feed.error, loadingMore: feed.loadingMore,
    },
    feedDayCounts,
    /** Charge la PREMIÈRE page du fil pour ces filtres (remplace le fil affiché). Une réponse arrivée après qu'un autre
        filtre a été demandé est jetée. `withTotalAllDays` : un jour précis est choisi — lit aussi le total tous jours. */
    loadFeed: async (params: FeedParams, withTotalAllDays: boolean): Promise<void> => {
      const meId = state.me?.id ?? '';
      const request = ++feedRequest.current;
      feedParams.current = params;
      setFeed((f) => ({ ...f, status: 'loading', error: null, loadingMore: false }));
      const now = Date.now();
      try {
        const [page, all] = await Promise.all([
          apiFetch<{ matches: ApiMatchWithRoster[]; nextCursor: string | null; total?: number }>(`/matches${feedQueryString(params, now)}`, { token }),
          withTotalAllDays
            ? apiFetch<{ total?: number }>(`/matches${feedTotalAllDaysQueryString(params, now)}`, { token }).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (request !== feedRequest.current) return;
        const records = page.matches.map((w) => recordFromApi(w, meId, now));
        setState((s) => records.reduce((acc, r) => applyUpsertMatch(acc, r), s));
        setFeed({ ids: records.map((r) => r.match.id), nextCursor: page.nextCursor, total: page.total ?? null, status: 'ready', error: null, loadingMore: false });
        setFeedTotalAllDays(withTotalAllDays ? (all?.total ?? null) : (page.total ?? null));
      } catch (e) {
        if (request !== feedRequest.current) return;
        setFeed((f) => ({ ...f, status: 'error', error: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE, loadingMore: false }));
      }
    },
    /** « Afficher plus » du fil : la page suivante des MÊMES filtres, ajoutée à la suite. */
    loadMoreFeed: async (): Promise<ActionResult> => {
      const params = feedParams.current;
      if (!params || feed.nextCursor === null || feed.loadingMore || feed.status !== 'ready') return { ok: true };
      const request = feedRequest.current;
      const meId = state.me?.id ?? '';
      setFeed((f) => ({ ...f, loadingMore: true }));
      try {
        const now = Date.now();
        const page = await apiFetch<{ matches: ApiMatchWithRoster[]; nextCursor: string | null }>(`/matches${feedQueryString(params, now, feed.nextCursor)}`, { token });
        if (request !== feedRequest.current) return { ok: true }; // les filtres ont changé entre-temps
        const records = page.matches.map((w) => recordFromApi(w, meId, now));
        setState((s) => records.reduce((acc, r) => applyUpsertMatch(acc, r), s));
        setFeed((f) => ({ ...f, ids: mergeById(f.ids, records.map((r) => r.match.id), (id) => id), nextCursor: page.nextCursor, loadingMore: false }));
        return { ok: true };
      } catch (e) {
        if (request === feedRequest.current) setFeed((f) => ({ ...f, loadingMore: false }));
        return actionResultFromError(e);
      }
    },
    /** Recherche d'Explorer (Lot 5, Recherche.dc.html) : les premiers matchs du fil dont le titre ou le format correspond au texte
        (le serveur replie accents et casse). N'écrit PAS dans le fil de l'onglet Matchs (`feed`) — les matchs trouvés rejoignent seulement
        le dépôt commun (pour que `findMatch` les résolve à l'ouverture). Lance une erreur réseau : l'appelant l'affiche. */
    searchMatches: async (text: string, limit = 5): Promise<{ match: Match; players: MatchPlayer[] }[]> => {
      const meId = state.me?.id ?? '';
      const now = Date.now();
      const res = await apiFetch<{ matches: ApiMatchWithRoster[] }>(`/matches?q=${encodeURIComponent(text.trim())}&limit=${limit}`, { token });
      const records = res.matches.map((w) => recordFromApi(w, meId, now));
      setState((s) => records.reduce((acc, r) => applyUpsertMatch(acc, r), s));
      return records.map((r) => ({ match: r.match, players: r.players }));
    },
    /** Décompte des matchs du fil par jour pour le bandeau (sport seulement). Échec silencieux : `null` conservé. */
    loadFeedDayCounts: async (sport: Sport | null, fromDayStartMs: number, days: number): Promise<void> => {
      try {
        const res = await apiFetch<{ counts: Record<string, number> }>(`/matches/day-counts${dayCountsQueryString(sport, fromDayStartMs, days)}`, { token });
        setFeedDayCounts(res.counts);
      } catch (e) { console.error('GET /matches/day-counts', e); }
    },

    // sélecteurs dérivés (une seule source : state.matches/state.reservations)
    findMatch: (matchId: string) => findMatch(state, matchId),
    myUpcoming: () => myUpcoming(state),
    openMatches: () => openMatches(state),
    myPastEntries: () => myPastEntries(state),
    /** Tous mes matchs, tous statuts (Mes matchs › Passés, lot 8). */
    myMatches: () => myMatches(state),
    blockersFor: (weekday: number) => blockersFor(state, weekday),
    isBookingConsumed: (bookingId: string) => isBookingConsumed(state, bookingId),
    /** Nom réel si déjà résolu (roster nominatif d'un match consulté),
        undefined sinon — PlayerRow/playerDisplay s'en sert avant de retomber
        sur l'annuaire mock local (Lot 3B, étape 3 point 5). */
    knownPlayerName: (userId: string) => state.playerNames[userId],

    /** Liste complète + un setter qui reste optimiste (même contrat que
        l'ancien useState local, NotificationsScreen n'a pas changé) mais
        diffe l'ancien/nouveau tableau pour appeler le vrai marquer-lu côté
        serveur sur les ids qui viennent de passer lu — Lot 3B, étape 2 :
        une lecture qui ne peut jamais réellement se vérifier "lue" sans ça. */
    setNotifications: (next: Notification[]) => {
      const before = new Map(state.notifications.map((n) => [n.id, n.readAt]));
      const newlyRead = next.filter((n) => n.readAt !== undefined && before.has(n.id) && before.get(n.id) === undefined).map((n) => n.id);
      setState((s) => ({ ...s, notifications: next }));
      if (newlyRead.length > 0 && token) {
        apiFetch('/me/notifications/read', { method: 'POST', token, body: { ids: newlyRead } })
          .catch((e) => console.error('POST /me/notifications/read', e));
      }
    },
    /** Lot 3C, P0 §6 — re-fetch explicite, en plus des déclencheurs
        automatiques (reprise d'app/focus, ci-dessus) : appelé par App.tsx à
        l'entrée sur l'écran Notifications, pour que "j'ouvre l'onglet" soit
        lui aussi un moment de fraîcheur garantie, pas seulement la reprise
        d'app. */
    refreshNotifications,

    /* --- Matchs — mutations réelles (Lot 3B, étape 3) ----------------------
       Chaque action : appel réseau → le serveur valide/persiste → réponse
       (ou re-fetch ciblé) → store synchronisé. Plus aucun succès posé avant
       la réponse serveur. */

    /** GET /matches/:id — roster nominatif réel, à charger à l'arrivée sur
        Match Detail/Organisateur (Lot 3B, étape 3 point 5). */
    loadMatchDetail: async (matchId: string): Promise<ActionResult> => {
      try { await refreshMatchDetail(matchId); return { ok: true }; }
      catch (e) { return actionResultFromError(e); }
    },

    /** Règle 31 : les numéros qu'on a le droit d'appeler pour CE match (l'organisateur si on est inscrit, les inscrits si on organise). Un échec = aucun bouton, jamais une erreur. */
    matchContacts: async (matchId: string): Promise<MatchContact[]> => {
      try {
        const res = await apiFetch<{ contacts: MatchContact[] }>(`/matches/${matchId}/contacts`, { token });
        return res.contacts;
      } catch { return []; }
    },

    /** `team` (règle 3) : l'équipe choisie ; absente = le serveur prend celle qui a le plus de places. */
    joinMatch: async (matchId: string, team?: MatchTeam): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/join`, { method: 'POST', token, ...(team ? { body: { team } } : {}) });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Ouvre le match d'un LIEN reçu (« app.moubarat.app/m/CODE ») : lit la fiche par son code, l'installe dans l'état partagé (roster nominatif compris — le joueur est
        connecté) et rend l'identifiant du match. Un match sur invitation s'ouvre ainsi (règle 6) sans passer par GET /matches/:id, qui le refuse à un tiers. */
    openMatchByCode: async (code: string): Promise<ActionResult & { matchId?: string; mine?: boolean }> => {
      const res = await fetchMatchPreview(code, token);
      if (!res.ok) return { ok: false, code: 'NOT_FOUND', message: res.message };
      const { preview } = res;
      const names: Record<string, string> = {};
      for (const p of preview.players) names[p.userId] = p.name;
      const record: MatchRecord = { match: preview.match, players: matchPlayersFromDetail(preview.match.id, preview.players), code: preview.code ?? undefined };
      setState((st) => applyMergePlayerNames(applyUpsertMatch(st, record), names));
      return { ok: true, matchId: preview.match.id, mine: preview.match.organizerId === meId };
    },
    /** « Ton mot aux joueurs » (MotAuxJoueurs) : l'organisateur le modifie ; vide = plus de mot. */
    setMatchNote: async (matchId: string, note: string): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/note`, { method: 'PUT', token, body: { note } });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Règle 10 : le groupe WhatsApp du match (lien https://chat.whatsapp.com/…) ; `null` le retire. */
    setWhatsappGroup: async (matchId: string, url: string | null): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/whatsapp`, { method: 'PUT', token, body: { url } });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Règle 3 : passer dans l'autre équipe (le core tranche : inscrit, inscriptions ouvertes, place dans l'équipe visée). */
    changeTeam: async (matchId: string, team: MatchTeam): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/team`, { method: 'POST', token, body: { team } });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    leaveMatch: async (matchId: string): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/leave`, { method: 'POST', token });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Règle 25 : l'organisateur déclare un inscrit ABSENT, une fois le match fini (POST /matches/:id/players/:userId/absence). `recorded: false` : déjà déclaré (par le centre ou lui). */
    declareAbsent: async (matchId: string, targetId: string): Promise<ActionResult & { recorded?: boolean; restricted?: boolean }> => {
      try {
        const res = await apiFetch<{ recorded: boolean; restricted: boolean }>(`/matches/${matchId}/players/${targetId}/absence`, { method: 'POST', token });
        return { ok: true, recorded: res.recorded, restricted: res.restricted };
      } catch (e) { return actionResultFromError(e); }
    },
    kickPlayer: async (matchId: string, targetId: string): Promise<ActionResult> => {
      try {
        await apiFetch(`/matches/${matchId}/players/${targetId}/remove`, { method: 'POST', token });
        await refreshMatchDetail(matchId);
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** Verrouille (LOCKED) — pas de roster à relire, patch local du statut
        confirmé par le serveur (réponse `{status:'LOCKED'}`), pas une
        reconstruction : c'est un écho, pas une invention. */
    closeRegistrations: async (matchId: string): Promise<ActionResult> => {
      try {
        const res = await apiFetch<{ status: MatchStatus }>(`/matches/${matchId}/close-registrations`, { method: 'POST', token });
        const entry = findMatch(state, matchId);
        if (entry) setState((s) => applyUpsertMatch(s, { match: { ...entry.match, status: res.status }, players: entry.players }));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** BUG-1 (26/09/2026) : `cancelBooking` annule AUSSI ma réservation du terrain, dans la même transaction serveur.
        Les réservations passées en CANCELLED sont celles que le serveur RENVOIE (`bookingIds`) — un écho, jamais une
        déduction locale. */
    cancelMatch: async (matchId: string, opts: { cancelBooking?: boolean } = {}): Promise<ActionResult> => {
      try {
        const res = await apiFetch<{ status: MatchStatus; bookingCancelled: boolean; bookingIds: string[] }>(
          `/matches/${matchId}/cancel`, { method: 'POST', token, body: { cancelBooking: opts.cancelBooking === true } },
        );
        const entry = findMatch(state, matchId);
        setState((s) => {
          let next = entry ? applyUpsertMatch(s, { match: { ...entry.match, status: res.status }, players: entry.players }) : s;
          if (res.bookingCancelled) for (const id of res.bookingIds) next = applyPatchBookingStatus(next, id, 'CANCELLED');
          return next;
        });
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },
    /** POST /matches — toujours depuis une réservation déjà réelle
        (`bookingId`, obtenue via `createBooking` ci-dessous). Match inséré
        avec l'id RÉEL renvoyé par le serveur — jamais un id local. */
    publishMatch: async (input: {
      bookingId: string; title: string; note?: string | undefined;
      level: SkillLevel; visibility: 'OPEN' | 'PRIVATE';
    }): Promise<ActionResult & { matchId?: string }> => {
      try {
        const res = await apiFetch<{ match: ApiPublicMatch }>('/matches', {
          method: 'POST', token,
          body: {
            // Format et capacité HÉRITÉS de la réservation côté serveur (16/09/2026) —
            // jamais un choix libre de l'organisateur.
            bookingId: input.bookingId, title: input.title, level: input.level, visibility: input.visibility,
            ...(input.note ? { note: input.note } : {}),
          },
        });
        const match = matchFromApi(res.match);
        const record: MatchRecord = { match, players: syntheticPlayersFromCount(match.id, 1, true, meId ?? '', Date.now()), code: res.match.code ?? undefined };
        // La réservation locale reçoit son `matchId` (BUG-8) — même vérité que la base après POST /matches.
        setState((s) => applyLinkReservationToMatch(applyUpsertMatch(s, record), input.bookingId, match.id));
        return { ok: true, matchId: match.id };
      } catch (e) { return actionResultFromError(e); }
    },

    /* --- Résultats — saisie/confirmation/contestation réelles (Lot 3C, P0
       ajouté en cours de lot) ---------------------------------------------
       Les trois endpoints existaient déjà côté apps/api (POST /matches/:id/
       result, /result/confirm, /result/dispute) mais n'avaient AUCUN point
       d'entrée côté Player — l'app savait déjà AFFICHER un résultat une fois
       saisi (HistoryScreen/MatchCard), jamais en CRÉER un depuis le
       téléphone. Sans ce point d'entrée, cette moitié de la boucle produit
       (score → OVR/notation, déjà branchés en aval) ne se déclenchait jamais
       organiquement. Règles (fenêtres 24h/qui peut agir) : canReportResult/
       canConfirmResult/autoConfirmDue (packages/core, rules/results.ts +
       rules/rating.ts) — jamais réimplémentées ici, seulement rejouées
       serveur puis réponse appliquée telle quelle. */

    /** GET /matches/:id/result — à charger explicitement (pas au bootstrap
        global, qui ne couvre que MES matchs déjà PLAYED au moment du
        chargement initial) à l'arrivée sur Organiser/Detail pour un match
        dont le statut est PLAYED. `result: null` = vérifié, aucun résultat
        saisi pour l'instant (distinct de "pas encore vérifié", géré par
        l'appelant via un état local). Écrit dans le store partagé seulement
        si un résultat existe (jamais un "null" qui écraserait une entrée
        déjà connue par ailleurs, ex. bootstrap). */
    loadMatchResult: async (matchId: string): Promise<ActionResult & { result: MatchResult | null }> => {
      try {
        const res = await apiFetch<{ result: ApiMatchResult | null }>(`/matches/${matchId}/result`, { token });
        const result = res.result ? matchResultFromApi(res.result) : null;
        if (result) setState((s) => applySetMatchResults(s, { [matchId]: result }));
        return { ok: true, result };
      } catch (e) { return { ...actionResultFromError(e), result: null }; }
    },
    /** POST /matches/:id/result — organisateur seul, match PLAYED/LOCKED
        (core, canReportResult). La réponse serveur devient directement l'état
        affiché, jamais reconstruite localement. */
    submitResult: async (params: { matchId: string; homeScore: number; awayScore: number }): Promise<ActionResult & { result?: MatchResult }> => {
      try {
        const res = await apiFetch<{ result: ApiMatchResult }>(`/matches/${params.matchId}/result`, {
          method: 'POST', token, body: { homeScore: params.homeScore, awayScore: params.awayScore },
        });
        const result = matchResultFromApi(res.result);
        setState((s) => applySetMatchResults(s, { [params.matchId]: result }));
        return { ok: true, result };
      } catch (e) { return actionResultFromError(e); }
    },
    /** POST /matches/:id/result/confirm — un joueur inscrit, jamais celui qui
        a saisi (core, canConfirmResult : NOT_OPPONENT sinon). */
    confirmMatchResult: async (matchId: string): Promise<ActionResult & { result?: MatchResult }> => {
      try {
        const res = await apiFetch<{ result: ApiMatchResult }>(`/matches/${matchId}/result/confirm`, { method: 'POST', token });
        const result = matchResultFromApi(res.result);
        setState((s) => applySetMatchResults(s, { [matchId]: result }));
        return { ok: true, result };
      } catch (e) { return actionResultFromError(e); }
    },
    /** POST /matches/:id/result/dispute — même garde que la confirmation. */
    disputeMatchResult: async (matchId: string): Promise<ActionResult & { result?: MatchResult }> => {
      try {
        const res = await apiFetch<{ result: ApiMatchResult }>(`/matches/${matchId}/result/dispute`, { method: 'POST', token });
        const result = matchResultFromApi(res.result);
        setState((s) => applySetMatchResults(s, { [matchId]: result }));
        return { ok: true, result };
      } catch (e) { return actionResultFromError(e); }
    },

    /* --- Disponibilité — lecture réelle (Lot 3B, étape 4) -------------------
       GET /fields/:fieldId/availability, le même moteur core que POST
       /bookings valide contre (voir docs/DECISIONS.md). Ne touche à aucun
       état partagé — transitoire, propre à l'écran qui la demande (même
       logique que blockersFor, jamais un fait global). */
    fetchAvailability: async (params: {
      fieldId: string; date: string; durationMin: number; step?: number;
    }): Promise<ActionResult & { starts?: readonly AvailabilityStart[]; formats?: readonly { format: MatchFormat; hourlyRateDa: number }[] }> => {
      try {
        const qs = `date=${params.date}&duration=${params.durationMin}${params.step ? `&step=${params.step}` : ''}`;
        const res = await apiFetch<ApiAvailabilityResponse>(`/fields/${params.fieldId}/availability?${qs}`, { token });
        return {
          ok: true, starts: availabilityStartsFromApi(res),
          formats: res.field.formats.map((f) => ({ format: f.format as MatchFormat, hourlyRateDa: f.hourlyRateDa })),
        };
      } catch (e) { return actionResultFromError(e); }
    },

    /* --- Réservations — mutations réelles ---------------------------------- */

    /** POST /bookings — remplace toute génération de référence côté client
        (bookingReference() local, Lot 2) : la référence, l'id, `matchId`
        viennent tous de la réponse serveur (voir docs/LOT3A_AUDIT_
        COMPATIBILITE_API.md §1/§8.1, confirmé le 30/08/2026). `reservationName`
        optionnel : omis, le serveur retombe sur le nom réel du compte
        authentifié (`req.auth.name`) — jamais un texte générique inventé
        côté client pour un écran qui ne demande pas ce champ (chemin A de
        Créer un match). */
    createBooking: async (params: {
      fieldId: string; date: string; startMin: number; durationMin: number;
      source?: 'MOUBARAT' | 'PHONE'; reservationName?: string;
      /** 16/09/2026 : requis dès que le terrain propose plusieurs formats (le
          serveur refuse sinon, FORMAT_REQUIRED) — omis sur un terrain à un seul
          format, où le serveur le déduit. */
      format?: MatchFormat;
      /** Lot P1, point 2 — transmis TEL QUEL à l'API (validation, applicabilité,
          plafond : tout est tranché côté serveur, PROMO_NOT_APPLICABLE /
          PROMO_LIMIT_REACHED remontent dans `code`). */
      promoCode?: string;
    }): Promise<ActionResult & { booking?: Booking; reference?: string; centerNotified?: boolean; discountDa?: number }> => {
      try {
        const res = await apiFetch<{ booking: ApiBooking; centerNotified: boolean }>('/bookings', {
          method: 'POST', token,
          body: {
            fieldId: params.fieldId, date: params.date, startMin: params.startMin, durationMin: params.durationMin,
            source: params.source ?? 'MOUBARAT', ...(params.reservationName ? { reservationName: params.reservationName } : {}),
            ...(params.promoCode ? { promoCode: params.promoCode } : {}),
            ...(params.format ? { format: params.format } : {}),
          },
        });
        const booking = bookingFromApi(res.booking, meId ?? '');
        const storedFormat = res.booking.format as MatchFormat | null;
        setState((s) => applyRegisterBooking(s, booking, storedFormat ?? undefined, res.booking.reference));
        return { ok: true, booking, reference: res.booking.reference, centerNotified: res.centerNotified, discountDa: res.booking.discountDa ?? 0 };
      } catch (e) { return actionResultFromError(e); }
    },
    /** POST /bookings/:id/cancel — le serveur applique la règle H-2 (core) et la cascade vers le match (BUG-1) ;
        `matchCancelled` est SA réponse : le match lié passe alors en CANCELLED dans l'état partagé (À venir, Home),
        jamais une déduction locale. `message` aussi vient du serveur (§18/§19, 25/10/2026) : lui seul sait si CETTE
        annulation est EARLY ou LATE (demi-absence) — jamais un texte générique recomposé côté app. */
    cancelBooking: async (bookingId: string): Promise<ActionResult & { matchCancelled?: boolean; message?: string }> => {
      try {
        const res = await apiFetch<{ ok: boolean; matchCancelled?: boolean; message: string }>(`/bookings/${bookingId}/cancel`, { method: 'POST', token });
        const matchCancelled = res.matchCancelled === true;
        setState((s) => {
          let next = applyPatchBookingStatus(s, bookingId, 'CANCELLED');
          const linkedId = s.reservations.find((r) => r.booking.id === bookingId)?.booking.matchId;
          const entry = linkedId ? findMatch(s, linkedId) : undefined;
          if (matchCancelled && entry) next = applyUpsertMatch(next, { match: { ...entry.match, status: 'CANCELLED' }, players: entry.players });
          return next;
        });
        return { ok: true, matchCancelled, message: res.message };
      } catch (e) { return actionResultFromError(e); }
    },

    /* --- Notation — réelle -------------------------------------------------- */

    /** POST /matches/:id/ratings — la note appliquée localement est celle
        RENVOYÉE par le serveur (rowToRating), jamais celle construite avant
        l'appel. `applyRateMatch` (core, remplace si déjà notée) reste
        inchangée : seule sa source change. */
    rateMatch: async (params: { matchId: string; targetType: Rating['targetType']; targetId: string; stars: Rating['stars']; comment?: string }): Promise<ActionResult> => {
      try {
        const res = await apiFetch<{ rating: Rating }>(`/matches/${params.matchId}/ratings`, {
          method: 'POST', token,
          body: { targetType: params.targetType, targetId: params.targetId, stars: params.stars, ...(params.comment ? { comment: params.comment } : {}) },
        });
        setState((s) => applyRateMatch(s, res.rating));
        return { ok: true };
      } catch (e) { return actionResultFromError(e); }
    },

    // réservations (démo restante — compteur local, chemin "déjà réservé
    // par téléphone déclaré sans passer par createBooking" — voir rapport)
    /** Numéro de séquence partagé pour bookingReference() (core) — encore
        utilisé par le chemin `confirmExternal`/déclaration téléphonique tant
        que ce sous-chemin garde sa propre logique de démo (voir rapport de
        fin d'étape, écarts). */
    nextBookingSeq: (): number => {
      const { state: next, seq } = applyNextBookingSeq(state);
      setState(next);
      return seq;
    },
    registerBooking: (booking: Booking, format?: MatchFormat) => {
      setState((s) => applyRegisterBooking(s, booking, format));
    },

    // identité (onboarding, hors connexion)
    setIdentity: (identity: Identity) => {
      setState((s) => applySetIdentity(s, identity));
      savePrefs({ sport: identity.sport, level: identity.level });
    },

    // session (Lot 3B) — voir docs/LOT3A_AUDIT_COMPATIBILITE_API.md §2
    /** Termine une connexion réussie (AuthFlow) : jeton posé tout de suite
        (persisté), puis TOUTES les lectures réelles chargées avant de lever
        `bootstrapping` — même garantie qu'au chargement d'une session déjà
        connue (`loadEverything`) : jamais un Home qui flashe vide avant de
        se remplir. */
    login: (params: { token: string; name: string; sport: Sport | null; level: SkillLevel | null }) => {
      saveToken(params.token);
      savePrefs({ sport: params.sport, level: params.level });
      setState((s) => applySetToken(s, params.token));
      setBootstrapping(true);
      // Même chemin que le chargement initial (runBootstrap) — Lot 3C, P0 §3 :
      // avant ce correctif, un bootstrap raté juste après l'OTP se contentait
      // d'un `console.error`, laissant l'utilisateur sur un Home vide sans
      // aucun signal ni moyen de réessayer.
      runBootstrap(params.token);
    },
    logout: () => {
      // Local d'abord, toujours — l'utilisateur doit pouvoir se déconnecter
      // même hors ligne. La révocation serveur (meilleur effort) suit derrière,
      // sans jamais bloquer la déconnexion locale sur son résultat.
      const tok = state.token;
      clearToken();
      clearPrefs();
      setState((s) => applySetToken(s, null));
      setNeedsLegalConsent(false);
      setNeedsNameChange(false);
      setNeedsAccessSetup(false);
      if (tok) {
        // Chantier iOS : l'appareil cesse de recevoir les push de CE compte
        // (un autre joueur peut se connecter sur le même téléphone).
        const pushToken = loadPushToken();
        if (pushToken) {
          apiFetch(`/me/push-devices/${encodeURIComponent(pushToken)}`, { method: 'DELETE', token: tok }).catch(() => { /* meilleur effort */ });
          clearPushToken();
        }
        apiFetch('/auth/logout', { method: 'POST', token: tok }).catch(() => { /* meilleur effort */ });
      }
    },

    /* --- Chantier iOS (04/09/2026) --------------------------------------- */

    /** Jeton APNs reçu du natif (lib/native.ts, `pushToken`) → PUT
        /me/push-devices. Mémorisé localement pour le DELETE à la déconnexion.
        Silencieux en cas d'échec : le push est un canal secondaire. */
    registerPushDevice: async (pushToken: string, platform: 'ios' | 'android'): Promise<void> => {
      if (!token) return;
      try {
        await apiFetch('/me/push-devices', { method: 'PUT', token, body: { token: pushToken, platform } });
        savePushToken(pushToken);
      } catch { /* réessayé au prochain lancement : le natif renvoie le jeton à chaque démarrage */ }
    },

    /** Suppression de compte (Apple 5.1.1(v)) — DELETE /me : anonymisation
        côté serveur (décision d'Aymen : jamais d'effacement dur, l'historique
        de caisse des centres reste). Le serveur refuse (409) s'il reste des
        engagements à venir — le message est montré tel quel. En cas de
        succès : même sortie locale que logout (jeton effacé → App.tsx
        ramène à l'écran de connexion). */
    deleteAccount: async (): Promise<ActionResult> => {
      if (!token) return { ok: false, code: 'UNAUTHORIZED', message: 'Session absente.' };
      try {
        await apiFetch('/me', { method: 'DELETE', token });
      } catch (e) { return actionResultFromError(e); }
      clearToken();
      clearPrefs();
      clearPushToken();
      setState((s) => applySetToken(s, null));
      return { ok: true };
    },
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
export { ApiError };
