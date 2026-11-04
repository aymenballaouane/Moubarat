import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { CredentialsBox } from './CredentialsBox.js';
import { PositionFields } from './PositionFields.js';
import type { CreatePrefill } from '../lib/requests.js';
import { publicationBadge, type VenueReadinessSummary } from '../lib/readiness.js';

export interface VenueSummary {
  id: string; name: string; wilaya: string; address: string;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';
  createdAt: string; fieldCount: number;
  /** A9 (24/09/2026) : « prêt à publier », évalué par le serveur — un centre actif mais incomplet n'apparaît
      pas dans l'app joueur, et la liste doit le dire sans ouvrir chaque fiche. */
  readiness: VenueReadinessSummary;
  /** ONB-2 (27/09/2026) : dernier « Signaler que c'est prêt » du gérant (ISO), ou null. */
  readySignaledAt: string | null;
  /** Abonnement SaaS minimal (22/09/2026, C1/CE11) : visible dès la liste — « vous ne savez pas qui
      est à jour » ne se répond pas en obligeant à ouvrir chaque fiche une par une. */
  subscriptionStatus: 'PAID' | 'UNPAID';
}

const STATUS_LABELS: Record<VenueSummary['status'], string> = {
  PENDING: 'En attente', ACTIVE: 'Actif', REJECTED: 'Refusé', SUSPENDED: 'Suspendu',
};
const SUBSCRIPTION_LABELS: Record<VenueSummary['subscriptionStatus'], string> = { PAID: 'À jour', UNPAID: 'Impayé' };

