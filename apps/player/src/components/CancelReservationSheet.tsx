import { CANCEL_FREE_BEFORE_MS, activePlayers, type Booking, type MatchPlayer } from '@moubarat/core';
import { useLang, useT } from '../lib/i18n.js';
import { cancelCopy, matchNotice } from '../lib/cancelResa.js';
import { lateCancelNotice } from '../lib/reservationView.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import '../styles/explorer-v2.css';

/* Confirmation d'annulation d'une réservation (Lot 5 — ConfAnnulerResa.dc.html, …Tard, …Match) : une seule feuille pour le ticket (R4) et
   Mes matchs. Le texte est celui des maquettes rempli avec la vraie réservation ; l'avertissement « demi-absence » (§19) suit la règle
   du core (lateCancelNotice) ; si un match vivant est lié, un encadré dit qu'il est annulé avec elle et combien d'inscrits sont prévenus. */

export interface CancelReservationSheetProps {
  booking: Booking;
  venueName: string;
  fieldName: string;
  /** Match lié ENCORE vivant (ni annulé ni joué), avec son effectif — `null` sinon. */
  match: { start: number; players: readonly MatchPlayer[] } | null;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}

export function CancelReservationSheet({ booking, venueName, fieldName, match, busy, onKeep, onConfirm }: CancelReservationSheetProps) {
  const t = useT();
  const lang = useLang();
  const now = Date.now();
  const late = lateCancelNotice(booking.range.start, now) !== null;
  const copy = cancelCopy({
    late, withMatch: match !== null, venueName, fieldName, startMs: booking.range.start, endMs: booking.range.end, nowMs: now,
    limitMs: booking.range.start - CANCEL_FREE_BEFORE_MS, lang, t,
  });
  const others = match ? activePlayers(match.players).filter((p) => p.userId !== CURRENT_USER_ID).length : 0;
  const notice = match ? matchNotice(match.start, others, lang, t) : null;

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={copy.title} onClick={() => { if (!busy) onKeep(); }}>
      <div className="mb-sheet xp-cob" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{copy.title}</h3>
        <p className="rsv-taken__body">{copy.body}</p>
        {notice ? <p className="xp-cancel__match">{notice.before}<b>{notice.moment}</b>{notice.after}</p> : null}
        <div className="rsv-taken__actions">
          <button type="button" className="mb-btn mb-btn--block" disabled={busy} onClick={onKeep}>{copy.keep}</button>
          <button type="button" className="mb-btn mb-btn--danger mb-btn--block" data-loading={busy ? 'true' : undefined} disabled={busy} onClick={onConfirm}>{copy.confirm}</button>
        </div>
      </div>
    </div>
  );
}
