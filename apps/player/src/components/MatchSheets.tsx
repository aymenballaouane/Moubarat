import '../styles/explorer-v2.css';
import '../styles/match-detail.css';

/* Feuilles du détail d'un match et de la vue organisateur (Lot 7) : la confirmation générique (ConfDesinscription, ConfRetirer, ConfAnnulerMatch : titre, texte, deux
   boutons). « Choisis ton équipe » a été retirée au lot « Match libre » (phase 3) : « Rejoindre le match » place le joueur d'office, un
   « + » choisit l'équipe directement sur le terrain (Dv1, Dv5). */

/** Confirmation à deux boutons (maquettes ConfDesinscription, ConfRetirer, ConfAnnulerMatch) : « Garder » à gauche en plein, l'action
    irréversible en danger. */
export function MatchConfirmSheet({ title, body, keep, confirm, busy, onKeep, onConfirm }: {
  title: string;
  body: string;
  keep: string;
  confirm: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={title} onClick={() => { if (!busy) onKeep(); }}>
      <div className="mb-sheet xp-cob" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{title}</h3>
        <p className="rsv-taken__body">{body}</p>
        <div className="rsv-taken__actions">
          <button type="button" className="mb-btn mb-btn--block" disabled={busy} onClick={onKeep}>{keep}</button>
          <button type="button" className="mb-btn mb-btn--danger mb-btn--block" data-loading={busy ? 'true' : undefined} disabled={busy} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
