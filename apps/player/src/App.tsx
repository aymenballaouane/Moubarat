import { useEffect, useRef, useState } from 'react';
import { unreadCount } from '@moubarat/core';
import { PasPossibleHost } from './components/PasPossibleSheet.js';
import { IconSprite } from './components/IconSprite.js';
import { AuthFlow } from './components/AuthFlow.js';
import { LienMatch } from './components/LienMatch.js';
import { LegalConsentGate } from './components/LegalConsentGate.js';
import { NameChangeGate } from './components/NameChangeGate.js';
import { AccessSetupGate } from './components/AccessSetupGate.js';
import { ErreurReseau } from './components/ErreurReseau.js';
import { BOOT_AUTO_RETRY_MS } from './lib/bootFailure.js';
import { BookingFlow } from './components/BookingFlow.js';
import { MatchDetail } from './components/MatchDetail.js';
import { CreateMatchFlow } from './components/CreateMatchFlow.js';
import { FreeMatchFlow } from './components/FreeMatchFlow.js';
import { MatchRoute } from './components/MatchRoute.js';
import { OrganizerMatchView } from './components/OrganizerMatchView.js';
import { TeamsFlow } from './components/TeamsFlow.js';
import { ChallengesFlow } from './components/ChallengesFlow.js';
import { NotificationsScreen } from './components/NotificationsScreen.js';
import { NotifSettingsScreen } from './components/NotifSettingsScreen.js';
import { useBackGesture } from './lib/useBackGesture.js';
import { PublicLegalPage } from './components/PublicLegalPage.js';
import { legalDocFromPath } from './lib/legalPage.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { SupportScreen } from './components/SupportScreen.js';
import { ProfileEdit } from './components/ProfileEdit.js';
import { NoticeScreen } from './components/NoticeScreen.js';
import { AccordsScreen } from './components/AccordsScreen.js';
import { BlockedPlayersScreen } from './components/BlockedPlayersScreen.js';
import { PaymentsScreen } from './components/PaymentsScreen.js';
import { BottomNav } from './components/BottomNav.js';
import { HomeScreen } from './components/HomeScreen.js';
import { ExplorerScreen } from './components/ExplorerScreen.js';
import { MatchesScreen } from './components/MatchesScreen.js';
import { CreateOrBookSheet } from './components/CreateOrBookSheet.js';
import { ProfileScreen } from './components/ProfileScreen.js';
import { CURRENT_USER_ID } from './data/identity.js';
import { HOME, type Route, type Tab } from './nav.js';
import { useAppStore, type AppStore } from './state/useAppStore.js';
import { loadToken } from './lib/session.js';
import { clearPendingMatch, codeFromPath, loadPendingMatch, saveGuestJoin, savePendingMatch, takeGuestJoin } from './lib/matchLink.js';
import { MatchJustFull, MatchUnavailable, TuJoues } from './components/TuJoues.js';
import { AlertsCard } from './components/AlertsCard.js';
import type { GuestInvite } from './components/AuthFlow.js';
import { installNativeBridge, on, post } from './lib/native.js';

/* Chantier iOS — annoncée au natif dans le message `ready` (native.ts). Pas
   de source unique de vérité pour la version côté web aujourd'hui (aucun
   numéro de version affiché ailleurs dans l'app) : une constante suffit,
   purement informative pour le natif (jamais lue pour une décision). */
const APP_VERSION = '1.0.0';

/** Le code d'un lien de match ouvert à l'arrivée (« /m/CODE ») — lu UNE fois, avant tout rendu. */
const LINK_AT_LOAD = typeof window !== 'undefined' ? codeFromPath(window.location.pathname) : null;
/** Lot 13 : un texte juridique ouvert à l'arrivée (« /confidentialite », « /conditions ») — page publique, montrée même à un joueur connecté. */
const LEGAL_AT_LOAD = typeof window !== 'undefined' ? legalDocFromPath(window.location.pathname) : null;

