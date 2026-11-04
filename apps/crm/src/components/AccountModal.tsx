import { useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

import { GENERIC_ERROR_MESSAGE } from '@moubarat/core';
/* ONB-1 (audit pré-lancement, lot 6, 27/09/2026) — « Mon compte » : changer SON mot de passe. Jusqu'ici un gérant
   gardait à vie le mot de passe temporaire dicté par Moubarat ou par son propriétaire. Le serveur exige le mot de
   passe actuel (`POST /platform/me/password`), impose 12 signes, refuse l'identique et ferme les autres sessions —
   ici seulement le formulaire et le message du serveur, jamais une règle réécrite. Même patron que HelpModal. */

export const MIN_PASSWORD_LENGTH = 12;

export function AccountModal({ accountName, token, onClose, onToast }: {
  accountName: string; token: string; onClose: () => void; onToast: (message: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
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
      onToast(n === 0 ? 'Mot de passe modifié.' : n === 1 ? 'Mot de passe modifié — 1 autre session fermée.' : `Mot de passe modifié — ${n} autres sessions fermées.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cm-modal-bg on" role="dialog" aria-modal="true" aria-label="Mon compte" onClick={onClose}>
      <form className="cm-modal cm-account" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { void submit(e); }}>
        <h3>Mon compte</h3>
        <p className="cm-note" style={{ margin: '0 0 10px' }}>
          Connecté en tant que <b style={{ color: 'var(--text)' }}>{accountName}</b>. Changer le mot de passe ferme les autres
          sessions ouvertes avec ce compte (autre poste, autre navigateur).
        </p>
        <label className="mb-field">
          <span className="mb-field__label">Mot de passe actuel</span>
          <input className="mb-field__control" type="password" autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} disabled={busy} required />
        </label>
        <label className="mb-field">
          <span className="mb-field__label">Nouveau mot de passe ({MIN_PASSWORD_LENGTH} signes au moins)</span>
          <input className="mb-field__control" type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} disabled={busy} required minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={tooShort} />
          {tooShort ? <span className="mb-field__error">Encore {MIN_PASSWORD_LENGTH - next.length} {MIN_PASSWORD_LENGTH - next.length > 1 ? 'signes' : 'signe'}.</span> : null}
        </label>
        <label className="mb-field">
          <span className="mb-field__label">Confirmer le nouveau mot de passe</span>
          <input className="mb-field__control" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} disabled={busy} required aria-invalid={mismatch} />
          {mismatch ? <span className="mb-field__error">Les deux saisies ne correspondent pas.</span> : null}
        </label>
        {error ? <p className="mb-field__error" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
        <div className="acts">
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="submit" className="mb-btn mb-btn--sm" disabled={!canSubmit}>{busy ? 'Enregistrement…' : 'Changer le mot de passe'}</button>
        </div>
      </form>
    </div>
  );
}
