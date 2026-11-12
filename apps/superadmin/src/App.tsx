import { useCallback, useEffect, useState } from 'react';
import { IconSprite } from './components/IconSprite.js';
import { LoginScreen } from './components/LoginScreen.js';
import { Dashboard } from './components/Dashboard.js';
import { Centres } from './components/Centres.js';
import { Demandes } from './components/Demandes.js';
import type { CreatePrefill } from './lib/requests.js';
import { CentreDetail } from './components/CentreDetail.js';
import { Utilisateurs } from './components/Utilisateurs.js';
import { Matchs } from './components/Matchs.js';
import { Reservations } from './components/Reservations.js';
import { Journal } from './components/Journal.js';
import { Signalements } from './components/Signalements.js';
import { AccountPanel } from './components/AccountPanel.js';
import { apiFetch, setUnauthorizedHandler } from './lib/api.js';
import { loadToken, saveToken, clearToken } from './lib/session.js';
import { BOOT_RETRY_MS, bootFailureAction } from './lib/bootSession.js';

type View = 'dashboard' | 'centres' | 'demandes' | 'centre-detail' | 'utilisateurs' | 'matchs' | 'reservations' | 'journal' | 'signalements';

interface MeResponse { account: { id: string; email: string; name: string; isSuperadmin: boolean } }

/* Bootstrap : "connecté ?" = jeton présent ET accepté par le serveur
   (GET /platform/auth/me), jamais la seule présence locale — même principe
   que apps/player. */
