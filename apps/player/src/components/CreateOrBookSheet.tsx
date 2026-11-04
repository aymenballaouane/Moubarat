import { Icon } from './Icon.js';
import { haptic } from '../lib/haptic.js';
import { useT } from '../lib/i18n.js';
import '../styles/explorer-v2.css';

/* « Tu veux faire quoi ? » (Lot 5, CreerOuReserver.dc.html) : la feuille du bouton « + » de la barre — Réserver un terrain (centre, jour,
   heure) ou Créer un match (un créneau est déjà pris, il manque des joueurs). Remplace l'ouverture directe de Créer un match. */

export interface CreateOrBookSheetProps {
  onBook: () => void;
  onCreate: () => void;
  onClose: () => void;
}

export function CreateOrBookSheet({ onBook, onCreate, onClose }: CreateOrBookSheetProps) {
  const t = useT();
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Tu veux faire quoi ?')} onClick={onClose}>
      <div className="mb-sheet xp-cob" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{t('Tu veux faire quoi ?')}</h3>
        <button type="button" className="xp-cob__row mb-tap" onClick={() => { haptic('light'); onBook(); }}>
          <span className="xp-cob__ic"><Icon id="i-pitch" /></span>
          <span className="xp-cob__txt">
            <b>{t('Réserver un terrain')}</b>
            <span>{t('Tu choisis le centre, le jour et l’heure.')}</span>
          </span>
          <Icon id="i-arrow" className="xp-cob__chev" />
        </button>
        <button type="button" className="xp-cob__row mb-tap" onClick={() => { haptic('light'); onCreate(); }}>
          <span className="xp-cob__ic xp-cob__ic--brand"><Icon id="i-user-plus" /></span>
          <span className="xp-cob__txt">
            <b>{t('Créer un match')}</b>
            <span>{t('Tu as un créneau, il te manque des joueurs.')}</span>
          </span>
          <Icon id="i-arrow" className="xp-cob__chev" />
        </button>
        <button type="button" className="xp-cob__close mb-tap" onClick={onClose}>{t('Fermer')}</button>
      </div>
    </div>
  );
}
