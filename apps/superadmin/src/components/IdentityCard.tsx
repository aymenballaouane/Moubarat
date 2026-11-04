import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { PositionFields } from './PositionFields.js';

/* Identité d'un centre (22/09/2026, audit produit CE1/CE2) : nom, wilaya, adresse, position, téléphone,
   description. Avant ce formulaire, une faute de frappe à la création ne se corrigeait nulle part — même
   pas ici. Le gérant, lui, ne modifie que adresse/description/équipements/téléphone/caisse depuis son CRM :
   nom, wilaya et position restent réservés à cet écran. Chaque modification est journalisée et visible
   dans le Journal du centre, sous « Équipe Moubarat ». */

export interface VenueIdentity {
  id: string; name: string; wilaya: string; address: string;
  lat: number; lng: number; phone: string | null; description: string | null;
  /** Préfixe FIXE des références de réservation (« COM » → « COM-000482 »), attribué une seule fois à la
      création — affiché en lecture seule, jamais éditable ici (22/09/2026, audit multi-centre). */
  bookingPrefix: string;
}

function toForm(v: VenueIdentity) {
  return {
    name: v.name, wilaya: v.wilaya, address: v.address, position: '', lat: String(v.lat), lng: String(v.lng),
    phone: v.phone ?? '', description: v.description ?? '',
  };
}

export function IdentityCard({ token, venue, onSaved }: { token: string; venue: VenueIdentity; onSaved: () => void }) {
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
      const res = await apiFetch<{ changed: string[] }>(`/platform/venues/${venue.id}`, {
        method: 'PATCH', token,
        body: {
          name: form.name, wilaya: form.wilaya, address: form.address,
          lat: Number(form.lat), lng: Number(form.lng), phone: form.phone, description: form.description,
        },
      });
      setEditing(false);
      setNotice(res.changed.length === 0
        ? 'Aucun changement.'
        : 'Fiche enregistrée — la modification apparaît dans le Journal du centre.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sa-card" data-testid="identity-card">
      <div className="sa-view-head">
        <p className="sa-sec">— IDENTITÉ DU CENTRE</p>
        {editing ? null : (
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={startEdit}>Modifier la fiche</button>
        )}
      </div>

      {notice && !editing ? <p className="sa-view-note" role="status">{notice}</p> : null}

      {editing ? (
        <form className="sa-create-form" onSubmit={(e) => { void save(e); }}>
          <div className="sa-form-grid">
            <label className="mb-field">
              <span className="mb-field__label">Nom</span>
              <input className="mb-field__control" required value={form.name} data-testid="identity-name"
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
              <span className="mb-field__label">Téléphone (affiché aux joueurs)</span>
              <input className="mb-field__control" maxLength={40} value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </label>
            <label className="mb-field" style={{ gridColumn: '1 / -1' }}>
              <span className="mb-field__label">Description</span>
              <textarea className="mb-field__control" rows={3} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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
          <dt>Nom</dt><dd>{venue.name}</dd>
          <dt>Préfixe résas</dt>
          <dd>
            {venue.bookingPrefix} <span className="sa-view-note" style={{ display: 'inline' }}>— fixe, jamais modifiable (ex. {venue.bookingPrefix}-000482)</span>
          </dd>
          <dt>Wilaya</dt><dd>{venue.wilaya}</dd>
          <dt>Adresse</dt><dd>{venue.address}</dd>
          <dt>Position</dt>
          <dd>
            {venue.lat}, {venue.lng} ·{' '}
            <a href={`https://www.google.com/maps?q=${venue.lat},${venue.lng}`} target="_blank" rel="noopener noreferrer">Voir sur Google Maps</a>
          </dd>
          <dt>Téléphone</dt><dd>{venue.phone ?? '—'}</dd>
          <dt>Description</dt><dd className="sa-facts__long">{venue.description ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
