import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS, type CenterRole } from '@moubarat/core';
import { IconSprite } from './components/IconSprite.js';
import { Icon } from './components/Icon.js';
import { LoginScreen } from './components/LoginScreen.js';
import { RequestScreen } from './components/RequestScreen.js';
import { LegalGate } from './components/LegalGate.js';
import { SubscriptionBanner } from './components/SubscriptionBanner.js';
import { ReadinessBanner } from './components/ReadinessBanner.js';
import { AccountModal } from './components/AccountModal.js';
import { Dashboard } from './components/Dashboard.js';
import { Planning } from './components/Planning.js';
import { Reservations } from './components/Reservations.js';
import { Abonnements } from './components/Abonnements.js';
import { Analytics } from './components/Analytics.js';
import { Clients } from './components/Clients.js';
import { Equipes } from './components/Equipes.js';
import { Personnel } from './components/Personnel.js';
import { Caisse } from './components/Caisse.js';
import { Journal } from './components/Journal.js';
import { Centre } from './components/Centre.js';
import { Toast } from './components/Toast.js';
import { HelpModal } from './components/HelpModal.js';
import { hasSupport, useSupport } from './lib/support.js';
import { type AuditLogEntry } from './data/auditDemo.js';
import { apiFetch, setUnauthorizedHandler } from './lib/api.js';
import { loadToken, saveToken, clearToken } from './lib/session.js';

type ViewId = 'dash' | 'plan' | 'resa' | 'subs' | 'stats' | 'clients' | 'teams' | 'staff' | 'caisse' | 'audit' | 'conf';

interface NavItem { id: ViewId; label: string; icon: string; badge?: number }

const NAV_ITEMS: NavItem[] = [
  { id: 'dash', label: 'Dashboard', icon: 'i-home' },
  { id: 'plan', label: 'Planning', icon: 'i-cal' },
  { id: 'resa', label: 'Reservations', icon: 'i-cash' },
  { id: 'subs', label: 'Abonnements', icon: 'i-clock' },
  { id: 'stats', label: 'Analytics', icon: 'i-grid' },
  { id: 'clients', label: 'Clients', icon: 'i-users' },
  { id: 'teams', label: 'Equipes', icon: 'i-shirt' },
  // Personnel du centre (22/09/2026) — icône DISTINCTE d'« Equipes » ci-dessus, qui désigne les équipes de
  // joueurs, pas le personnel CRM : collision de sens à éviter dans la nav.
  { id: 'staff', label: 'Personnel', icon: 'i-shield' },
  { id: 'caisse', label: 'Caisse', icon: 'i-check' },
  { id: 'audit', label: 'Journal', icon: 'i-list' },
  { id: 'conf', label: 'Centre', icon: 'i-gear' },
];

type Theme = 'dark' | 'light';

interface CenterMembership {
  venueId: string; venueName: string; role: CenterRole;
  subscriptionStatus: 'PAID' | 'UNPAID'; subscriptionDueAt: string | null;
}
interface MeResponse {
  account: { id: string; email: string; name: string; isSuperadmin: boolean };
  centerMemberships: CenterMembership[];
  needsLegalConsent: boolean;
}

/** Centre rattaché au compte connecté (chantier Centre, É0 — 04/09/2026) :
    id et nom viennent de /platform/auth/me, wilaya et adresse de
    GET /venues/:id (fiche publique). Avant É0, l'id du centre était jeté
    après la connexion et le bandeau affichait un nom de démo. */
interface ConnectedVenue { id: string; name: string; wilaya?: string; address?: string }
// Audit D2 : réglage persisté côté centre (migration 0014), plus jamais un
// état React local remis à `false` à chaque rechargement — sans ça, un compte
// RECEPTION (qui a bien la permission CASH_SESSION) ne pouvait jamais
// atteindre l'écran en pratique.

/* CRM Auth V1 — "connecté ?" = jeton présent ET accepté par le serveur
   (GET /platform/auth/me), jamais la seule présence locale — même principe
   que apps/player et apps/superadmin. Le rôle vient du premier rattachement
   centre (centerMemberships[0]) : un seul centre par compte en pratique
   aujourd'hui, aucun sélecteur nécessaire (décision Aymen 03/09/2026). */
