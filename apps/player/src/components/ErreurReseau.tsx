import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import type { BootFailureKind } from '../lib/bootFailure.js';
import '../styles/erreur-reseau.css';

/* Calque de refonte-app-joueur/maquettes/ErreurReseau(Ar).dc.html — écran plein page
   partagé, pas un `.mb-note` inline : icône i-wifi-off (extraite telle quelle de la
   maquette, même precedent que i-home-fill), un seul bouton "Réessayer". Aucun minuteur
   de retry automatique ici (le texte le promet, mais chaque appelant sait déjà comment
   relancer SON propre chargement — ce composant reste une simple surface, jamais un
   client réseau de plus). */

/* Audit final, MS-028 (12/11/2026) : `kind` — « Pas de réseau » seulement quand le téléphone se dit hors ligne ; sinon c'est
   Moubarat qui ne répond pas (mise à jour, panne), et l'écran le dit au lieu d'accuser la connexion du joueur. Même mise en
   page que la maquette, seuls l'icône et le texte changent. Le réessai automatique promis est fait par l'appelant (App.tsx). */
export function ErreurReseau({ onRetry, kind = 'offline' }: { onRetry: () => void; kind?: BootFailureKind }) {
  const t = useT();
  const server = kind === 'server';
  return (
    <section className="rs-screen">
      <span className="rs-mark"><Icon id={server ? 'i-clock' : 'i-wifi-off'} className="mb-ic--lg" /></span>
      <h1 className="rs-title">{t(server ? 'Moubarat ne répond pas' : 'Pas de réseau')}</h1>
      <p className="rs-text">{t(server
        ? 'Mise à jour ou panne de notre côté, ou connexion trop faible. On réessaie tout seul dans quelques secondes.'
        : 'Vérifie ta connexion. On réessaie tout seul dès que ça revient.')}</p>
      <button type="button" className="mb-btn mb-btn--block rs-btn" onClick={onRetry}>
        {t('Réessayer')}
      </button>
    </section>
  );
}
