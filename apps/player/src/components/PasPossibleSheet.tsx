import { useEffect, useState } from 'react';
import { haptic } from '../lib/haptic.js';
import { useLang, useT } from '../lib/i18n.js';
import { onPasPossible, pasPossibleCopy, type PasPossible, type PasPossibleAction } from '../lib/pasPossible.js';
import type { Route } from '../nav.js';
import '../styles/reserver.css';

/* « Pas possible pour l'instant » (PasPossible*.dc.html, règle 24) : la feuille unique qui explique une limite. Montée UNE fois dans App ;
   n'importe quel écran qui reçoit un refus l'annonce par reportRefusal (lib/pasPossible.ts). Même gabarit que « Oups, il vient d'être pris ». */

export function PasPossibleHost({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const t = useT();
  const lang = useLang();
  const [current, setCurrent] = useState<PasPossible | null>(null);
  useEffect(() => onPasPossible((p) => { haptic('light'); setCurrent(p); }), []);
  if (!current) return null;
  const copy = pasPossibleCopy(current, lang, t);

  function go(action: PasPossibleAction) {
    setCurrent(null);
    if (action === 'myMatches') onNavigate({ name: 'tab', tab: 'matches' });
    else if (action === 'explorer') onNavigate({ name: 'tab', tab: 'explorer' });
    else if (action === 'home') onNavigate({ name: 'tab', tab: 'home' });
    else if (action === 'accords') onNavigate({ name: 'accords' });   // « Mes accords » (Lot 10)
    else if (action === 'support') onNavigate({ name: 'support' });   // « Nous écrire » / « Contacter le support » (règle 25)
  }

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={copy.title} onClick={() => setCurrent(null)}>
      <div className="mb-sheet rsv-taken" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{copy.title}</h3>
        <p className="rsv-taken__body">{copy.text}</p>
        <div className="rsv-taken__actions">
          <button type="button" className="mb-btn mb-btn--block" onClick={() => go(copy.primary.action)}>{copy.primary.label}</button>
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => go(copy.secondary.action)}>{copy.secondary.label}</button>
        </div>
      </div>
    </div>
  );
}
