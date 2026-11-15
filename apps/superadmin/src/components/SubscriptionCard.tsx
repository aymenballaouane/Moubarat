import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

/* Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit, item 6 de la feuille de route
   post-audit) : plan/échéance/statut payé-impayé, superadmin uniquement — même patron que
   IdentityCard.tsx. AUCUNE coupure d'accès CRM : ce champ sert uniquement le bandeau du gérant
   (SubscriptionBanner.tsx côté CRM) et cette fiche. Décision volontairement non prise ici. */

/* P0-3 et P0-4 (audit stratégique du CRM, 15/11/2026, choix d'Aymen) : une seule grille, par TAILLE du centre, tous sports
   inclus ; « Essai » = le mois d'essai, l'échéance étant alors sa fin. Prix : dans l'offre commerciale
   (docs/OFFRE-COMMERCIALE.md), jamais ici — la formule reste une étiquette, aucune fonction n'en dépend. */
export type SubscriptionPlan = 'ESSENTIEL' | 'COMPLEXE' | 'GRAND_COMPLEXE';
export type SubscriptionStatus = 'TRIAL' | 'PAID' | 'UNPAID';

export interface VenueSubscription {
  id: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionDueAt: string | null;
  /** Le palier qui correspond au nombre de terrains non archivés (calculé par l'API) — une suggestion, pas une règle. */
  suggestedPlan: SubscriptionPlan;
}

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  ESSENTIEL: 'Essentiel — 1 à 3 terrains', COMPLEXE: 'Complexe — 4 à 8 terrains', GRAND_COMPLEXE: 'Grand complexe — 9 terrains et plus',
};
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = { TRIAL: 'Essai', PAID: 'À jour', UNPAID: 'Impayé' };
const STATUS_LABELS = SUBSCRIPTION_STATUS_LABELS;
const PLAN_ORDER: SubscriptionPlan[] = ['ESSENTIEL', 'COMPLEXE', 'GRAND_COMPLEXE'];
const TRIAL_DAYS = 30;

/** Badge de statut : vert à jour, or en essai, rouge impayé (même code couleur que la liste des centres). */
export function subscriptionBadgeTone(status: SubscriptionStatus): 'active' | 'pending' | 'suspended' {
  return status === 'PAID' ? 'active' : status === 'TRIAL' ? 'pending' : 'suspended';
}

/** La date de fin d'un essai qui commence aujourd'hui (« AAAA-MM-JJ »). */
function trialEndFromToday(): string {
  return new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10);
}

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
      setNotice('Abonnement enregistré — le gérant voit un bandeau dans son CRM si impayé, ou à l’approche de l’échéance ou de la fin de l’essai.');
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
              <span className="mb-field__label">Formule</span>
              <select className="mb-field__control" value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as SubscriptionPlan }))}>
                {PLAN_ORDER.map((p) => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
              </select>
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Statut</span>
              <select className="mb-field__control" value={form.status}
                onChange={(e) => {
                  const status = e.target.value as SubscriptionStatus;
                  // Passer en essai sans date : la fin de l'essai est proposée à un mois (modifiable).
                  setForm((f) => ({ ...f, status, dueAt: status === 'TRIAL' && f.dueAt === '' ? trialEndFromToday() : f.dueAt }));
                }}>
                <option value="TRIAL">{STATUS_LABELS.TRIAL}</option>
                <option value="PAID">{STATUS_LABELS.PAID}</option>
                <option value="UNPAID">{STATUS_LABELS.UNPAID}</option>
              </select>
            </label>
            <label className="mb-field">
              <span className="mb-field__label">{form.status === 'TRIAL' ? 'Fin de l’essai' : 'Échéance (optionnel)'}</span>
              <input className="mb-field__control" type="date" value={form.dueAt}
                onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} />
            </label>
          </div>
          {form.plan !== venue.suggestedPlan ? (
            <p className="sa-view-note">Selon ses terrains, ce centre correspond au palier « {PLAN_LABELS[venue.suggestedPlan]} ».</p>
          ) : null}
          {error ? <p className="mb-field__error" role="alert">{error}</p> : null}
          <div className="sa-actions__row">
            <button type="submit" className="mb-btn mb-btn--sm" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={saving} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </form>
      ) : (
        <dl className="sa-facts">
          <dt>Formule</dt>
          <dd>
            {PLAN_LABELS[venue.subscriptionPlan]}
            {venue.suggestedPlan !== venue.subscriptionPlan ? <span className="sa-empty"> · ses terrains correspondent à « {PLAN_LABELS[venue.suggestedPlan]} »</span> : null}
          </dd>
          <dt>Statut</dt>
          <dd><span className={`sa-badge sa-badge--${subscriptionBadgeTone(venue.subscriptionStatus)}`}>{STATUS_LABELS[venue.subscriptionStatus]}</span></dd>
          <dt>{venue.subscriptionStatus === 'TRIAL' ? 'Fin de l’essai' : 'Échéance'}</dt><dd>{venue.subscriptionDueAt ? new Date(venue.subscriptionDueAt).toLocaleDateString('fr-FR') : '—'}</dd>
        </dl>
      )}
    </div>
  );
}
