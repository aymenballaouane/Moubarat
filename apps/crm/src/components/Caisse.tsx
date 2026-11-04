import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, type CenterRole, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import { auditTimeLabel } from '../lib/auditDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Icon } from './Icon.js';
import { ConfirmModal } from './ConfirmModal.js';

interface CaisseProps { role: CenterRole; venueId: string; token: string; onToast: (message: string) => void }

interface ApiCashSession {
  id: string; openedBy: string; openedByName: string; openedAt: number;
  openingFloatDa: number; status: 'OPEN' | 'CLOSED';
  closedBy: string | null; closedByName: string | null; closedAt: number | null; declaredClosingDa: number | null;
}
interface ApiCashMovement {
  id: string; kind: 'COLLECTION' | 'PAYOUT'; amountDa: number;
  byUserId: string; byUserName: string; at: number; ref: string | null; note: string | null;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

function epochLabel(epochMs: number): string {
  return auditTimeLabel(new Date(epochMs).toISOString());
}

/* Chantier CRM Caisse (06/09/2026) : lecture/écriture réelles via
   GET/POST /venues/:venueId/cash/* — plus jamais openCashSession/
   addCashMovement/cashExpected/closeCashSession appelées directement dans
   le navigateur (elles restent les seules décisionnaires, mais côté
   serveur désormais — apps/api/src/modules/cash/service.ts fait exactement
   ça). Une seule caisse ouverte à la fois est déjà vérifiée serveur
   (contrainte SQL + contrôle applicatif, modules/cash/routes.ts) : plus de
   `hasOpenSession` simulé ici, une ouverture refusée (400/409) recharge
   juste l'état réel plutôt que d'afficher une erreur sèche.

   Deux écarts trouvés et comblés à ce chantier (validés par Aymen) :
   1. L'écran ne savait créer que des sorties (PAYOUT), jamais un
      encaissement (COLLECTION) — pourtant strictement symétrique côté
      serveur/core. Le texte vide promettait aussi un lien automatique avec
      Réservations qui n'a jamais existé, ni côté serveur ni même dans
      l'ancienne démo locale — remplacé par une note explicite (ci-dessous)
      qui dit noir sur blanc qu'il n'y a AUCUN lien automatique.
   2. `openedBy`/`closedBy`/`byUserId` sont des ids de compte plateforme
      bruts côté serveur — noms réels résolus par l'API
      (`resolveActorNames`, lib/actor-names.ts — MÊME fonction que Journal,
      y compris le fallback « Compte supprimé »), jamais recalculés ici. */
export function Caisse({ role, venueId, token, onToast }: CaisseProps) {
  const canCash = canCenterAct(role, 'CASH_SESSION').ok;

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [session, setSession] = useState<ApiCashSession | null>(null);
  const [moves, setMoves] = useState<ApiCashMovement[]>([]);
  const [expected, setExpected] = useState(0);
  const [lastClosed, setLastClosed] = useState<ApiCashSession | null>(null);

  const [floatInput, setFloatInput] = useState('50000');
  const [openError, setOpenError] = useState<string | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectRef, setCollectRef] = useState('');
  const [outAmount, setOutAmount] = useState('');
  const [outNote, setOutNote] = useState('');
  const [declared, setDeclared] = useState('');
  const [closeModal, setCloseModal] = useState<{ expected: number; declared: number } | null>(null);

