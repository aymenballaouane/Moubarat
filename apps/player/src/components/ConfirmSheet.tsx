/* Sheet de confirmation partagee — les actions irreversibles (annuler un
   match/une reservation, retirer un joueur, quitter l'equipe, retirer un
   defi) demandent confirmation AVANT d'agir (spec §11.11 : « 5 already-
   shipped actions... fire immediately on tap with only a post-hoc toast »).
   Meme role que ConfirmModal cote CRM, recodee avec les primitives .mb-*
   de l'app joueur (bottom sheet mobile, pas une modale desktop). Lot 2
   (23/10/2026) : un retour haptique sur l'action irréversible elle-même —
   jamais sur Annuler/Retour, qui ne font rien d'irréversible. */
import { haptic } from '../lib/haptic.js';

interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Le bouton de confirmation est danger par defaut (action destructrice). */
  danger?: boolean;
  onConfirm: () => void;
  /** Seconde action possible, entre confirmer et fermer (BUG-1, 26/09/2026 : « Annuler seulement le match »
      à côté de « Annuler le match et ma réservation »). Absente = feuille à deux boutons, comme avant. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Libellé du bouton qui ferme sans rien faire — « Retour » quand les autres boutons disent déjà « Annuler … ». */
  cancelLabel?: string;
  onCancel: () => void;
}

export function ConfirmSheet({
  title, body, confirmLabel, danger = true, onConfirm, secondaryLabel, onSecondary, cancelLabel = 'Annuler', onCancel,
}: ConfirmSheetProps) {
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="mb-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{body}</p>
        <button type="button" className={`mb-btn mb-btn--block${danger ? ' mb-btn--danger' : ''}`}
          onClick={() => { haptic(danger ? 'warning' : 'light'); onConfirm(); }}>
          {confirmLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block"
            onClick={() => { haptic(danger ? 'warning' : 'light'); onSecondary(); }}>
            {secondaryLabel}
          </button>
        ) : null}
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
