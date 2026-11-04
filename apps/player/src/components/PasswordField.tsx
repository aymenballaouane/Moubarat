import { useState } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';

/* Règle 29 — champ mot de passe partagé entre AuthFlow.tsx (Accès, Connexion, Mot de passe
   oublié) et AccessSetupGate.tsx : même bouton Afficher/Masquer, mêmes 3 critères en direct,
   jamais trois copies presque identiques. */

export const PASSWORD_CHECKS: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= 8, label: '8 caractères' },
  { test: (p) => /\d/.test(p), label: '1 chiffre' },
  { test: (p) => /[A-Z]/.test(p), label: '1 majuscule' },
];

export function PasswordField({ value, onChange, autoComplete, disabled }: {
  value: string; onChange: (v: string) => void; autoComplete: string; disabled?: boolean;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="au-password-row">
      <input
        className="mb-field__control" type={show ? 'text' : 'password'} autoComplete={autoComplete} dir="ltr"
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="au-password-toggle mb-tap" onClick={() => setShow((v) => !v)}>
        {show ? t('Masquer') : t('Afficher')}
      </button>
    </div>
  );
}

export function PasswordChecks({ password }: { password: string }) {
  const t = useT();
  return (
    <ul className="au-password-checks">
      {PASSWORD_CHECKS.map((c) => (
        <li key={c.label} className={c.test(password) ? 'on' : ''}><Icon id="i-check" className="mb-ic--sm" />{t(c.label)}</li>
      ))}
    </ul>
  );
}
