import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import {
  prefillFromRequest, sportsLabel, type CreatePrefill, type RequestCounts, type RequestStatus, type VenueRequest,
} from '../lib/requests.js';

/* Demandes d'inscription d'un centre (20/09/2026) : ce que les centres envoient depuis le formulaire
   public du CRM. Rien n'est créé automatiquement — « Créer le centre » ouvre le formulaire de création
   prérempli (même flux de validation que tout centre), « Refuser » clôt la demande. */

type Tab = RequestStatus | 'ALL';
const TABS: { key: Tab; label: string; count?: keyof RequestCounts }[] = [
  { key: 'NEW', label: 'Nouvelles', count: 'new' },
  { key: 'CONVERTED', label: 'Converties', count: 'converted' },
  { key: 'REJECTED', label: 'Refusées', count: 'rejected' },
  { key: 'ALL', label: 'Toutes' },
];
const STATUS_LABEL: Record<RequestStatus, string> = { NEW: 'Nouvelle', CONVERTED: 'Convertie', REJECTED: 'Refusée' };

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Demandes({ token, onCreateVenue, onOpenVenue, onChanged }: {
  token: string;
  onCreateVenue: (prefill: CreatePrefill) => void;
  onOpenVenue: (venueId: string) => void;
  /** Le nombre de nouvelles demandes a pu changer (badge de la navigation). */
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('NEW');
  const [requests, setRequests] = useState<VenueRequest[] | null>(null);
  const [counts, setCounts] = useState<RequestCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiFetch<{ counts: RequestCounts; requests: VenueRequest[] }>(`/platform/venue-requests?status=${tab}`, { token })
      .then((d) => { setRequests(d.requests); setCounts(d.counts); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }, [token, tab]);
  useEffect(() => { setRequests(null); load(); }, [load]);

  async function reject(id: string) {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/platform/venue-requests/${id}/reject`, { method: 'POST', token });
      setConfirmReject(null);
      load(); onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refus impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="sa-view-note">
        Les centres qui demandent à être référencés depuis le formulaire public du CRM. Rien n’est créé automatiquement : vous décidez.
      </p>
      <div className="sa-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}{t.count && counts ? ` (${counts[t.count]})` : ''}
          </button>
        ))}
      </div>

      {error ? <p className="sa-error">{error}</p> : null}
      {!requests && !error ? <p className="sa-loading">Chargement…</p> : null}
      {requests && requests.length === 0 ? (
        <p className="sa-empty">{tab === 'NEW' ? 'Aucune nouvelle demande.' : 'Aucune demande dans cette catégorie.'}</p>
      ) : null}

      {requests?.map((r) => (
        <div className="sa-card sa-request" key={r.id} data-testid="venue-request">
          <div className="sa-detail-head">
            <div>
              <h3 className="sa-detail-title">{r.name}</h3>
              <p className="sa-detail-sub">{r.wilaya} · {r.address}</p>
            </div>
            <span className={`sa-badge sa-badge--${r.status === 'NEW' ? 'pending' : r.status === 'CONVERTED' ? 'active' : 'rejected'}`}>{STATUS_LABEL[r.status]}</span>
          </div>
          <dl className="sa-request__grid">
            <dt>Contact</dt>
            <dd>{r.contactName} · <a href={`tel:${r.contactPhone}`}>{r.contactPhone}</a> · <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a></dd>
            <dt>Sports</dt><dd>{sportsLabel(r.sports)}{r.fieldsCount ? ` · ${r.fieldsCount} terrain${r.fieldsCount > 1 ? 's' : ''}` : ''}</dd>
            {r.message ? (<><dt>Message</dt><dd className="sa-request__msg">{r.message}</dd></>) : null}
            <dt>Reçue le</dt><dd>{dateLabel(r.createdAt)}</dd>
          </dl>
          {r.status === 'NEW' ? (
            confirmReject === r.id ? (
              <span className="sa-confirm">
                <span>Refuser cette demande ?</span>
                <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" disabled={busy} onClick={() => { void reject(r.id); }}>{busy ? '…' : 'Oui, refuser'}</button>
                <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={busy} onClick={() => setConfirmReject(null)}>Annuler</button>
              </span>
            ) : (
              <div className="sa-actions__row">
                <button type="button" className="mb-btn mb-btn--sm" onClick={() => onCreateVenue(prefillFromRequest(r))}>Créer le centre</button>
                <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" onClick={() => setConfirmReject(r.id)}>Refuser</button>
              </div>
            )
          ) : r.status === 'CONVERTED' && r.venueId ? (
            <div className="sa-actions__row">
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => onOpenVenue(r.venueId!)}>Voir le centre{r.venueName ? ` « ${r.venueName} »` : ''}</button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
