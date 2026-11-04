import { useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { claimConfirmedText, claimSlotLabel, type Claim } from '../lib/claimView.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/claim.css';

/* « C'est bien toi ? » (règle 21 ; Creer.dc.html, MesMatchs.dc.html, Notifications.dc.html, CestMoi.dc.html, PasMoi.dc.html) : une réservation qu'un centre a saisie à ton numéro. Elle ne compte
   pour toi qu'une fois confirmée. « C'est moi » → elle passe à ton nom, « C'est confirmé ! » ; « Ce n'est pas moi » → le centre est prévenu, elle disparaît de tes matchs, « C'est noté ! ».
   Sans réponse : elle reste au nom du centre, un rappel la veille, aucune absence. */

type Answer = 'confirm' | 'decline';

/** La réponse, la feuille « C'est confirmé ! » / « C'est noté ! » qui suit, et son toast d'erreur — partagés par la carte (Mes matchs, Créer) et la notification. */
export function useClaimAnswer(store: AppStore, onNavigate: (route: Route) => void): {
  answer: (claim: Claim, kind: Answer) => Promise<void>; busy: boolean; sheet: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ claim: Claim; kind: Answer } | null>(null);

  async function answer(claim: Claim, kind: Answer) {
    if (busy) return;
    setBusy(true);
    const res = await store.answerClaim(claim.bookingId, kind);
    setBusy(false);
    if (res.ok) setDone({ claim, kind }); else toast.show(res.message);
  }

  const sheet = (
    <>
      {done ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={done.kind === 'confirm' ? t('C’est confirmé !') : t('C’est noté !')} onClick={() => setDone(null)}>
          <div className="mb-sheet rsv-taken" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="rsv-taken__title">{done.kind === 'confirm' ? t('C’est confirmé !') : t('C’est noté !')}</h3>
            <p className="rsv-taken__body">
              {done.kind === 'confirm'
                ? claimConfirmedText(done.claim, t)
                : t('On prévient le centre que ce n’est pas toi. Cette réservation n’apparaîtra plus dans tes matchs.')}
            </p>
            <div className="rsv-taken__actions">
              <button type="button" className="mb-btn mb-btn--block" onClick={() => setDone(null)}>{t('OK')}</button>
              {done.kind === 'confirm' ? (
                <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => { setDone(null); onNavigate({ name: 'match', mode: 'create' }); }}>
                  {t('Créer un match sur ce créneau')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </>
  );
  return { answer, busy, sheet };
}

/** La carte de la maquette : « RÉSERVÉ PAR TÉLÉPHONE », le centre et le créneau, « C'est bien toi ? », deux boutons. */
export function ClaimCard({ claim, busy, onAnswer }: { claim: Claim; busy: boolean; onAnswer: (kind: Answer) => void }) {
  const t = useT();
  return (
    <section className="cl-card" aria-label={t('Réservation à reconnaître')} data-alerte="1">
      <div className="cl-head">
        <span className="cl-ic"><Icon id="i-phone" /></span>
        <span className="cl-tag">{t('RÉSERVÉ PAR TÉLÉPHONE')}</span>
      </div>
      <span className="cl-line"><b>{claim.venue.name}</b> · {claimSlotLabel(claim)}</span>
      <span className="cl-ask">{t('C’est bien toi ?')}</span>
      <div className="cl-actions">
        <button type="button" className="cl-btn cl-btn--yes mb-tap" disabled={busy} onClick={() => onAnswer('confirm')}>{t('C’est moi')}</button>
        <button type="button" className="cl-btn cl-btn--no mb-tap" disabled={busy} onClick={() => onAnswer('decline')}>{t('Ce n’est pas moi')}</button>
      </div>
    </section>
  );
}
