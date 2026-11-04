import type { ReactNode } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** Motif d'annulation (15/09/2026) : certaines confirmations exigent un
      choix actif avant d'être possibles (ex. Annuler une réservation —
      client ou erreur de saisie du centre, jamais présélectionné) — le
      bouton reste désactivé tant que l'appelant ne lève pas ce drapeau,
      plutôt qu'un clic qui échouerait silencieusement côté serveur. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Port fidele de confirmModal() (prototype) : un seul overlay, un seul jeu de
    boutons Retour/Confirmer — utilise partout ou une action est destructive
    ou irreversible (annuler, desactiver, cloturer la caisse). */
export function ConfirmModal({ open, title, body, confirmLabel, confirmDisabled, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="cm-modal-bg on">
      <div className="cm-modal">
        <h3>{title}</h3>
        <div>{body}</div>
        <div className="acts">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={onCancel}>Retour</button>
          <button type="button" className="mb-btn mb-btn--danger mb-btn--sm" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel ?? 'Confirmer'}</button>
        </div>
      </div>
    </div>
  );
}
