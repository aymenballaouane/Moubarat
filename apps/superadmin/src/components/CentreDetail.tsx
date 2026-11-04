import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { StatusBadge, type VenueSummary } from './Centres.js';
import { StaffCard } from './StaffCard.js';
import { IdentityCard } from './IdentityCard.js';
import { SubscriptionCard, type SubscriptionPlan, type SubscriptionStatus } from './SubscriptionCard.js';
import { ACTIVATING_ACTIONS, blockingMissing, signaledAtLabel, type VenueReadinessDetail } from '../lib/readiness.js';

interface VenueDetail {
  id: string; name: string; wilaya: string; address: string;
  lat: number; lng: number; phone: string | null; description: string | null; bookingPrefix: string;
  equipments: string[]; status: VenueSummary['status']; createdAt: string;
  fields: { id: string; name: string; sport: string; formatPrices: { format: string; hourlyRateDa: number }[]; status: string }[];
  openingHours: { weekday: number; startMin: number; endMin: number }[];
  activity: { bookingCount: number; matchCount: number; staffCount: number };
  subscriptionPlan: SubscriptionPlan; subscriptionStatus: SubscriptionStatus; subscriptionDueAt: string | null;
  /** A9 (24/09/2026) : « prêt à publier » évalué par le serveur — mêmes points que ceux qui bloquent la validation. */
  readiness: VenueReadinessDetail;
  /** ONB-2 (27/09/2026) : dernier « Signaler que c'est prêt » du gérant (ISO), ou null. */
  readySignaledAt: string | null;
}

type Action = 'approve' | 'reject' | 'suspend' | 'reactivate';

const ACTION_LABEL: Record<Action, string> = {
  approve: 'Valider ce centre', reject: 'Refuser ce centre',
  suspend: 'Suspendre ce centre', reactivate: 'Réactiver ce centre',
};
const ACTIONS_BY_STATUS: Record<VenueSummary['status'], Action[]> = {
  PENDING: ['approve', 'reject'], ACTIVE: ['suspend'], SUSPENDED: ['reactivate'], REJECTED: [],
};
const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const suffix = min >= 1440 ? ' (+1)' : '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${suffix}`;
}

interface CentreDetailProps {
  token: string;
  venueId: string;
  onBack: () => void;
  /** Arrivée depuis la création d'un centre : le formulaire « ajouter le compte du gérant » est déjà ouvert. */
  openAddStaff?: boolean;
}