  const fetchCurrent = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const res = await apiFetch<{ session: ApiCashSession | null; movements?: ApiCashMovement[]; expectedDa?: number }>(
        `/venues/${venueId}/cash/sessions/current`, { token },
      );
      setSession(res.session);
      setMoves(res.movements ?? []);
      setExpected(res.expectedDa ?? 0);
      if (!res.session) {
        const hist = await apiFetch<{ sessions: ApiCashSession[] }>(`/venues/${venueId}/cash/sessions`, { token });
        setLastClosed(hist.sessions.find((s) => s.status === 'CLOSED') ?? null);
      }
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token]);

  useEffect(() => { if (canCash) void fetchCurrent(); }, [canCash, fetchCurrent]);

  if (!canCash) {
    return (
      <section className="cm-view on">
        <div className="cm-riskrow">
          <span className="t">
            <b><Icon id="i-lock" /> La caisse se gère en Réception (ou plus)</b>
            <span className="cm-note" style={{ margin: '2px 0 0' }}>Le Staff pointe les présences, il ne touche pas à l'argent.</span>
          </span>
        </div>
      </section>
    );
  }

  async function handleOpen() {
    setOpenError(null);
    const f = Math.max(0, Number(floatInput) || 0);
    try {
      await apiFetch(`/venues/${venueId}/cash/sessions`, { method: 'POST', token, body: { openingFloatDa: f } });
      onToast('Caisse ouverte.');
      await fetchCurrent();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_TARGET') {
        // Une caisse est déjà ouverte (double-clic, autre poste) — l'état
        // réel prime, jamais une erreur sèche pour un refus attendu.
        await fetchCurrent();
      } else {
        setOpenError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
      }
    }
  }

  async function handleMovement(kind: 'COLLECTION' | 'PAYOUT', amountStr: string, extra: { ref?: string; note?: string }, reset: () => void) {
    const a = Number(amountStr);
    if (!Number.isInteger(a) || a <= 0) {
      onToast('Un mouvement de caisse est toujours un montant entier strictement positif.');
      return;
    }
    try {
      await apiFetch(`/venues/${venueId}/cash/movements`, { method: 'POST', token, body: { kind, amountDa: a, ...extra } });
      reset();
      await fetchCurrent();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    }
  }

  function askClose() {
    if (!session) return;
    setCloseModal({ expected, declared: Number(declared) || 0 });
  }

  async function confirmClose() {
    if (!session || !closeModal) return;
    try {
      await apiFetch(`/venues/${venueId}/cash/sessions/${session.id}/close`, {
        method: 'POST', token, body: { declaredClosingDa: closeModal.declared },
      });
      onToast('Caisse clôturée.');
      setDeclared('');
      setCloseModal(null);
      await fetchCurrent();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
      setCloseModal(null);
    }
  }

  if (load.kind === 'error') {
    return (
      <section className="cm-view on">
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchCurrent(); }}>Réessayer</button>
        </div>
      </section>
    );
  }
  if (load.kind === 'loading') {
    return <section className="cm-view on"><div className="cm-card cf-sec"><p className="cf-state">Chargement de la caisse…</p></div></section>;
  }

  if (!session) {
    return (
      <section className="cm-view on">
        <div className="cm-card">
          <p className="cm-sec">Ouvrir la caisse du jour</p>
          <div className="cm-sub" style={{ border: 0, padding: 0, margin: 0 }}>
            <label>
              <span>Fonds d'ouverture (DA)</span>
              <input className="mb-field__control" style={{ maxWidth: 140 }} value={floatInput} onChange={(e) => setFloatInput(e.target.value)} />
            </label>
            <button type="button" className="mb-btn mb-btn--sm" onClick={() => { void handleOpen(); }}>Ouvrir la caisse</button>
          </div>
          {openError ? <p className="cm-note" style={{ color: 'var(--danger)' }}>{openError}</p> : null}
          {lastClosed ? (
            <p className="cm-note">
              Dernière clôture : {epochLabel(lastClosed.closedAt!)} · attendu {fmt(lastClosed.declaredClosingDa ?? 0)} DA{' '}
              par {lastClosed.closedByName}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        Encaisser ici (mouvement de caisse) et marquer une réservation « Payée » dans Réservations sont deux actions
        séparées, sans lien automatique entre elles. Pour que la caisse ET le suivi des réservations soient à jour,
        il faut faire les deux — l'une ne déclenche jamais l'autre.
      </p>
      <div className="cm-caisse-grid">
        <div className="cm-card">
          <p className="cm-sec">Caisse ouverte · par {session.openedByName} à {epochLabel(session.openedAt)}</p>
          <div className="cm-line"><span>Fonds d'ouverture</span><b>{fmt(session.openingFloatDa)} DA</b></div>
          <div className="cm-line"><span>Attendu en caisse</span><b style={{ color: 'var(--gold)' }}>{fmt(expected)} DA</b></div>
          <div style={{ marginTop: 8 }}>
            {moves.length ? moves.map((m) => (
              <div className="cm-mvt" key={m.id}>
                <b className={m.kind === 'PAYOUT' ? 'out' : ''}>{m.kind === 'PAYOUT' ? '−' : '+'} {fmt(m.amountDa)} DA</b>
                <span>{m.ref ?? m.note ?? ''}</span>
                <span style={{ marginLeft: 'auto' }}>{m.byUserName} · {epochLabel(m.at)}</span>
              </div>
            )) : <p className="cm-note">Aucun mouvement pour l'instant.</p>}
          </div>
          <div className="cm-sub">
            <label><span>Encaissement (DA)</span><input className="mb-field__control" placeholder="4500" style={{ maxWidth: 110 }} value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} /></label>
            <label><span>Référence</span><input className="mb-field__control" placeholder="RYD-0482" style={{ maxWidth: 140 }} value={collectRef} onChange={(e) => setCollectRef(e.target.value)} /></label>
            <button type="button" className="mb-btn mb-btn--sm" onClick={() => {
              void handleMovement('COLLECTION', collectAmount, collectRef.trim() ? { ref: collectRef.trim() } : {}, () => { setCollectAmount(''); setCollectRef(''); });
            }}>
              Enregistrer l'encaissement
            </button>
          </div>
          <div className="cm-sub">
            <label><span>Sortie (DA)</span><input className="mb-field__control" placeholder="20000" style={{ maxWidth: 110 }} value={outAmount} onChange={(e) => setOutAmount(e.target.value)} /></label>
            <label><span>Motif</span><input className="mb-field__control" placeholder="Achat filets" style={{ maxWidth: 160 }} value={outNote} onChange={(e) => setOutNote(e.target.value)} /></label>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => {
              void handleMovement('PAYOUT', outAmount, outNote.trim() ? { note: outNote.trim() } : {}, () => { setOutAmount(''); setOutNote(''); });
            }}>
              Enregistrer la sortie
            </button>
          </div>
        </div>
        <div className="cm-card">
          <p className="cm-sec">Clôturer</p>
          <div className="cm-sub" style={{ border: 0, padding: 0, margin: 0 }}>
            <label>
              <span>Montant compté (DA)</span>
              <input className="mb-field__control" placeholder={String(expected)} style={{ maxWidth: 140 }} value={declared} onChange={(e) => setDeclared(e.target.value)} />
            </label>
            <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" onClick={askClose}>Clôturer la caisse</button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={closeModal !== null}
        title="Clôturer la caisse ?"
        confirmLabel="Clôturer"
        body={closeModal ? (
          <>
            <p>Attendu : <b>{fmt(closeModal.expected)} DA</b> · Compté : <b>{fmt(closeModal.declared)} DA</b></p>
            <p className={closeModal.declared - closeModal.expected === 0 ? '' : 'impact'}>
              Écart : {fmt(closeModal.declared - closeModal.expected)} DA{closeModal.declared - closeModal.expected === 0 ? ' — caisse juste.' : ''}
            </p>
          </>
        ) : null}
        onConfirm={() => { void confirmClose(); }}
        onCancel={() => setCloseModal(null)}
      />
    </section>
  );
}