export function App() {
  /* Route initiale optimiste (Lot 3B, socle auth/session) : un jeton local
     saute directement l'écran de connexion, mais useAppStore() vérifie en
     parallèle sa validité réelle contre le serveur (GET /auth/me,
     store.bootstrapping) — si le jeton est en fait expiré/révoqué, l'effet
     ci-dessous ramène vers 'auth' dès que store.token repasse à null. */
  const [plusOpen, setPlusOpen] = useState(false);
  const [route, setRouteRaw] = useState<Route>(() => (LEGAL_AT_LOAD ? { name: 'public-legal', doc: LEGAL_AT_LOAD } : loadToken() ? HOME : LINK_AT_LOAD ? { name: 'link', code: LINK_AT_LOAD } : { name: 'auth' }));
  /* Lien de match reçu (Lot 7) : le code attend ici (et en sessionStorage, pour survivre à un rechargement pendant l'inscription) jusqu'à ce qu'on
     soit connecté ; alors le match s'ouvre, sur la fiche ou, si c'est le sien, sur la vue organisateur. */
  const [pendingCode, setPendingCode] = useState<string | null>(() => LINK_AT_LOAD ?? loadPendingMatch());
  const [authStart, setAuthStart] = useState<'welcome' | 'connexion' | 'numero'>('welcome');
  /** Lot B, phase 2 : l'invité arrivé par un lien (inscription courte), le temps de créer son compte. */
  const [guestInvite, setGuestInvite] = useState<GuestInvite | null>(null);
  /* Retour au DERNIER onglet visite quand un flux plein-ecran se ferme —
     jamais une cible codee en dur (piege releve par l'audit sur le
     benchmark : back fige vers Explorer quel que soit le point d'entree). */
  const lastTab = useRef<Tab>('home');

  /* État partagé (Lot 2, §2/§3) : matches/reservations/notes/notifications/
     identité vivent tous ici, dans le même hook — tous les écrans qui les
     lisent voient la même chose, une mutation ne se perd plus en changeant
     d'écran. Voir state/store.ts pour la logique, state/useAppStore.ts pour
     le branchement React. */
  const store = useAppStore();

  const setRoute = (r: Route) => {
    if (r.name === 'tab') lastTab.current = r.tab;
    setRouteRaw(r);
  };
  const goBack = () => setRouteRaw({ name: 'tab', tab: lastTab.current });
  /* Lot 12 : le retour du téléphone fait ce que fait la flèche « Retour » de l'écran (lib/useBackGesture.ts). */
  useBackGesture(route, goBack);

  useEffect(() => {
    if (!pendingCode || store.bootstrapping || !store.token) return;
    let alive = true;
    void store.openMatchByCode(pendingCode).then((res) => {
      if (!alive) return;
      clearPendingMatch();
      setPendingCode(null);
      window.history.replaceState(null, '', '/');
      if (!(res.ok && res.matchId)) { setRoute(res.ok ? HOME : { name: 'match', mode: 'unavailable', message: res.message }); return; }
      const matchId = res.matchId;
      if (res.mine) { setRoute({ name: 'match', mode: 'organizer', matchId }); return; }
      // Lot B, phase 2 : l'invité qui vient de créer son compte est inscrit tout de suite (équipe choisie par le serveur).
      if (takeGuestJoin(pendingCode)) {
        // Pas de garde « alive » ici : le rechargement de l’état après connexion relance cet effet, et l’inscription vient d’avoir lieu.
        void store.joinMatch(matchId).then((joined) => {
          setGuestInvite(null);
          if (joined.ok) setRoute({ name: 'match', mode: 'joined', matchId, code: pendingCode });
          else if (!joined.ok && (joined.code === 'MATCH_FULL' || joined.code === 'MATCH_TEAM_FULL')) {
            const start = store.findMatch(matchId)?.match.range.start ?? Date.now();
            const d = new Date(start);
            setRoute({ name: 'match', mode: 'full', dayStart: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
          } else setRoute({ name: 'match', mode: 'detail', matchId });
        });
        return;
      }
      setRoute({ name: 'match', mode: 'detail', matchId });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCode, store.bootstrapping, store.token]);

  /* Le jeton part à null (bootstrap échoué au chargement, ou 401 reçu en
     cours d'action — voir useAppStore.ts) alors que la route affichait déjà
     l'app : ramener vers l'écran de connexion plutôt que de laisser un écran
     "connecté" que le serveur dément. Ne se déclenche jamais sur la
     connexion initiale (route est alors déjà 'auth' via l'état paresseux
     ci-dessus, ou déjà HOME suite à un onEnter explicite). */
  useEffect(() => {
    if (!store.bootstrapping && store.token === null && route.name !== 'auth' && route.name !== 'link' && route.name !== 'public-legal') {
      setRouteRaw({ name: 'auth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.token, store.bootstrapping]);

  /* Lot 3C, P0 §6 : entrer sur l'écran Notifications rafraîchit réellement
     GET /me/notifications — en plus des déclencheurs "reprise d'app/focus"
     (useAppStore.ts), pour que l'ouverture explicite de l'onglet soit,
     elle aussi, un moment de fraîcheur garantie. */
  useEffect(() => {
    if (route.name === 'notifications') { void store.refreshNotifications(); void store.loadClaims(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);

  /* Chantier iOS (04/09/2026) — pont JS ↔ natif (lib/native.ts). Hors de
     l'habillage natif (PWA, navigateur), `installNativeBridge`/`post` sont
     des no-op silencieux : cet effet ne change rien au comportement actuel.
     `tabSelected`/`createTapped` viennent de la barre d'onglets NATIVE
     (RootTabBarController.swift) quand l'app tourne dans l'habillage —
     jamais émis par le bouton web équivalent, qui reste géré par
     `renderRoute`/`BottomNav` ci-dessous, masqué en mode natif par CSS
     (`.native-shell .bottom-nav`, player.css). */
  useEffect(() => {
    installNativeBridge(APP_VERSION);
    const offTab = on('tabSelected', (m) => setRoute({ name: 'tab', tab: m.tab }));
    /* Le « + » natif ouvre le MÊME menu que le « + » du web (Créer un match / Réserver un terrain) — jamais directement la création
       d'un match (retour d'essai TestFlight, 10/11/2026). La barre native n'est visible que sur les écrans d'onglets (effet `route` plus bas) : ce
       message n'arrive donc que lorsque le menu peut s'afficher. */
    const offCreate = on('createTapped', () => setPlusOpen(true));
    // Une notification touchée (app en arrière-plan/fermée) : pas assez
    // d'information ici pour reproduire le routage précis de
    // NotificationsScreen::routeFor (qui a besoin de store.findMatch et du
    // statut de lecture) — direction honnête plutôt qu'un routage
    // approximatif : l'écran Notifications, où le même item, une fois
    // touché, route correctement.
    const offNotif = on('notificationOpened', () => setRoute({ name: 'notifications' }));
    // Lot B, phase 3 : une alerte web touchée (service worker) — l'app déjà ouverte reçoit un message, sinon elle s'ouvre avec ?ouvrir=notifications.
    const onSwMessage = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'moubarat:open-notifications') setRoute({ name: 'notifications' }); };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    if (new URLSearchParams(window.location.search).get('ouvrir') === 'notifications' && loadToken()) { window.history.replaceState(null, '', '/'); setRoute({ name: 'notifications' }); }
    const offPushToken = on('pushToken', (m) => { void store.registerPushDevice(m.token, m.platform); });
    return () => { offTab(); offCreate(); offNotif(); offPushToken(); navigator.serviceWorker?.removeEventListener('message', onSwMessage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Dit au natif ce qui est affiché (contrat `route`, lib/native.ts) : la barre d'onglets NATIVE n'existe que sur les quatre écrans d'onglets,
     comme le `BottomNav` du web. Sans ce message elle restait visible partout — écran de connexion, inscription, réservation, flux plein écran
     (retour d'essai TestFlight, 10/11/2026). No-op hors habillage natif. */
  useEffect(() => {
    const onTab = route.name === 'tab' && !store.bootstrapping;
    post({ type: 'route', tab: route.name === 'tab' ? route.tab : null, tabBarVisible: onTab });
  }, [route, store.bootstrapping]);

  /* Demande la permission push une seule fois par session, après la
     PREMIÈRE confirmation réelle que le compte est connecté (jamais avant
     — un joueur qui n'a même pas fini l'OTP n'a rien à autoriser). `post`
     est un no-op hors habillage natif : ne déclenche jamais de vraie boîte
     de dialogue en PWA/navigateur. */
  const pushRequested = useRef(false);
  useEffect(() => {
    if (store.me && !pushRequested.current) {
      pushRequested.current = true;
      post({ type: 'requestPushPermission' });
    }
  }, [store.me]);

  /* Audit final, MS-028 (12/11/2026) : l'écran d'échec du chargement promettait « on réessaie tout seul » sans le faire. Essai
     silencieux toutes les 10 secondes, et dès que le téléphone retrouve le réseau ; l'écran reste affiché jusqu'au succès. */
  const bootFailed = store.bootstrapError !== null && !store.me;
  useEffect(() => {
    if (!bootFailed) return;
    const id = window.setInterval(() => store.retryBootstrapQuietly(), BOOT_AUTO_RETRY_MS);
    const onOnline = () => store.retryBootstrapQuietly();
    window.addEventListener('online', onOnline);
    return () => { window.clearInterval(id); window.removeEventListener('online', onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootFailed]);

  const unread = unreadCount(store.notifications, CURRENT_USER_ID);

  /* Rien tant que "suis-je vraiment encore connecté ?" n'a pas de réponse
     serveur (GET /auth/me) — jamais un flash de l'app avant confirmation, ni
     un flash de l'écran de connexion pour un jeton en fait toujours valide.
     Le fond réel (--ink, index.html/player.css) reste visible en dessous. */
  /* Scoping iOS (04/09/2026), test « mode avion » : ce moment ne rendait rien
     de visible (fond noir) — hors-ligne l'échec est immédiat, mais sur un
     réseau muet il pouvait durer jusqu'au délai maximal (api.ts) sans que
     rien ne dise que l'app travaille. Un texte, pas un chiffre inventé, pas
     un nouvel habillage. */
  /* Lot 13 : une page juridique publique s'affiche AVANT tout le reste (chargement de session, erreur réseau, consentement) — elle se lit sans compte, pour les stores comme pour un joueur. */
  if (route.name === 'public-legal') return <PublicLegalPage doc={route.doc} />;

  if (store.bootstrapping) {
    return (
      <>
        <IconSprite />
        <section className="au-screen" id="s-boot" aria-busy="true">
          <p className="mb-meta" style={{ margin: 'auto' }}>Connexion au serveur…</p>
        </section>
      </>
    );
  }

  /* Lot 3C, P0 §3 : le chargement initial a échoué pour une raison qui
     n'invalide PAS la session (réseau coupé, API injoignable, 5xx) —
     `store.token` reste posé, jamais un retour silencieux vers l'écran de
     connexion. Sans cet écran, l'app serait tombée ici sur le Home avec les
     données de démo encore présentes dans l'état initial (matchs/réservations
     FICTIFS affichés comme réels) — patron déjà utilisé ailleurs (mb-note),
     aucun nouvel habillage visuel. `!store.me` : ne s'affiche que si le
     bootstrap n'a JAMAIS réussi une fois (une erreur reçue plus tard, en
     session déjà établie, passe par le mécanisme toast existant de chaque
     action, pas par cet écran). */
  if (store.bootstrapError && !store.me) {
    return (
      <>
        <IconSprite />
        <ErreurReseau onRetry={store.retryBootstrap} kind={store.bootstrapErrorKind} />
      </>
    );
  }

  if (store.needsLegalConsent) {
    return (
      <>
        <IconSprite />
        <LegalConsentGate onAccepted={store.acceptLegalConsent} />
      </>
    );
  }

  /* Unicité du nom d'affichage (25/09/2026) : compte en doublon avec un joueur plus ancien — un autre nom est demandé
     avant tout, même mécanique que le consentement juste au-dessus. Le compte garde son nom tel quel jusque-là. */
  if (store.needsNameChange && store.me) {
    return (
      <>
        <IconSprite />
        <NameChangeGate currentName={store.me.name} onSubmit={store.changeDisplayName} />
      </>
    );
  }

  /* Règles 28-30 (24/10/2026) : compte antérieur à ce lot, sans pseudo au format actuel ni mot
     de passe ni nouveaux accords — même mécanique que les deux gardes au-dessus. Après
     NameChangeGate : un pseudo déjà choisi là n'a pas besoin d'être redemandé, juste confirmé/
     modifié ici (currentName reflète alors le nouveau nom). */
  if (store.needsAccessSetup && store.me) {
    return (
      <>
        <IconSprite />
        <AccessSetupGate currentName={store.me.name} onSubmit={store.completeAccessSetup} />
      </>
    );
  }

  return (
    <>
      <IconSprite />
      <PasPossibleHost onNavigate={setRoute} />
      {renderRoute(route, setRoute, goBack, store, unread, plusOpen, setPlusOpen, authStart, (start) => setAuthStart(start), { pendingCode, setPendingCode, guestInvite, setGuestInvite })}
    </>
  );
}

function renderRoute(
  route: Route,
  setRoute: (route: Route) => void,
  goBack: () => void,
  store: AppStore,
  unread: number,
  plusOpen: boolean,
  setPlusOpen: (open: boolean) => void,
  authStart: 'welcome' | 'connexion' | 'numero',
  setAuthStart: (start: 'welcome' | 'connexion' | 'numero') => void,
  /** Lot B, phase 2 : le lien en attente et l'invité en cours d'inscription. */
  guestCtx: { pendingCode: string | null; setPendingCode: (c: string | null) => void; guestInvite: GuestInvite | null; setGuestInvite: (g: GuestInvite | null) => void },
) {
  const { pendingCode, setPendingCode, guestInvite, setGuestInvite } = guestCtx;
  switch (route.name) {
    case 'auth':
      return (
        <AuthFlow
          startStep={authStart} guest={authStart === 'numero' ? guestInvite : null}
          onCancel={() => { const c = pendingCode; if (c) setRoute({ name: 'link', code: c }); }}
          onEnter={(profile) => { store.login(profile); setRoute(HOME); }}
        />
      );
    case 'public-legal':
      return <PublicLegalPage doc={route.doc} />;
    case 'link':
      return (
        <LienMatch
          code={route.code}
          onJoin={(info) => { savePendingMatch(route.code); saveGuestJoin(route.code); setPendingCode(route.code); setGuestInvite({ code: route.code, ...info }); setAuthStart('numero'); setRoute({ name: 'auth' }); }}
          onHaveAccount={() => { savePendingMatch(route.code); setPendingCode(route.code); setAuthStart('connexion'); setRoute({ name: 'auth' }); }}
        />
      );
    case 'booking':
      return (
        <BookingFlow
          store={store}
          venuePicked={route.venuePicked ?? false}
          viewReservationId={route.viewReservationId}
          mode={route.mode}
          resume={route.resume}
          onMyMatches={() => setRoute({ name: 'tab', tab: 'matches' })}
          onCreateMatch={(prefill) => setRoute({ name: 'match', mode: 'create', prefill })}
          onFreeMatch={(place, query) => setRoute({ name: 'match', mode: 'free', place, query })}
          freePlace={route.freePlace}
          onExit={goBack}
          onHome={() => setRoute(HOME)}
        />
      );
    case 'match': {
      if (route.mode === 'joined') {
        const entry = store.findMatch(route.matchId);
        if (!entry) return null;
        const team = entry.players.find((p) => p.userId === store.me?.id)?.team ?? null;
        return <TuJoues match={entry.match} team={team} code={route.code} store={store} onSeeMatch={() => setRoute({ name: 'match', mode: 'detail', matchId: route.matchId })} alertsSlot={<AlertsCard store={store} variant="player" />} />;
      }
      if (route.mode === 'unavailable') return <MatchUnavailable message={route.message} onHome={() => setRoute(HOME)} />;
      if (route.mode === 'full') {
        return <MatchJustFull onOtherMatches={() => setRoute({ name: 'tab', tab: 'explorer', explorerDay: route.dayStart })} onHome={() => setRoute(HOME)} />;
      }
      if (route.mode === 'free') {
        return (
          <FreeMatchFlow
            store={store} place={route.place} onExit={goBack}
            onBackToPlace={() => setRoute({ name: 'booking', mode: 'match', freePlace: route.place })}
          />
        );
      }
      /* Lot B, phase 1 : « Créer un match » (tuile de l'accueil, menu « + », Jouer) ouvre directement la carte « Où tu joues ? ». La liste
         « Ton créneau » des réservations sans match reste ouverte après « C'est bien moi » (règle 21, `pickReservation`) et depuis une
         réservation (Mes matchs → « Créer un match »). */
      if (route.mode === 'create' && !route.prefill && !route.pickReservation) {
        return (
          <BookingFlow
            store={store} mode="match"
            onMyMatches={() => setRoute({ name: 'tab', tab: 'matches' })}
            onCreateMatch={(prefill) => setRoute({ name: 'match', mode: 'create', prefill })}
            onFreeMatch={(place, query) => setRoute({ name: 'match', mode: 'free', place, query })}
            onExit={goBack} onHome={() => setRoute(HOME)}
          />
        );
      }
      if (route.mode === 'create') {
        return (
          <CreateMatchFlow
            store={store} prefill={route.prefill} onExit={goBack}
            onBookAnother={() => setRoute({ name: 'booking', mode: 'match' })}
            onChangeSlot={(resume) => setRoute({ name: 'booking', mode: 'match', resume })}
          />
        );
      }
      // MS-038 (audit final) : le match demandé, chargé par son identifiant s'il n'est pas en mémoire — jamais un autre à sa place.
      return (
        <MatchRoute matchId={route.matchId} store={store} onExit={goBack}>
          {(entry) => (route.mode === 'organizer'
            ? <OrganizerMatchView match={entry.match} players={entry.players} onExit={goBack} store={store} />
            : <MatchDetail key={entry.match.id} match={entry.match} players={entry.players} onExit={goBack} onOpenMatch={(matchId) => setRoute({ name: 'match', mode: 'detail', matchId })} store={store} />)}
        </MatchRoute>
      );
    }
    case 'teams':
      return (
        <TeamsFlow
          initialScreen="team" onExit={goBack}
          visitTeamId={route.visitTeamId}
          onChallengeTeam={(teamId) => setRoute({ name: 'challenges', opponentId: teamId })}
        />
      );
    case 'challenges':
      return (
        <ChallengesFlow
          initialScreen="inbox" onExit={goBack}
          initialOpponentId={route.opponentId} initialChallengeId={route.challengeId}
          onOpenTeam={() => setRoute({ name: 'teams' })}
        />
      );
    case 'notifications':
      return (
        <NotificationsScreen
          onExit={goBack} onNavigate={setRoute}
          items={store.notifications} onItemsChange={store.setNotifications}
          findMatch={store.findMatch} store={store}
          venueNameOfMatch={(matchId) => { const m = store.findMatch(matchId); return m ? store.matchPlace(m.match) : null; }}
          booking={(bookingId) => {
            const r = store.reservations.find((x) => x.booking.id === bookingId);
            return r ? { venueName: store.fieldInfo(r.booking.fieldId)?.venueName ?? null, start: r.booking.range.start, end: r.booking.range.end } : null;
          }}
          more={{ visible: store.hasMore('notifications'), loading: store.isLoadingMore('notifications'), onLoad: () => store.loadMore('notifications') }}
        />
      );
    case 'history':
      return <HistoryScreen onExit={goBack} onNavigate={setRoute} ratings={store.ratings} store={store} />;
    case 'support':
      return <SupportScreen onExit={goBack} />;
    case 'payments':
      return <PaymentsScreen onExit={goBack} />;
    case 'profile-edit':
      return <ProfileEdit store={store} onBack={goBack} onNavigate={setRoute} {...(route.focus ? { focus: route.focus } : {})} />;
    case 'notif-settings':
      return <NotifSettingsScreen store={store} onBack={goBack} />;
    case 'notice':
      return <NoticeScreen onBack={goBack} onNavigate={setRoute} />;
    case 'blocked':
      return <BlockedPlayersScreen store={store} onBack={() => setRoute({ name: 'notice' })} />;
    case 'accords':
      return <AccordsScreen store={store} onBack={() => setRoute({ name: 'notice' })} onNavigate={setRoute} />;
    case 'tab':
      return (
        <>
          {route.tab === 'home' ? (
            <HomeScreen onNavigate={setRoute} unreadOverride={unread} identityName={store.identity.name} store={store} />
          ) : route.tab === 'explorer' ? (
            <ExplorerScreen key={route.explorerDay ?? 'jouer'} onNavigate={setRoute} store={store} initialTab={route.explorerTab} initialDay={route.explorerDay} />
          ) : route.tab === 'matches' ? (
            <MatchesScreen onNavigate={setRoute} store={store} initialTab={route.matchesTab ?? 'avenir'} />
          ) : (
            <ProfileScreen
              onNavigate={setRoute} identityName={store.identity.name}
              onLogout={() => { store.logout(); setRoute({ name: 'auth' }); }}
              store={store}
            />
          )}
          <BottomNav
            route={route}
            onNavigate={(tab) => setRoute({ name: 'tab', tab })}
            onCreate={() => setPlusOpen(true)}
          />
          {plusOpen ? (
            <CreateOrBookSheet
              onBook={() => { setPlusOpen(false); setRoute({ name: 'booking' }); }}
              onCreate={() => { setPlusOpen(false); setRoute({ name: 'match', mode: 'create' }); }}
              onClose={() => setPlusOpen(false)}
            />
          ) : null}
        </>
      );
  }
}