export function CentreDetail({ token, venueId, onBack, openAddStaff = false }: CentreDetailProps) {
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function load() {
    setError(null);
    apiFetch<{ venue: VenueDetail }>(`/platform/venues/${venueId}`, { token })
      .then((d) => setVenue(d.venue))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }
  useEffect(load, [token, venueId]);

  async function confirmAction(action: Action) {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/platform/venues/${venueId}/${action}`, { method: 'POST', token });
      setPendingAction(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action impossible.');
      // Le serveur a peut-être vu un état plus récent (terrain archivé entre-temps) : la fiche « prêt à publier » se recale.
      if (err instanceof ApiError && err.code === 'VENUE_NOT_READY') { setPendingAction(null); load(); }
    } finally {
      setBusy(false);
    }
  }

  if (error) return (<section><button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onBack}>← Centres</button><p className="sa-error">{error}</p></section>);
  if (!venue) return <p className="sa-loading">Chargement…</p>;

  const available = ACTIONS_BY_STATUS[venue.status];
  const notReady = !venue.readiness.ready;
  const blockedActivation = notReady && available.some((a) => ACTIVATING_ACTIONS.includes(a));

  return (
    <section>
      <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onBack}>← Centres</button>

      <div className="sa-detail-head">
        <div>
          <h2 className="sa-detail-title">{venue.name}</h2>
          <p className="sa-detail-sub">{venue.wilaya} · {venue.address}</p>
        </div>
        <StatusBadge status={venue.status} />
      </div>

      <div className="sa-cards">
        <div className="sa-card"><span className="sa-card__label">Réservations</span><span className="sa-card__value">{venue.activity.bookingCount}</span></div>
        <div className="sa-card"><span className="sa-card__label">Matchs</span><span className="sa-card__value">{venue.activity.matchCount}</span></div>
        <div className="sa-card"><span className="sa-card__label">Équipe centre</span><span className="sa-card__value">{venue.activity.staffCount}</span></div>
        <div className="sa-card"><span className="sa-card__label">Terrains</span><span className="sa-card__value">{venue.fields.length}</span></div>
      </div>

      <IdentityCard token={token} venue={venue} onSaved={load} />

      <SubscriptionCard token={token} venue={venue} onSaved={load} />

      {venue.status !== 'REJECTED' ? (
        <div className="sa-card" data-testid="readiness-card">
          <p className="sa-sec">— PRÊT À PUBLIER</p>
          <ul className="sa-checklist">
            {venue.readiness.checks.map((c) => (
              <li key={c.code} className={`sa-checklist__row${c.ok ? '' : c.blocking ? ' is-blocking' : ' is-advice'}`} data-check={c.code}>
                <span className={`sa-dot sa-dot--${c.ok ? 'active' : c.blocking ? 'suspended' : 'pending'}`} aria-hidden="true" />
                <span className="sa-checklist__label">{c.label}</span>
                <span className="sa-checklist__state">{c.ok ? 'OK' : c.blocking ? 'Manquant' : 'Recommandé'}</span>
                {!c.ok && c.missing ? <span className="sa-checklist__detail">{c.missing}</span> : null}
              </li>
            ))}
          </ul>
          {venue.status === 'ACTIVE' && notReady ? (
            <p className="mb-field__error" role="status">Ce centre est actif mais n’apparaît pas dans l’app joueur tant que les points manquants ne sont pas réglés.</p>
          ) : venue.status === 'ACTIVE' ? (
            <p className="sa-text" role="status">Ce centre est publié : il apparaît dans l’app joueur.</p>
          ) : notReady ? (
            <p className="sa-view-note" role="status">Les terrains, tarifs et horaires se configurent par le gérant, dans le CRM. Les recommandations n’empêchent rien.</p>
          ) : venue.readySignaledAt ? (
            <p className="sa-text" role="status" data-testid="ready-signaled">Prêt — <b>le gérant a signalé que le centre est prêt {signaledAtLabel(venue.readySignaledAt)}</b> : il attend la validation.</p>
          ) : (
            <p className="sa-text" role="status">Prêt : rien n’empêche la publication de ce centre.</p>
          )}
        </div>
      ) : null}

      {available.length > 0 ? (
        <div className="sa-card sa-actions">
          <p className="sa-sec">— MODÉRATION</p>
          {actionError ? <p className="mb-field__error">{actionError}</p> : null}
          <div className="sa-actions__row">
            {available.map((action) => (
              pendingAction === action ? (
                <span key={action} className="sa-confirm">
                  <span>Confirmer — {ACTION_LABEL[action]} ?</span>
                  <button type="button" className={`mb-btn mb-btn--sm${action === 'reject' || action === 'suspend' ? ' mb-btn--danger' : ''}`}
                    disabled={busy} onClick={() => confirmAction(action)}>
                    {busy ? '…' : 'Oui, confirmer'}
                  </button>
                  <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={busy} onClick={() => setPendingAction(null)}>Annuler</button>
                </span>
              ) : (
                <button key={action} type="button"
                  className={`mb-btn mb-btn--sm${action === 'reject' || action === 'suspend' ? ' mb-btn--danger' : ' mb-btn--secondary'}`}
                  disabled={notReady && ACTIVATING_ACTIONS.includes(action)}
                  onClick={() => setPendingAction(action)}>
                  {ACTION_LABEL[action]}
                </button>
              )
            ))}
          </div>
          {blockedActivation ? (
            <p className="sa-view-note" role="status" data-testid="activation-blocked" style={{ marginTop: 10, marginBottom: 0 }}>
              Activation impossible tant qu’il manque : {blockingMissing(venue.readiness).join(' ; ')}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="sa-empty">Décision terminale — aucune action de modération disponible pour un centre refusé.</p>
      )}

      <StaffCard token={token} venueId={venueId} venueName={venue.name} onChanged={load} initialShowForm={openAddStaff} />

      <div className="sa-card">
        <p className="sa-sec">— TERRAINS ({venue.fields.length})</p>
        {venue.fields.length === 0 ? <p className="sa-empty">Aucun terrain configuré.</p> : (
          <table className="sa-table">
            <thead><tr><th>Nom</th><th>Sport</th><th>Tarif</th><th>Statut</th></tr></thead>
            <tbody>
              {venue.fields.map((f) => (
                <tr key={f.id}><td>{f.name}</td><td>{f.sport}</td><td>{f.formatPrices.length === 0 ? '—' : f.formatPrices.map((p) => `${p.format} ${p.hourlyRateDa}`).join(' · ')} DA/h</td><td>{f.status}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sa-card">
        <p className="sa-sec">— HORAIRES</p>
        {venue.openingHours.length === 0 ? <p className="sa-empty">Aucun horaire configuré.</p> : (
          <ul className="sa-hours">
            {venue.openingHours.map((h) => (
              <li key={h.weekday}><span>{DAY_NAMES[h.weekday]}</span><span>{hhmm(h.startMin)} → {hhmm(h.endMin)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
