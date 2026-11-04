import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { PUBLIC_LEGAL_PATHS, legalDateLabel, type PublicLegalDoc } from '../lib/legalPage.js';
import '../styles/legal-public.css';

/* Page publique d'un texte juridique (Lot 13) : lisible sans compte, à l'adresse que les stores demandent. Une page de lecture, pas un écran de l'app : en-tête de marque,
   titre, version et date, les sections du texte tel que l'avocat l'a remis, un lien vers l'autre document et un bouton vers l'app. Hors de la pile de navigation (pas de « Retour »). */

interface LegalSection { heading?: string; paragraphs: string[] }
interface LegalDocument { key: string; version: string; title: string; publishedAt: string; sections: LegalSection[] }

const OTHER: Record<PublicLegalDoc, { doc: PublicLegalDoc; label: string }> = {
  CONFIDENTIALITE: { doc: 'CGU', label: 'Conditions générales d’utilisation' },
  CGU: { doc: 'CONFIDENTIALITE', label: 'Politique de confidentialité' },
};

export function PublicLegalPage({ doc }: { doc: PublicLegalDoc }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ok'; document: LegalDocument }>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    apiFetch<{ document: LegalDocument }>(`/legal/${doc.toLowerCase()}`)
      .then((r) => { if (alive) { setState({ status: 'ok', document: r.document }); document.title = `${r.document.title} — Moubarat`; } })
      .catch(() => { if (alive) setState({ status: 'error' }); });
    return () => { alive = false; };
  }, [doc]);

  return (
    <main className="lp" id="s-legal-public">
      <header className="lp-head">
        <a className="lp-brand" href="/">MOUBARAT</a>
        <a className="lp-open" href="/">Ouvrir l’application</a>
      </header>

      {state.status === 'loading' ? <p className="lp-note">Chargement…</p> : null}
      {state.status === 'error' ? <p className="lp-note" role="alert">Ce document est indisponible pour le moment. Réessaie dans quelques instants.</p> : null}
      {state.status === 'ok' ? (
        <article>
          <h1 className="lp-title">{state.document.title}</h1>
          <p className="lp-meta">Version {state.document.version} · publiée le {legalDateLabel(state.document.publishedAt)}</p>
          {state.document.sections.map((s, i) => (
            <section key={i} className="lp-sec">
              {s.heading ? <h2 className="lp-h2">{s.heading}</h2> : null}
              {s.paragraphs.map((p, j) => <p key={j} className="lp-p">{p}</p>)}
            </section>
          ))}
        </article>
      ) : null}

      <footer className="lp-foot">
        <a href={PUBLIC_LEGAL_PATHS[OTHER[doc].doc]}>{OTHER[doc].label}</a>
        <span>MOUBARAT SPORT SARL · contact@moubaratsport.com</span>
      </footer>
    </main>
  );
}
