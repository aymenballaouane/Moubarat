import { useState } from 'react';
import { validateDisplayName } from '@moubarat/core';
import { Icon } from './Icon.js';
import { ApiError } from '../lib/api.js';

/* Écran plein page, non contournable (unicité du nom d'affichage, 25/09/2026) : le compte partageait son nom avec un joueur
   plus ancien (doublon d'avant la règle « un nom, un joueur »). Il garde son nom tant qu'il n'en a pas choisi un autre — rien
   n'est modifié en silence — mais l'app le lui demande avant tout, comme le consentement (LegalConsentGate). Même
   emplacement dans App.tsx : après le bootstrap, sur le même écran que les autres gardes. Le nom sert aussi à te retrouver
   et t'inviter dans une équipe : vrai nom OU pseudo, au choix. */
export function NameChangeGate({ currentName, onSubmit }: { currentName: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    const check = validateDisplayName(name);
    if (!check.ok) { setError(check.message); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="au-screen" id="s-name-change">
      <h2 className="mb-d2 au-title">Choisis ton nom</h2>
      <p className="au-sub">
        Un autre joueur porte déjà le nom « {currentName} ». Pour qu’on ne vous confonde pas, choisis un nom que
        personne d’autre n’utilise : ton vrai nom ou un pseudo, comme tu veux.
      </p>

      <div className="au-group">
        <label className="mb-field">
          <span className="mb-field__label">Nom ou pseudo</span>
          <input
            className="mb-field__control" type="text" autoComplete="nickname" placeholder="ex. kamel_92" maxLength={40}
            value={name} disabled={busy} aria-invalid={error ? true : undefined}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { void submit(); } }}
          />
          {error ? <span className="mb-field__error"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span></span> : null}
          <span className="mb-field__hint">2 à 40 signes · lettres, chiffres, espaces, points, tirets et underscores.</span>
        </label>
      </div>

      <div className="au-spacer" />
      <button
        type="button" className="mb-btn mb-btn--block" data-loading={busy ? 'true' : undefined}
        disabled={!name.trim() || busy} onClick={() => { void submit(); }}
      >
        Continuer
      </button>
    </section>
  );
}
