import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api.js';

interface LegalSection { heading?: string; paragraphs: string[] }
interface LegalDocument { key: string; version: string; title: string; publishedAt: string; sections: LegalSection[] }

/* Écran plein page, non contournable (C7, audit produit 21/09/2026) : un compte CRM déjà connecté
   AVANT la publication d'une version des CGU/de la politique de confidentialité (ou créé après, mais
   qui n'a encore rien accepté) doit consentir avant d'atteindre le tableau de bord — même mécanique
   que côté joueur (AuthFlow.tsx, étape "profile"), affichée ici plutôt qu'à la création du compte
   puisqu'un compte CRM est créé par un tiers (superadmin/OWNER), jamais par auto-inscription. */
export function LegalGate({ token, onAccepted }: { token: string; onAccepted: () => void }) {
  const [docs, setDocs] = useState<{ cgu: LegalDocument; confidentialite: LegalDocument } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ document: LegalDocument }>('/legal/cgu'),
      apiFetch<{ document: LegalDocument }>('/legal/confidentialite'),
    ])
      .then(([cgu, confidentialite]) => setDocs({ cgu: cgu.document, confidentialite: confidentialite.document }))
      .catch(() => setLoadError('Impossible de charger les documents. Vérifiez votre connexion et réessayez.'));
  }, []);

  async function submit() {
    if (!checked || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await apiFetch('/platform/auth/legal-consent', { method: 'POST', token });
      onAccepted();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Envoi impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cm-login">
      <div className="cm-login__card cm-login__card--wide" role="dialog" aria-modal="true">
        <p className="cm-login__eyebrow">— MOUBARAT</p>
        <h1 className="cm-login__title">Avant de continuer</h1>
        <p className="cm-login__text">
          Moubarat a besoin de votre accord sur ses conditions d’utilisation et sa politique de
          confidentialité pour que ce compte continue d’accéder au CRM.
        </p>

        {loadError ? <p className="mb-field__error">{loadError}</p> : null}

        {docs ? (
          <>
            {([docs.cgu, docs.confidentialite]).map((doc) => (
              <div key={doc.key} className="cm-legal-doc">
                <p className="cm-sec">{doc.title} · {doc.version}</p>
                {doc.sections.map((s, i) => (
                  <div key={i}>
                    {s.heading ? <p className="cm-legal-doc__heading">{s.heading}</p> : null}
                    {s.paragraphs.map((p, j) => <p key={j} className="cm-legal-doc__p">{p}</p>)}
                  </div>
                ))}
              </div>
            ))}

            <label className="cm-login__check">
              <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
              <span>J’ai lu et j’accepte les conditions générales d’utilisation et la politique de confidentialité.</span>
            </label>
            {submitError ? <p className="mb-field__error">{submitError}</p> : null}

            <button
              type="button" className="mb-btn mb-btn--block" data-loading={busy ? 'true' : undefined}
              disabled={!checked || busy} onClick={() => { void submit(); }}
            >
              Continuer
            </button>
          </>
        ) : !loadError ? (
          <p className="cm-login__text">Chargement…</p>
        ) : null}
      </div>
    </div>
  );
}
