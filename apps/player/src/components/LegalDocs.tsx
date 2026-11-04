import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

interface LegalSection { heading?: string; paragraphs: string[] }
interface LegalDocument { key: string; version: string; title: string; publishedAt: string; sections: LegalSection[] }

/** Les deux documents courants (CGU + confidentialité), affichés inline — pas de routage public dans
    cette app (nav.ts est un état React, sans URL), donc pas de page dédiée séparée : le texte se lit
    directement là où il faut le lire (étape "profile" d'AuthFlow, garde LegalConsentGate). */
export function LegalDocs() {
  const [docs, setDocs] = useState<[LegalDocument, LegalDocument] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ document: LegalDocument }>('/legal/cgu'),
      apiFetch<{ document: LegalDocument }>('/legal/confidentialite'),
    ])
      .then(([cgu, confidentialite]) => setDocs([cgu.document, confidentialite.document]))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="mb-field__error">Documents indisponibles pour le moment.</p>;
  if (!docs) return <p className="au-sub">Chargement…</p>;

  return (
    <>
      {docs.map((doc) => (
        <div key={doc.key} className="au-legal-doc">
          <p className="mb-field__label">{doc.title} · {doc.version}</p>
          {doc.sections.map((s, i) => (
            <div key={i}>
              {s.heading ? <p className="au-legal-doc__heading">{s.heading}</p> : null}
              {s.paragraphs.map((p, j) => <p key={j} className="au-legal-doc__p">{p}</p>)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
