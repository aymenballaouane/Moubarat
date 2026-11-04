import { useState } from 'react';
import type { ActionResult } from '../lib/api.js';

/* « Afficher plus » (mise à l'échelle L3, 25/09/2026, décision d'Aymen : un bouton, pas de défilement infini) —
   UNE seule présentation pour toutes les listes paginées de l'app (notifications, réservations, historique, fil de
   l'Explorer). `onLoad` rend le résultat de l'action : en cas d'échec le message est affiché sous le bouton (le curseur
   est conservé côté store, le joueur peut réessayer). Taille normale (pas --sm) : cible tactile ≥ 44 px. Un seul chargement à la fois : le bouton est désactivé pendant
   qu'il travaille. Rien n'est rendu quand il n'y a plus rien à charger. */
export function LoadMoreButton({ visible, loading, onLoad }: {
  visible: boolean; loading: boolean; onLoad: () => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!visible) return null;
  return (
    <div className="mb-loadmore">
      <button
        type="button" className="mb-btn mb-btn--secondary mb-tap" disabled={loading}
        onClick={() => { setError(null); void onLoad().then((r) => { if (!r.ok) setError(r.message); }); }}
      >
        {loading ? 'Chargement…' : 'Afficher plus'}
      </button>
      {error ? <p className="mb-field__error" role="alert">{error}</p> : null}
    </div>
  );
}
