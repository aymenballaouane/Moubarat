import { useState } from 'react';
import { useT } from '../lib/i18n.js';

/* Identifiants d'un compte CRM fraîchement créé / réinitialisé (22/09/2026, écran Personnel) : le mot de
   passe n'est affiché qu'ici, UNE fois, et ne vit que dans l'état du composant parent — jamais dans le
   stockage du navigateur. Même patron que la console superadmin (CredentialsBox.tsx), classes CRM. */
export function CredentialsBox({ title, email, password, onDismiss }: {
  title: string; email: string; password: string; onDismiss: () => void;
}) {
  const t = useT();
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
    <div className="cm-card cm-creds" role="status" data-testid="staff-credentials">
      <p className="cm-sec">{t(title)}</p>
      <p className="cm-note" style={{ color: 'var(--gold)' }}>{t('Ce mot de passe ne sera plus jamais affiché. Notez-le ou copiez-le maintenant.')}</p>
      <dl className="cm-creds__grid">
        <dt>{t('Email')}</dt><dd className="cm-mono">{email}</dd>
        <dt>{t('Mot de passe')}</dt><dd className="cm-mono" data-testid="staff-password">{password}</dd>
      </dl>
      {copyError ? <p className="mb-field__error">{t('Copie impossible depuis ce navigateur — sélectionnez le mot de passe et copiez-le à la main.')}</p> : null}
      <div className="cm-actions-row">
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { void copy(); }}>
          {copied ? t('Copié') : t('Copier les identifiants')}
        </button>
        <button type="button" className="mb-btn mb-btn--sm" onClick={onDismiss}>{t('J’ai noté le mot de passe')}</button>
      </div>
    </div>
  );
}
