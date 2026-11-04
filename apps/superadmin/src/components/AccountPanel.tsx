import { useState, type FormEvent } from 'react';
import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import { apiFetch, ApiError } from '../lib/api.js';

/* ONB-1 (audit pré-lancement, lot 6, 27/09/2026) — « Mon compte » de la console : le superadmin change SON mot de
   passe (`POST /platform/me/password`, mot de passe actuel exigé, 12 signes, autres sessions fermées). Même patron de
   formulaire en carte que IdentityCard/StaffCard — la console n'a pas de modale. */

const MIN_PASSWORD_LENGTH = 12;

export function AccountPanel({ accountName, token, onClose }: { accountName: string; token: string; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && next === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: true; revokedSessions: number }>('/platform/me/password', {
        method: 'POST', token, body: { currentPassword: current, newPassword: next },
      });
      const n = res.revokedSessions;
      setDone(n === 0 ? 'Mot de passe modifié.' : n === 1 ? 'Mot de passe modifié — 1 autre session fermée.' : `Mot de passe modifié — ${n} autres sessions fermées.`);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-card" data-testid="account-panel">
      <div className="sa-view-head">
        <p className="sa-sec">— MON COMPTE · {accountName}</p>
        <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose}>Fermer</button>
      </div>
      {done ? <p className="sa-text" role="status">{done}</p> : null}
      <form className="sa-create-form" onSubmit={(e) => { void submit(e); }}>
        <div className="sa-form-grid">
          <label className="mb-field">
            <span className="mb-field__label">Mot de passe actuel</span>
            <input className="mb-field__control" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} required />
          </label>
          <label className="mb-field">
            <span className="mb-field__label">Nouveau ({MIN_PASSWORD_LENGTH} signes au moins)</span>
            <input className="mb-field__control" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} required minLength={MIN_PASSWORD_LENGTH} />
          </label>
          <label className="mb-field">
            <span className="mb-field__label">Confirmer</span>
            <input className="mb-field__control" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} required aria-invalid={mismatch} />
            {mismatch ? <span className="mb-field__error">Les deux saisies ne correspondent pas.</span> : null}
          </label>
        </div>
        {error ? <p className="mb-field__error" role="alert">{error}</p> : null}
        <p className="sa-view-note">Changer le mot de passe ferme les autres sessions ouvertes avec ce compte.</p>
        <div className="sa-actions__row">
          <button type="submit" className="mb-btn mb-btn--sm" disabled={!canSubmit}>{busy ? 'Enregistrement…' : 'Changer le mot de passe'}</button>
        </div>
      </form>
    </div>
  );
}
