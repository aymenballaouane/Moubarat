import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

interface CenterMembership { venueId: string; venueName: string; role: string }
interface LoginResponse {
  token: string;
  account: { id: string; email: string; name: string; isSuperadmin: boolean };
  centerMemberships: CenterMembership[];
}

interface LoginScreenProps {
  onLoggedIn: (token: string) => void;
}

/* CRM Auth V1 — vraie authentification, email + mot de passe contre
   POST /platform/auth/login (même mécanisme que la console plateforme :
   un compte CRM est un platform_account sans is_superadmin, rattaché à un
   centre via center_staff). Aucun rôle simulé, aucun centre codé en dur. */
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
      if (res.centerMemberships.length === 0) {
        setError('Ce compte n’est rattaché à aucun centre.');
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
    <div className="cm-login">
      <form className="cm-login__card" onSubmit={submit}>
        <p className="cm-login__eyebrow">— MOUBARAT</p>
        <h1 className="cm-login__title">Espace centre</h1>
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
        {/* Un centre qui n'a pas encore de compte : demande publique, examinée par la plateforme. */}
        <a className="cm-login__link" href="#/rejoindre">Vous êtes un centre ? Faire une demande</a>
      </form>
    </div>
  );
}
