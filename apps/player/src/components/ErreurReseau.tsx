import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import '../styles/erreur-reseau.css';

/* Calque de refonte-app-joueur/maquettes/ErreurReseau(Ar).dc.html — écran plein page
   partagé, pas un `.mb-note` inline : icône i-wifi-off (extraite telle quelle de la
   maquette, même precedent que i-home-fill), un seul bouton "Réessayer". Aucun minuteur
   de retry automatique ici (le texte le promet, mais chaque appelant sait déjà comment
   relancer SON propre chargement — ce composant reste une simple surface, jamais un
   client réseau de plus). */

export function ErreurReseau({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <section className="rs-screen">
      <span className="rs-mark"><Icon id="i-wifi-off" className="mb-ic--lg" /></span>
      <h1 className="rs-title">{t('Pas de réseau')}</h1>
      <p className="rs-text">{t('Vérifie ta connexion. On réessaie tout seul dès que ça revient.')}</p>
      <button type="button" className="mb-btn mb-btn--block rs-btn" onClick={onRetry}>
        {t('Réessayer')}
      </button>
    </section>
  );
}
