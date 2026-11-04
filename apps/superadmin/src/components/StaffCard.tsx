import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';
import { ROLE_LABELS } from '../lib/labels.js';
import { CredentialsBox } from './CredentialsBox.js';

/* 20/09/2026 (demande d'Aymen) — comptes CRM d'un centre, créés depuis la console
   (remplace `pnpm crm:create-account`). Le mot de passe est GÉNÉRÉ par le serveur
   et affiché UNE seule fois ici : il ne vit que dans l'état de ce composant, jamais
   dans le stockage du navigateur, et disparaît dès qu'on ferme l'encadré. Aucun
   changement de mot de passe forcé à la première connexion en V1. */

interface StaffRow {
  accountId: string; email: string; name: string; role: string; status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string; lastSeenAt: string | null;
}

interface Credentials {
  email: string; password: string; kind: 'created' | 'reset';
}

const CENTER_ROLES = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'] as const;

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Jamais connecté';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function StaffCard({ token, venueId, venueName, onChanged, initialShowForm = false }: {
  token: string; venueId: string; venueName: string; onChanged: () => void;
  /** Ouvre le formulaire d'ajout dès l'affichage (arrivée depuis « + Nouveau centre »). */
  initialShowForm?: boolean;
}) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initialShowForm);
  const [form, setForm] = useState({ email: '', name: '', role: 'OWNER' as (typeof CENTER_ROLES)[number] });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [confirm, setConfirm] = useState<{ accountId: string; kind: 'reset' | 'suspend' } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<{ staff: StaffRow[] }>(`/platform/venues/${venueId}/staff`, { token })
      .then((d) => setStaff(d.staff))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [token, venueId]);
  useEffect(load, [load]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const res = await apiFetch<{
        account: { email: string }; reused: boolean; otherVenues: string[]; temporaryPassword?: string;
      }>(`/platform/venues/${venueId}/staff`, { method: 'POST', token, body: { email: form.email, name: form.name, role: form.role } });
      if (res.reused) {
        setCreds(null);
        setNotice(
          `Compte existant rattaché à ${venueName} — son mot de passe est inchangé (rien à transmettre).`
          + (res.otherVenues.length > 0 ? ` Attention : il est aussi rattaché à ${res.otherVenues.join(', ')} ; le CRM ouvre le premier centre de sa liste.` : ''),
        );
      } else {
        setCreds({ email: res.account.email, password: res.temporaryPassword!, kind: 'created' });
      }
      setForm({ email: '', name: '', role: 'OWNER' });
      setShowForm(false);
      load(); onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function doReset(accountId: string, email: string) {
    setBusy(true); setRowError(null); setNotice(null);
    try {
      const res = await apiFetch<{ temporaryPassword: string }>(
        `/platform/venues/${venueId}/staff/${accountId}/reset-password`, { method: 'POST', token });
      setCreds({ email, password: res.temporaryPassword, kind: 'reset' });
      setConfirm(null);
      load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function doStatus(accountId: string, action: 'suspend' | 'reactivate') {
    setBusy(true); setRowError(null);
    try {
      await apiFetch(`/platform/accounts/${accountId}/${action}`, { method: 'POST', token });
      setConfirm(null);
      load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-card">
      <div className="sa-view-head">
        <p className="sa-sec">— COMPTES CRM DU CENTRE{staff ? ` (${staff.length})` : ''}</p>
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { setShowForm((v) => !v); setFormError(null); }}>
          {showForm ? 'Annuler' : '+ Ajouter un compte'}
        </button>
      </div>

      {creds ? (
        <CredentialsBox
          title={`${creds.kind === 'created' ? 'Compte créé' : 'Mot de passe réinitialisé'} — identifiants à transmettre`}
          email={creds.email} password={creds.password} onDismiss={() => setCreds(null)}
        />
      ) : null}

      {notice ? <p className="sa-text" role="status">{notice}</p> : null}

      {showForm ? (
        <form className="sa-create-form" onSubmit={(e) => { void submitCreate(e); }}>
          <div className="sa-form-grid">
            <label className="mb-field">
              <span className="mb-field__label">Email de connexion</span>
              <input className="mb-field__control" type="email" required autoComplete="off" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Nom</span>
              <input className="mb-field__control" required minLength={2} maxLength={60} autoComplete="off" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="mb-field">
              <span className="mb-field__label">Rôle</span>
              <select className="mb-field__control" value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as (typeof CENTER_ROLES)[number] }))}>
                {CENTER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>
          <p className="sa-view-note">
            Un mot de passe est généré et affiché une seule fois. Si l’email existe déjà, le compte est rattaché à ce centre sans changer son mot de passe.
          </p>
          {formError ? <p className="mb-field__error">{formError}</p> : null}
          <button type="submit" className="mb-btn mb-btn--sm" disabled={busy}>{busy ? 'Création…' : 'Créer le compte'}</button>
        </form>
      ) : null}

      {error ? <p className="sa-error">{error}</p> : null}
      {rowError ? <p className="mb-field__error">{rowError}</p> : null}
      {!staff && !error ? <p className="sa-loading">Chargement…</p> : null}
      {staff ? (
        staff.length === 0 ? (
          <p className="sa-empty">Aucun compte CRM pour ce centre — ajoute le compte du gérant pour qu’il puisse se connecter.</p>
        ) : (
          <table className="sa-table">
            <thead><tr><th>Email</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th /></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.accountId}>
                  <td className="sa-mono">{s.email}</td>
                  <td>{s.name}</td>
                  <td>{ROLE_LABELS[s.role] ?? s.role}</td>
                  <td>{s.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}</td>
                  <td>{lastSeenLabel(s.lastSeenAt)}</td>
                  <td>
                    {confirm?.accountId === s.accountId ? (
                      <span className="sa-confirm">
                        <span>{confirm.kind === 'reset' ? 'Nouveau mot de passe, sessions ouvertes coupées ?' : 'Suspendre ce compte ?'}</span>
                        <button type="button" className={`mb-btn mb-btn--sm${confirm.kind === 'suspend' ? ' mb-btn--danger' : ''}`} disabled={busy}
                          onClick={() => { void (confirm.kind === 'reset' ? doReset(s.accountId, s.email) : doStatus(s.accountId, 'suspend')); }}>
                          {busy ? '…' : 'Oui'}
                        </button>
                        <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" disabled={busy} onClick={() => setConfirm(null)}>Annuler</button>
                      </span>
                    ) : (
                      <span className="sa-actions__row">
                        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => setConfirm({ accountId: s.accountId, kind: 'reset' })}>
                          Réinitialiser le mot de passe
                        </button>
                        {s.status === 'ACTIVE' ? (
                          <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" onClick={() => setConfirm({ accountId: s.accountId, kind: 'suspend' })}>Suspendre</button>
                        ) : (
                          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" disabled={busy} onClick={() => { void doStatus(s.accountId, 'reactivate'); }}>Réactiver</button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