export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  /** MS-040 : le serveur ne répond pas au démarrage — la session est gardée, l'écran le dit et réessaie tout seul. */
  const [serverDown, setServerDown] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [openAddStaff, setOpenAddStaff] = useState(false);
  /* Badge « Demandes » (20/09/2026) : nouvelles demandes d'inscription, relues toutes les 60 s tant que la
     console est ouverte (pas de temps réel en V1) et après chaque action sur une demande. */
  const [newRequests, setNewRequests] = useState(0);
  /* Badge « Signalements » (audit 26/10, P1-10) : signalements joueurs à traiter, relus toutes les 60 s comme les demandes. */
  const [openReports, setOpenReports] = useState(0);
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);
  /* ONB-1 (27/09/2026) : « Mon compte » — changer son propre mot de passe, au-dessus de la vue courante. */
  const [accountOpen, setAccountOpen] = useState(false);

  const refreshRequestCount = useCallback(() => {
    if (!token) return;
    apiFetch<{ new: number }>('/platform/venue-requests/count', { token }).then((r) => setNewRequests(r.new)).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) { setNewRequests(0); return; }
    refreshRequestCount();
    const id = window.setInterval(refreshRequestCount, 60_000);
    return () => window.clearInterval(id);
  }, [token, refreshRequestCount]);

  const refreshReportCount = useCallback(() => {
    if (!token) return;
    apiFetch<{ open: number }>('/platform/reports/count', { token }).then((r) => setOpenReports(r.open)).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) { setOpenReports(0); return; }
    refreshReportCount();
    const id = window.setInterval(refreshReportCount, 60_000);
    return () => window.clearInterval(id);
  }, [token, refreshReportCount]);

  useEffect(() => {
    setUnauthorizedHandler(() => { clearToken(); setToken(null); setAccountName(null); });
    const stored = loadToken();
    if (!stored) { setChecking(false); return; }
    // MS-040 (audit final) : une panne (réseau, 5xx) garde la session et se réessaie ; seul un refus la jette.
    let cancelled = false;
    let retry: number | undefined;
    const check = () => apiFetch<MeResponse>('/platform/auth/me', { token: stored })
      .then((r) => {
        if (cancelled) return;
        setServerDown(false);
        if (!r.account.isSuperadmin) { clearToken(); setChecking(false); return; }
        setToken(stored); setAccountName(r.account.name); setChecking(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (bootFailureAction(e) === 'retry') { setServerDown(true); retry = window.setTimeout(() => { void check(); }, BOOT_RETRY_MS); return; }
        clearToken(); setChecking(false);
      });
    void check();
    return () => { cancelled = true; if (retry !== undefined) window.clearTimeout(retry); setUnauthorizedHandler(null); };
  }, []);

  function handleLoggedIn(newToken: string) {
    saveToken(newToken);
    setToken(newToken);
    apiFetch<MeResponse>('/platform/auth/me', { token: newToken }).then((r) => setAccountName(r.account.name)).catch(() => {});
  }

  async function logout() {
    if (token) await apiFetch('/platform/auth/logout', { method: 'POST', token }).catch(() => {});
    clearToken();
    setToken(null);
    setAccountName(null);
  }

  if (checking) {
    // MS-040 (audit final) : pendant une panne au démarrage, un message plutôt qu'un écran vide — la session est gardée.
    return serverDown ? (
      <div className="sa-login" role="status" aria-live="polite">
        <div className="sa-login__card">
          <p className="sa-login__eyebrow">— MOUBARAT</p>
          <h1 className="sa-login__title">Serveur injoignable</h1>
          <p className="sa-login__text">Le serveur de Moubarat ne répond pas pour l’instant (mise à jour ou panne). Ta session est gardée : nouvel essai automatique toutes les 5 secondes.</p>
        </div>
      </div>
    ) : null;
  }
  if (!token) return (<><IconSprite /><LoginScreen onLoggedIn={handleLoggedIn} /></>);

  return (
    <>
      <IconSprite />
      <div className="sa-head">
        <b>Moubarat — Console plateforme</b>
        <i>Supervision et modération de l’écosystème — SUPERADMIN uniquement.</i>
      </div>
      <div className="sa-app">
        <div className="sa-top">
          <div className="sa-brand"><b>MOUBARAT</b><span>Backoffice</span></div>
          <div className="sa-right">
            <span className="sa-who">Connecté : {accountName}</span>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" aria-pressed={accountOpen} onClick={() => setAccountOpen((v) => !v)}>Mon compte</button>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={logout}>Déconnexion</button>
          </div>
        </div>
        <div className="sa-body">
          <nav className="sa-nav">
            <button type="button" className={view === 'dashboard' ? 'on' : ''} onClick={() => setView('dashboard')}>Dashboard</button>
            <button type="button" className={view === 'centres' || view === 'centre-detail' ? 'on' : ''} onClick={() => setView('centres')}>Centres</button>
            <button type="button" className={view === 'demandes' ? 'on' : ''} onClick={() => setView('demandes')}>
              Demandes{newRequests > 0 ? <span className="sa-nav-badge" aria-label={`${newRequests} nouvelle${newRequests > 1 ? 's' : ''} demande${newRequests > 1 ? 's' : ''}`}>{newRequests}</span> : null}
            </button>
            <button type="button" className={view === 'utilisateurs' ? 'on' : ''} onClick={() => setView('utilisateurs')}>Utilisateurs</button>
            <button type="button" className={view === 'matchs' ? 'on' : ''} onClick={() => setView('matchs')}>Matchs</button>
            <button type="button" className={view === 'reservations' ? 'on' : ''} onClick={() => setView('reservations')}>Réservations</button>
            <button type="button" className={view === 'signalements' ? 'on' : ''} onClick={() => setView('signalements')}>
              Signalements{openReports > 0 ? <span className="sa-nav-badge" aria-label={`${openReports} signalement${openReports > 1 ? 's' : ''} à traiter`}>{openReports}</span> : null}
            </button>
            <button type="button" className={view === 'journal' ? 'on' : ''} onClick={() => setView('journal')}>Journal</button>
          </nav>
          <main className="sa-main">
            {accountOpen ? <AccountPanel accountName={accountName ?? ''} token={token} onClose={() => setAccountOpen(false)} /> : null}
            {view === 'dashboard' ? <Dashboard token={token} />
              : view === 'centres' ? <Centres
                token={token} prefill={prefill} onPrefillUsed={() => setPrefill(null)} onRequestsChanged={refreshRequestCount}
                onOpen={(id, opts) => { setSelectedVenueId(id); setOpenAddStaff(opts?.addStaff === true); setView('centre-detail'); }}
              />
              : view === 'demandes' ? (
                <Demandes
                  token={token} onChanged={refreshRequestCount}
                  onCreateVenue={(p) => { setPrefill(p); setView('centres'); }}
                  onOpenVenue={(id) => { setSelectedVenueId(id); setOpenAddStaff(false); setView('centre-detail'); }}
                />
              )
              : view === 'utilisateurs' ? <Utilisateurs token={token} />
              : view === 'matchs' ? <Matchs token={token} />
              : view === 'reservations' ? <Reservations token={token} />
              : view === 'signalements' ? <Signalements token={token} onChanged={refreshReportCount} />
              : view === 'journal' ? <Journal token={token} />
              : selectedVenueId ? <CentreDetail key={selectedVenueId} token={token} venueId={selectedVenueId} onBack={() => setView('centres')} openAddStaff={openAddStaff} />
              : null}
          </main>
        </div>
      </div>
    </>
  );
}
