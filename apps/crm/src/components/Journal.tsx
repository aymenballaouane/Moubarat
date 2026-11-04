import { useCallback, useEffect, useState } from 'react';
import { canCenterAct, type CenterRole, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import { auditTimeLabel, roleLabel } from '../lib/auditDetail.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { Icon } from './Icon.js';

interface JournalProps { role: CenterRole; venueId: string; token: string }

interface ApiAuditEntry { id: string; actorName: string; actorRole: string; summary: string; at: string }

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/* Chantier CRM — écran Journal (06/09/2026) : lecture réelle via
   GET /venues/:venueId/audit-log — plus jamais AUDIT_SEED ni le journal
   local (`auditLog`/`onAudit`, App.tsx), qui restait purement en mémoire,
   jamais persisté. Le vrai journal (`audit_log`, append-only) existe déjà
   côté serveur et reçoit déjà des écritures réelles (réservations comptoir,
   Centre, Caisse) — cet écran ne fait plus que les lire. */
export function Journal({ role, venueId, token }: JournalProps) {
  const canView = canCenterAct(role, 'VIEW_AUDIT_LOG').ok;

  const [entries, setEntries] = useState<ApiAuditEntry[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  /* L3 (mise à l'échelle, 25/09/2026) : le journal arrive par pages de 50 (« Afficher plus ») — un centre actif en
     écrit des milliers, la boîte noire ne se charge plus d'un bloc. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await apiFetch<{ entries: ApiAuditEntry[]; nextCursor: string | null }>(
        `/venues/${venueId}/audit-log?limit=50&cursor=${encodeURIComponent(nextCursor)}`, { token });
      setEntries((cur) => {
        const known = new Set(cur.map((e) => e.id));
        return [...cur, ...res.entries.filter((e) => !known.has(e.id))];
      });
      setNextCursor(res.nextCursor);
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  const fetchLog = useCallback(async () => {
    setLoad({ kind: 'loading' });
    setMoreError(null);
    try {
      const res = await apiFetch<{ entries: ApiAuditEntry[]; nextCursor: string | null }>(`/venues/${venueId}/audit-log?limit=50`, { token });
      setEntries(res.entries);
      setNextCursor(res.nextCursor);
      setLoad({ kind: 'ready' });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : GENERIC_ERROR_MESSAGE });
    }
  }, [venueId, token]);

  useEffect(() => { if (canView) void fetchLog(); }, [canView, fetchLog]);

  if (!canView) {
    return (
      <section className="cm-view on">
        <div className="cm-riskrow">
          <span className="t">
            <b><Icon id="i-lock" /> Le journal d'audit se consulte en Manager</b>
            <span className="cm-note" style={{ margin: '2px 0 0' }}>Chaque action y est déjà enregistrée — demande à un manager du centre d'y accéder.</span>
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="cm-view on">
      <p className="cm-view-note">
        <b>À quoi sert le journal ?</b> C'est la boîte noire du centre — aucune action à faire ici, il <b>enregistre</b> tout
        seul les gestes sensibles (création, déplacement, annulation, blocage, caisse, présence) et répond à
        « qui a bloqué le T2 mercredi ? ». Lecture seule, par nature.
      </p>
      <p className="cm-sec">Chaque action sensible, signée et horodatée</p>
      {load.kind === 'error' ? (
        <div className="cm-card cf-sec">
          <p className="cf-state">{load.message}</p>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void fetchLog(); }}>Réessayer</button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="cm-card cf-sec"><p className="cf-state">Chargement du journal…</p></div>
      ) : entries.length === 0 ? (
        <p className="cm-note">Aucune action sensible pour l'instant.</p>
      ) : entries.map((e) => (
        <div className="cm-mvt" key={e.id}>
          <b>{e.actorName} · {roleLabel(e.actorRole)} · {auditTimeLabel(e.at)}</b>
          <span> — {e.summary}</span>
        </div>
      ))}
      {load.kind === 'ready' && nextCursor !== null ? (
        <div className="cm-more">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
            {loadingMore ? 'Chargement…' : 'Afficher plus'}
          </button>
          {moreError ? <p className="cf-state" role="alert">{moreError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
