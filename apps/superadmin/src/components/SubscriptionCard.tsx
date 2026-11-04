import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

/* Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit, item 6 de la feuille de route
   post-audit) : plan/échéance/statut payé-impayé, superadmin uniquement — même patron que
   IdentityCard.tsx. AUCUNE coupure d'accès CRM : ce champ sert uniquement le bandeau du gérant
   (SubscriptionBanner.tsx côté CRM) et cette fiche. Décision volontairement non prise ici. */

export type SubscriptionPlan = 'CRM_ONLY' | 'CRM_PLUS_APP';
export type SubscriptionStatus = 'PAID' | 'UNPAID';

export interface VenueSubscription {
  id: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionDueAt: string | null;
}

const PLAN_LABELS: Record<SubscriptionPlan, string> = { CRM_ONLY: 'CRM seul', CRM_PLUS_APP: 'CRM + app joueur' };
const STATUS_LABELS: Record<SubscriptionStatus, string> = { PAID: 'À jour', UNPAID: 'Impayé' };

function toForm(v: VenueSubscription) {
  return {
    plan: v.subscriptionPlan, status: v.subscriptionStatus,
    dueAt: v.subscriptionDueAt ? v.subscriptionDueAt.slice(0, 10) : '',
  };
}

export function SubscriptionCard({ token, venue, onSaved }: { token: string; venue: VenueSubscription; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(venue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit() { setForm(toForm(venue)); setError(null); setNotice(null); setEditing(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await apiFetch(`/platform/venues/${venue.id}/subscription`, {
        method: 'PATCH', token,
        body: { plan: form.plan, status: form.status, dueAt: form.dueAt ? `${form.dueAt}T00:00:00.000Z` : null },
      });
      setEditing(false);
      setNotice('Abonnement enregistré — le gérant voit un bandeau dans son CRM si impayé ou proche de l’échéance.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sa-card" data-testid="subscription-card">
      <div className="sa-view-head">
        <p className="sa-sec">— ABONNEMENT</p>
        {editing ? null : (
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={startEdit}>Modifier l’abonnement</button>
        )}
      </div>

      {notice && !editing ? <p className="sa-view-note" role="status">{notice}</p> : null}

      {editing ? (
        <form className="sa-create-form" onSubmit={(e) => { void save(e); }}>
          <div className="sa-form-grid">
            <label className="mb-field">
              <span className="mb-field__label">Plan</span>
              <select className="mb-field__control" value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as SubscriptionPlan }))}>
                <option value="CRM_ONLY">{PLAN_LABELS.CRM_ONLY}</option>
                <option value="CRM_PLUS_APP">{PLAN_LABELS.CRM_PLUS_APP}</option>
              </select>
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Statut</span>
              <select className="mb-field__control" value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as SubscriptionStatus }))}>
                <option value="PAID">{STATUS_LABELS.PAID}</option>
                <option value="UNPAID">{STATUS_LABELS.UNPAID}</option>
              </select>
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Échéance (optionnel)</span>
              <input className="mb-field__control" type="date" value={form.dueAt}
                onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} />
            </label>
          </div>
          {error ? <p className="mb-field__error" role="alert">{error}</p> : null}
          <div className="sa-actions__row">
            <button type="submit" className="mb-btn mb-btn--sm" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={saving} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </form>
      ) : (
        <dl className="sa-facts">
          <dt>Plan</dt><dd>{PLAN_LABELS[venue.subscriptionPlan]}</dd>
          <dt>Statut</dt>
          <dd><span className={`sa-badge sa-badge--${venue.subscriptionStatus === 'PAID' ? 'active' : 'suspended'}`}>{STATUS_LABELS[venue.subscriptionStatus]}</span></dd>
          <dt>Échéance</dt><dd>{venue.subscriptionDueAt ? new Date(venue.subscriptionDueAt).toLocaleDateString('fr-FR') : '—'}</dd>
        </dl>
      )}
    </div>
  );
}