export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [role, setRole] = useState<CenterRole | null>(null);
  const [venue, setVenue] = useState<ConnectedVenue | null>(null);
  const [needsLegalConsent, setNeedsLegalConsent] = useState(false);
  /* Abonnement SaaS minimal (22/09/2026, C1/CE11) : saisi par le superadmin, lu ici depuis
     centerMemberships (jamais depuis GET /venues/:id, route publique) pour le bandeau. */
  const [subscription, setSubscription] = useState<{ status: 'PAID' | 'UNPAID'; dueAt: string | null } | null>(null);
  /* Aide (22/09/2026) : coordonnées de support servies par l'API — le bouton n'existe que s'il y a un canal. */
  const support = useSupport();
  const [helpOpen, setHelpOpen] = useState(false);
  /* ONB-1 (27/09/2026) : « Mon compte » — changer son propre mot de passe (AccountModal). */
  const [accountOpen, setAccountOpen] = useState(false);

  /** Applique un /me accepté : rôle + centre, puis complète le bandeau avec
      la fiche publique du centre (échec silencieux : le nom suffit) — y
      compris le réglage persisté du module Caisse (audit D2). */
  function applyMe(r: MeResponse, authToken: string): boolean {
    const first = r.centerMemberships[0];
    if (!first) return false;
    setAccountName(r.account.name);
    setRole(first.role);
    setVenue({ id: first.venueId, name: first.venueName });
    setNeedsLegalConsent(r.needsLegalConsent);
    setSubscription({ status: first.subscriptionStatus, dueAt: first.subscriptionDueAt });
    // MS-008 (audit final, 12/11/2026) : la fiche d'un centre non publié n'est servie qu'à son personnel — jeton requis.
    apiFetch<{ venue: { wilaya: string; address: string; cashModuleEnabled: boolean } }>(`/venues/${first.venueId}`, { token: authToken })
      .then((d) => {
        setVenue((v) => (v && v.id === first.venueId ? { ...v, wilaya: d.venue.wilaya, address: d.venue.address } : v));
        setModulesCaisse(d.venue.cashModuleEnabled);
      })
      .catch(() => {});
    return true;
  }

  const [view, setView] = useState<ViewId>('dash');
  const [theme, setTheme] = useState<Theme>('dark');
  // Caisse hors navigation par defaut (demande d'Aymen, prototype ligne 1342 —
  // "MODULES = { caisse: false }") : `false` ici n'est qu'une valeur de
  // depart avant la reponse de GET /venues/:id (applyMe) — la vraie source
  // est `venues.cash_module_enabled` (migration 0014, audit D2), jamais plus
  // un etat local remis a zero a chaque rechargement.
  const [modulesCaisse, setModulesCaisse] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // Navigation Planning <-> Réservations (16/09/2026, signalé par Aymen) :
  // « Ouvrir dans le planning » (fiche Réservations) et le clic sur une
  // résa existante dans Planning ne faisaient RIEN jusqu'ici (deux stubs
  // console.info, jamais câblés) — un vrai bug, pas un choix de scope.
  // `nonce` force l'effet côté écran cible même si on redemande deux fois
  // la même date/résa d'affilée (sinon la prop ne change pas de valeur).
  const [planningOpen, setPlanningOpen] = useState<{ date: string; nonce: number } | null>(null);
  // bookingId null = alerte agrégée du Dashboard sans résa unique (ex. « N
  // réservations honorées non encaissées ») — bascule sur Réservations sans
  // imposer de fiche précise (ajouté 16/09/2026 pour Dashboard, même stub).
  const [resaOpen, setResaOpen] = useState<{ date: string; bookingId: string | null; nonce: number } | null>(null);
  function openInPlanning(date: string) {
    setPlanningOpen({ date, nonce: Date.now() });
    setView('plan');
  }
  function openInReservations(bookingId: string | null, date: string) {
    setResaOpen({ date, bookingId, nonce: Date.now() });
    setView('resa');
  }

  useEffect(() => {
    setUnauthorizedHandler(() => { clearToken(); setToken(null); setAccountName(null); setRole(null); setVenue(null); });
    const stored = loadToken();
    if (!stored) { setChecking(false); return; }
    apiFetch<MeResponse>('/platform/auth/me', { token: stored })
      .then((r) => {
        if (!applyMe(r, stored)) { clearToken(); setChecking(false); return; }
        setToken(stored); setChecking(false);
      })
      .catch(() => { clearToken(); setChecking(false); });
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoggedIn(newToken: string) {
    saveToken(newToken);
    apiFetch<MeResponse>('/platform/auth/me', { token: newToken }).then((r) => {
      if (!applyMe(r, newToken)) return; // LoginScreen a déjà vérifié — filet, pas un chemin normal
      setToken(newToken);
    }).catch(() => {});
  }

  async function logout() {
    if (token) await apiFetch('/platform/auth/logout', { method: 'POST', token }).catch(() => {});
    clearToken();
    setToken(null);
    setAccountName(null);
    setRole(null);
    setVenue(null);
    setNeedsLegalConsent(false);
    setSubscription(null);
  }

  // Fidele a audit() (prototype) : who/role/heure derives du role connecte au
  // moment de l'action, pas passes par l'appelant.
  function addAudit(summary: string) {
    const t = new Date();
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    setAuditLog((log) => [{ id: `au-${Date.now()}-${log.length}`, who: accountName ?? '—', role: role ? ROLE_LABELS[role] : '—', hh, summary }, ...log]);
  }

  // Fidele a toast() (prototype) : un seul minuteur partage, relance a chaque appel.
  function showToast(message: string) {
    window.clearTimeout(toastTimer.current);
    setToastMsg(message);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3200);
  }

  // Amendement au gel approuve (design/moubarat-ds.css §1.5) : le toggle
  // pose data-theme sur <body>, exactement comme prototypes/crm-valide.html.
  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  // Fidele au prototype : si le module caisse est desactive pendant qu'on le
  // consulte, on retombe sur le Dashboard plutot que de laisser un ecran mort.
  useEffect(() => {
    if (!modulesCaisse && view === 'caisse') setView('dash');
  }, [modulesCaisse, view]);

  /* Formulaire public d'inscription d'un centre (20/09/2026) : #/rejoindre, accessible SANS compte — lien
     partageable ; jamais atteignable une fois connecté (l'écran de connexion est seul à y mener). */
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (checking) return null;
  if (!token || !role || !venue) {
    return (<><IconSprite />{hash === '#/rejoindre' ? <RequestScreen /> : <LoginScreen onLoggedIn={handleLoggedIn} />}</>);
  }
  if (needsLegalConsent) {
    return (<><IconSprite /><LegalGate token={token} onAccepted={() => setNeedsLegalConsent(false)} /></>);
  }

  return (
    <>
      <IconSprite />
      {/* Audit 09/09/2026 (D9) : le sous-titre affirmait « maquette en
          données fictives » à chaque écran, en permanence — vrai au tout
          début du chantier, faux depuis la connexion réelle des neuf écrans
          (06-09/09/2026). Retiré plutôt que réécrit : rien à annoncer ici
          qu'un gérant du centre pilote a besoin de savoir. */}
      <div className="cm-head">
        <b>Moubarat CRM</b>
      </div>

      {subscription ? <SubscriptionBanner status={subscription.status} dueAt={subscription.dueAt} /> : null}
      {/* ONB-2 (27/09/2026) : « prêt à publier » du centre — relu à chaque changement d'écran (corriger un point dans
          Centre puis revenir au Dashboard fait disparaître le bandeau), jamais fermable, comme SubscriptionBanner. */}
      <ReadinessBanner
        venueId={venue.id} token={token} role={role} refreshKey={view}
        onOpenCentre={() => setView('conf')} onToast={showToast}
      />

      <div className="cm-app">
        <div className="cm-top">
          <div className="cm-brand">
            <b>{venue.name}</b>
            <span>{[venue.wilaya, venue.address].filter((s) => s && s.trim().length > 0).join(' · ') || '—'}</span>
          </div>
          <div className="cm-right">
            <button
              type="button"
              className="mb-btn mb-btn--ghost mb-btn--sm"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            </button>
            {hasSupport(support) ? (
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setHelpOpen(true)}>Aide</button>
            ) : null}
            <i>Connecte : {accountName}</i>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setAccountOpen(true)}>Mon compte</button>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={logout}>Déconnexion</button>
          </div>
        </div>

        <div className="cm-body">
          <nav className="cm-nav">
            {NAV_ITEMS.filter((item) => item.id !== 'caisse' || modulesCaisse).map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'on' : ''}
                onClick={() => setView(item.id)}
              >
                <Icon id={item.icon} />
                {item.label}
                {item.badge ? <span className="cnt">{item.badge}</span> : null}
              </button>
            ))}
          </nav>

          <main className="cm-main">
            {view === 'dash' ? (
              <Dashboard
                role={role} venueId={venue.id} token={token}
                onOpenReservation={openInReservations}
              />
            ) : view === 'plan' ? (
              <Planning
                role={role} venueId={venue.id} token={token} onToast={showToast}
                openRequest={planningOpen} onOpenReservation={openInReservations}
              />
            ) : view === 'resa' ? (
              <Reservations
                role={role} venueId={venue.id} token={token} onToast={showToast}
                openRequest={resaOpen} onOpenPlanning={openInPlanning}
              />
            ) : view === 'subs' ? (
              <Abonnements role={role} venueId={venue.id} token={token} onToast={showToast} />
            ) : view === 'stats' ? (
              <Analytics venueId={venue.id} token={token} />
            ) : view === 'clients' ? (
              <Clients venueId={venue.id} token={token} onOpenReservation={(id, date) => openInReservations(id, date)} />
            ) : view === 'teams' ? (
              <Equipes venueId={venue.id} token={token} />
            ) : view === 'staff' ? (
              <Personnel role={role} venueId={venue.id} token={token} onToast={showToast} />
            ) : view === 'caisse' && modulesCaisse ? (
              <Caisse role={role} venueId={venue.id} token={token} onToast={showToast} />
            ) : view === 'audit' ? (
              <Journal role={role} venueId={venue.id} token={token} />
            ) : view === 'conf' ? (
              <Centre
                role={role}
                venueId={venue.id}
                venueName={venue.name}
                token={token}
                modulesCaisse={modulesCaisse}
                onToggleCaisse={setModulesCaisse}
                onAudit={addAudit}
                onToast={showToast}
              />
            ) : null}
          </main>
        </div>
      </div>
      <Toast message={toastMsg} />
      {helpOpen && hasSupport(support) ? <HelpModal support={support} onClose={() => setHelpOpen(false)} /> : null}
      {accountOpen ? <AccountModal accountName={accountName ?? ''} token={token} onClose={() => setAccountOpen(false)} onToast={showToast} /> : null}
    </>
  );
}
