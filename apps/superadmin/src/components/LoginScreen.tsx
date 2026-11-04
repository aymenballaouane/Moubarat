import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

interface LoginScreenProps {
  onLoggedIn: (token: string) => void;
}

interface LoginResponse {
  token: string;
  account: { id: string; email: string; name: string; isSuperadmin: boolean };
}

/* Vraie authentification — email + mot de passe contre POST /platform/auth/login.
   Aucun rôle simulé, aucun `actor = SUPERADMIN` codé en dur (mandat §3). */
export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<LoginResponse>('/platform/auth/login', {
        method: 'POST', body: { email, password },
      });
      if (!res.account.isSuperadmin) {
        setError('Ce compte n’a pas de droits SUPERADMIN.');
        setBusy(false);
        return;
      }
      onLoggedIn(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible. Réessaie.');
      setBusy(false);
    }
  }

  return (
    <div className="sa-login">
      <form className="sa-login__card" onSubmit={submit}>
        <p className="sa-login__eyebrow">— MOUBARAT</p>
        <h1 className="sa-login__title">Console plateforme</h1>
        <label className="mb-field">
          <span className="mb-field__label">Email</span>
          <input
            className="mb-field__control" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
          />
        </label>
        <label className="mb-field">
          <span className="mb-field__label">Mot de passe</span>
          <input
            className="mb-field__control" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
          />
        </label>
        {error ? <p className="mb-field__error">{error}</p> : null}
        <button type="submit" className="mb-btn mb-btn--block" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