export function StatusBadge({ status }: { status: VenueSummary['status'] }) {
  return <span className={`sa-badge sa-badge--${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

function SubscriptionStatusBadge({ status }: { status: VenueSummary['subscriptionStatus'] }) {
  return <span className={`sa-badge sa-badge--${status === 'PAID' ? 'active' : 'suspended'}`}>{SUBSCRIPTION_LABELS[status]}</span>;
}

function PublicationBadge({ venue }: { venue: VenueSummary }) {
  const b = publicationBadge(venue.status, venue.readiness, venue.readySignaledAt);
  return b.tone === 'rejected'
    ? <span className="sa-empty">{b.label}</span>
    : <span className={`sa-badge sa-badge--${b.tone}`} data-testid="publication-badge">{b.label}</span>;
}

interface CentresProps {
  token: string;
  /** Arrivée depuis « Créer le centre » d'une demande d'inscription : ouvre le formulaire prérempli. */
  prefill?: CreatePrefill | null;
  onPrefillUsed?: () => void;
  /** Une demande vient d'être convertie : le badge de la navigation doit se rafraîchir. */
  onRequestsChanged?: () => void;
  /** `addStaff` : ouvre la fiche avec le formulaire « ajouter le compte du gérant » déjà ouvert. */
  onOpen: (venueId: string, opts?: { addStaff?: boolean }) => void;
}

export function Centres({ token, onOpen, prefill = null, onPrefillUsed, onRequestsChanged }: CentresProps) {
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const EMPTY_FORM = { name: '', wilaya: '', address: '', position: '', lat: '', lng: '', phone: '', description: '', withManager: false, gerantEmail: '', gerantName: '', bookingPrefix: '' };
  const [form, setForm] = useState(EMPTY_FORM);
  /* Préfixe des références de réservation (22/09/2026, décision Aymen) : dérivé automatiquement du nom,
     champ masqué tant que ça marche. Révélé seulement si le serveur refuse (409 BOOKING_PREFIX_TAKEN, nom
     déjà pris par un autre centre) — le superadmin choisit alors un code explicite. */
  const [prefixCollision, setPrefixCollision] = useState(false);
  /* Résultat du flux « créer + compte du gérant » : le mot de passe du gérant ne s'affiche qu'ici, une fois. */
  const [outcome, setOutcome] = useState<null | {
    venueId: string; venueName: string; staffError: string | null;
    creds: { email: string; password: string } | null; notice: string | null;
  }>(null);
  const [creating, setCreating] = useState(false);
  /* Demande d'inscription en cours de conversion (le centre créé la lie et la passe en « Convertie »). */
  const [requestFrom, setRequestFrom] = useState<{ id: string; contact: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    setError(null);
    apiFetch<{ venues: VenueSummary[] }>('/platform/venues', { token })
      .then((d) => setVenues(d.venues))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur de chargement.'));
  }
  useEffect(load, [token]);

  useEffect(() => {
    if (!prefill) return;
    setForm({ ...EMPTY_FORM, name: prefill.name, wilaya: prefill.wilaya, address: prefill.address, phone: prefill.phone, gerantEmail: prefill.gerantEmail, gerantName: prefill.gerantName });
    setRequestFrom({ id: prefill.requestId, contact: prefill.contactName });
    setOutcome(null); setCreateError(null); setShowCreate(true); setPrefixCollision(false);
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  /* « Créer + compte du gérant » (20/09/2026, demande d'Aymen ; A9, 24/09/2026 : plus d'activation ici). Le
     centre est TOUJOURS créé en attente (route existante), puis le compte du gérant. Il n'est PAS activé dans
     la foulée : un centre neuf n'a ni terrain, ni tarif, ni horaires, et la validation est refusée tant qu'il
     n'est pas « prêt à publier » (sinon l'app joueur afficherait une carte vide). Le gérant configure dans le
     CRM, puis le superadmin valide depuis la fiche du centre. Si le compte échoue, le centre reste en attente. */
  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreateError(null); setOutcome(null);
    const withManager = form.withManager;
    if (withManager && (!form.gerantEmail.trim() || form.gerantName.trim().length < 2)) {
      setCreateError('Pour créer le compte du gérant, renseigne son email et son nom.');
      return;
    }
    setCreating(true);
    const venueName = form.name.trim();
    let venueId: string;
    try {
      const res = await apiFetch<{ venue: { id: string } }>('/platform/venues', {
        method: 'POST', token,
        body: {
          name: form.name, wilaya: form.wilaya, address: form.address,
          lat: Number(form.lat), lng: Number(form.lng),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.description ? { description: form.description } : {}),
          ...(requestFrom ? { requestId: requestFrom.id } : {}),
          ...(form.bookingPrefix.trim() ? { bookingPrefix: form.bookingPrefix.trim().toUpperCase() } : {}),
        },
      });
      venueId = res.venue.id;
      if (requestFrom) { setRequestFrom(null); onRequestsChanged?.(); }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BOOKING_PREFIX_TAKEN') setPrefixCollision(true);
      setCreateError(err instanceof ApiError ? err.message : 'Création impossible.');
      setCreating(false);
      return;
    }
    setPrefixCollision(false);
    const gerant = { email: form.gerantEmail, name: form.gerantName };
    setForm(EMPTY_FORM);
    setShowCreate(false);
    load();

    if (!withManager) {
      setCreating(false);
      onOpen(venueId, { addStaff: true });
      return;
    }

    let creds: { email: string; password: string } | null = null;
    let notice: string | null = null;
    try {
      const st = await apiFetch<{ account: { email: string }; reused: boolean; temporaryPassword?: string }>(
        `/platform/venues/${venueId}/staff`, { method: 'POST', token, body: { email: gerant.email, name: gerant.name, role: 'OWNER' } });
      if (st.temporaryPassword) creds = { email: st.account.email, password: st.temporaryPassword };
      else notice = 'Ce compte existait déjà : il est rattaché au centre, son mot de passe est inchangé (rien à transmettre).';
    } catch (err) {
      setOutcome({
        venueId, venueName, creds: null, notice: null,
        staffError: err instanceof ApiError ? err.message : 'Création du compte impossible.',
      });
      setCreating(false);
      return;
    }
    setOutcome({ venueId, venueName, staffError: null, creds, notice });
    setCreating(false);
    load();
  }

  return (
    <section>
      <div className="sa-view-head">
        <p className="sa-view-note">Tous les centres, tous statuts confondus — pas seulement ceux qui sont actifs.</p>
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { setShowCreate((v) => !v); setRequestFrom(null); setPrefixCollision(false); }}>
          {showCreate ? 'Annuler' : '+ Nouveau centre'}
        </button>
      </div>

      {outcome ? (
        <div className="sa-card">
          {outcome.staffError ? (
            <>
              <p className="sa-sec">— CENTRE CRÉÉ, COMPTE DU GÉRANT NON CRÉÉ</p>
              <p className="mb-field__error">{outcome.staffError}</p>
              <p className="sa-text">
                « {outcome.venueName} » existe, en attente de validation — il reste invisible côté app joueur.
                Ouvre sa fiche pour ajouter le compte du gérant.
              </p>
            </>
          ) : (
            <>
              <p className="sa-sec">— CENTRE CRÉÉ, EN ATTENTE DE CONFIGURATION</p>
              {outcome.creds ? (
                <CredentialsBox
                  title={`Compte du gérant de « ${outcome.venueName} » — identifiants à transmettre`}
                  email={outcome.creds.email} password={outcome.creds.password}
                  onDismiss={() => setOutcome((o) => (o ? { ...o, creds: null } : o))}
                />
              ) : null}
              {outcome.notice ? <p className="sa-text" role="status">{outcome.notice}</p> : null}
              <p className="sa-text" role="status" data-testid="pending-config-note">
                Le centre reste en attente et invisible côté app joueur. Une fois ses terrains, tarifs et horaires configurés
                (par le gérant, dans le CRM), sa fiche indique « Prêt à publier » et tu peux le valider.
              </p>
            </>
          )}
          <div className="sa-actions__row">
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => onOpen(outcome.venueId, outcome.staffError ? { addStaff: true } : undefined)}>
              Ouvrir la fiche du centre
            </button>
            {outcome.creds ? null : (
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => setOutcome(null)}>Fermer</button>
            )}
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <form className="sa-card sa-create-form" onSubmit={(e) => { void submitCreate(e); }}>
          {requestFrom ? (
            <p className="sa-view-note" role="status" data-testid="from-request">
              Créé depuis la demande d’inscription de {requestFrom.contact} — renseigne la position (latitude, longitude), le reste est prérempli.
            </p>
          ) : null}
          <div className="sa-form-grid">
            <label className="mb-field">
              <span className="mb-field__label">Nom</span>
              <input className="mb-field__control" required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Wilaya</span>
              <input className="mb-field__control" required value={form.wilaya}
                onChange={(e) => setForm((f) => ({ ...f, wilaya: e.target.value }))} />
            </label>
            <label className="mb-field" style={{ gridColumn: '1 / -1' }}>
              <span className="mb-field__label">Adresse</span>
              <input className="mb-field__control" required value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </label>
            <PositionFields value={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
            <label className="mb-field">
              <span className="mb-field__label">Téléphone (optionnel)</span>
              <input className="mb-field__control" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </label>
            {prefixCollision ? (
              <label className="mb-field" style={{ gridColumn: '1 / -1' }}>
                <span className="mb-field__label">Préfixe des résas (3 lettres, ex. COM) — déjà pris par un autre centre, choisis-en un autre</span>
                <input className="mb-field__control" maxLength={3} data-testid="booking-prefix"
                  value={form.bookingPrefix} onChange={(e) => setForm((f) => ({ ...f, bookingPrefix: e.target.value.toUpperCase() }))} />
                <span className="sa-view-note" role="status">Fixe une fois le centre créé — jamais modifiable ensuite, même si le nom change.</span>
              </label>
            ) : null}
          </div>

          <label className="sa-check">
            <input type="checkbox" checked={form.withManager} onChange={(e) => setForm((f) => ({ ...f, withManager: e.target.checked }))} />
            <span>Créer aussi le compte du gérant — le centre reste en attente jusqu’à ce que ses terrains, tarifs et horaires soient configurés</span>
          </label>
          {form.withManager ? (
            <div className="sa-form-grid">
              <label className="mb-field">
                <span className="mb-field__label">Email du gérant</span>
                <input className="mb-field__control" type="email" required autoComplete="off" value={form.gerantEmail}
                  onChange={(e) => setForm((f) => ({ ...f, gerantEmail: e.target.value }))} />
              </label>
              <label className="mb-field">
                <span className="mb-field__label">Nom du gérant</span>
                <input className="mb-field__control" required minLength={2} maxLength={60} autoComplete="off" value={form.gerantName}
                  onChange={(e) => setForm((f) => ({ ...f, gerantName: e.target.value }))} />
              </label>
              <p className="sa-view-note" style={{ gridColumn: '1 / -1' }}>
                Le mot de passe généré s’affiche une seule fois, à l’étape suivante.
              </p>
            </div>
          ) : (
            <p className="sa-view-note">Sans compte gérant, le centre est créé en attente de validation ; tu arrives sur sa fiche pour l’ajouter.</p>
          )}
          {createError ? <p className="mb-field__error">{createError}</p> : null}
          <button type="submit" className="mb-btn mb-btn--sm" disabled={creating}>
            {creating ? 'Création…' : form.withManager ? 'Créer et ajouter le gérant' : 'Créer (en attente de validation)'}
          </button>
        </form>
      ) : null}

      {error ? <p className="sa-error">{error}</p> : null}
      {!venues && !error ? <p className="sa-loading">Chargement…</p> : null}
      {venues ? (
        venues.length === 0 ? (
          <p className="sa-empty">Aucun centre pour l’instant.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Nom</th><th>Statut</th><th>Publication</th><th>Abonnement</th><th>Wilaya</th><th>Terrains</th><th>Créé le</th><th />
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id} className="sa-table__row" onClick={() => onOpen(v.id)}>
                    <td>{v.name}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td><PublicationBadge venue={v} /></td>
                    <td><SubscriptionStatusBadge status={v.subscriptionStatus} /></td>
                    <td>{v.wilaya}</td>
                    <td>{v.fieldCount}</td>
                    <td>{new Date(v.createdAt).toLocaleDateString('fr-FR')}</td>
                    <td><button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={() => onOpen(v.id)}>Voir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
