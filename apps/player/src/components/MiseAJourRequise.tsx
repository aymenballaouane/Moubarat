import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { isNativeShell, post } from '../lib/native.js';
import '../styles/erreur-reseau.css';

/* MS-041 (audit final, Lot 2d, 18/11/2026) — le serveur exige une version plus récente de l'app (426 APP_UPDATE_REQUIRED).
   Aucune maquette ne couvre cet écran : même mise en page et mêmes classes que l'écran réseau (ErreurReseau.tsx, calque de
   la maquette ErreurReseau) — icône, titre, texte, un bouton. Deux cas :
   - dans l'app iPhone (habillage natif) : le code est embarqué, seule une mise à jour depuis l'App Store le remplace — le
     bouton ouvre la fiche (lien servi par le serveur, `PLAYER_APP_STORE_URL_IOS`) ; sans lien configuré, le texte suffit ;
   - partout ailleurs (site, app Android qui affiche le site) : recharger suffit, le serveur sert déjà la dernière version. */
export function MiseAJourRequise({ storeUrls, native = isNativeShell(), reload = () => window.location.reload() }: {
  storeUrls: { ios: string | null; android: string | null };
  /** Injectables pour les tests. */
  native?: boolean;
  reload?: () => void;
}) {
  const t = useT();
  const storeUrl = native ? storeUrls.ios : null;
  return (
    <section className="rs-screen">
      <span className="rs-mark"><Icon id="i-bulb" className="mb-ic--lg" /></span>
      <h1 className="rs-title">{t('Mets à jour Moubarat')}</h1>
      <p className="rs-text">{native
        ? t('Une nouvelle version de l’app est disponible. Installe-la depuis l’App Store pour continuer.')
        : t('Une nouvelle version de Moubarat est disponible. Recharge pour continuer.')}</p>
      {native ? (
        storeUrl ? (
          <button type="button" className="mb-btn mb-btn--block rs-btn" onClick={() => post({ type: 'openExternal', url: storeUrl })}>
            {t('Ouvrir l’App Store')}
          </button>
        ) : null
      ) : (
        <button type="button" className="mb-btn mb-btn--block rs-btn" onClick={reload}>
          {t('Recharger')}
        </button>
      )}
    </section>
  );
}
