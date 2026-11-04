import { useState } from 'react';
import { Icon } from './Icon.js';
import { LegalDocs } from './LegalDocs.js';
import { ApiError } from '../lib/api.js';

/* Écran plein page, non contournable (C7, audit produit 21/09/2026) : compte joueur créé AVANT ce
   lot (ou dont la version acceptée des CGU/confidentialité est périmée) — même mécanique que côté
   CRM (LegalGate.tsx), affichée après le bootstrap plutôt qu'à la connexion, sur le même écran que
   les autres gardes de App.tsx (bootstrapping, hors-ligne). */
export function LegalConsentGate({ onAccepted }: { onAccepted: () => Promise<void> }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="au-screen" id="s-legal-consent">
      <h2 className="mb-d2 au-title">Avant de continuer</h2>
      <p className="au-sub">
        Moubarat a besoin de ton accord sur ses conditions d’utilisation et sa politique de
        confidentialité pour continuer à utiliser l’app.
      </p>

      <div className="au-group">
        <LegalDocs />
        <label className="au-consent-check">
          <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
          <span>J’accepte les conditions générales d’utilisation et la politique de confidentialité.</span>
        </label>
        {error ? <p className="au-error on"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span></p> : null}
      </div>

      <div className="au-spacer" />
      <button
        type="button" className="mb-btn mb-btn--block" data-loading={busy ? 'true' : undefined}
        disabled={!checked || busy} onClick={() => { void submit(); }}
      >
        Continuer
      </button>
    </section>
  );
}
