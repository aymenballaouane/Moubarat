import { useState } from 'react';

/* Identifiants d'un compte CRM fraîchement créé / réinitialisé (20/09/2026) : le mot de passe
   n'est affiché qu'ici, UNE fois, et ne vit que dans l'état du composant parent — jamais dans
   le stockage du navigateur. Partagé par la carte « Comptes CRM du centre » et par la création
   d'un centre avec son gérant. */
export function CredentialsBox({ title, email, password, onDismiss }: {
  title: string; email: string; password: string; onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Email : ${email}\nMot de passe : ${password}`);
      setCopied(true); setCopyError(false);
    } catch {
      setCopied(false); setCopyError(true);
    }
  }

  return (
    <div className="sa-creds" role="status" data-testid="staff-credentials">
      <p className="sa-creds__title">{title}</p>
      <p className="sa-creds__warn">Ce mot de passe ne sera plus jamais affiché. Note-le ou copie-le maintenant.</p>
      <dl className="sa-creds__grid">
        <dt>Email</dt><dd className="sa-mono">{email}</dd>
        <dt>Mot de passe</dt><dd className="sa-mono" data-testid="staff-password">{password}</dd>
      </dl>
      {copyError ? <p className="mb-field__error">Copie impossible depuis ce navigateur — sélectionne le mot de passe et copie-le à la main.</p> : null}
      <div className="sa-actions__row">
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void copy(); }}>
          {copied ? 'Copié' : 'Copier les identifiants'}
        </button>
        <button type="button" className="mb-btn mb-btn--sm" onClick={onDismiss}>J’ai noté le mot de passe</button>
      </div>
    </div>
  );
}
