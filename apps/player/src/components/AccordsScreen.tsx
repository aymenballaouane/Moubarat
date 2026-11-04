import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import { useToast } from '../lib/useToast.js';
import { deleteBlockerLines, deleteBlockers } from '../lib/profileView.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/reserver.css';
import '../styles/profil2.css';

/* « Tes accords » (Lot 10, Accords.dc.html, règles 30 et 32) : deux accords obligatoires qui ne se retirent qu'en supprimant le compte (conditions d'utilisation et confidentialité ; « 18 ans ou plus »),
   deux interrupteurs (« numéro visible pour jouer », « bons plans des centres »). Retirer « numéro visible » n'enlève rien de ce qui est déjà pris : il ferme seulement rejoindre un match et réserver
   (fenêtre PasPossibleAccord, Lot 9). En bas : « Supprimer mon compte » → « Supprimer ton compte ? ».
   Suppression (règle 36, corrigée le 24/10/2026) : le serveur REFUSE tant qu'il reste une réservation à venir, un match à venir organisé ou rejoint, ou un brassard de capitaine. La maquette de la fenêtre
   dit « annulés, et tout le monde est prévenu » : c'est faux depuis ce choix — la phrase n'est PAS reprise ; elle ne dit que ce qui est vrai (nom et numéro effacés, pas de retour en arrière). Quand le serveur
   refuse, une seconde fenêtre explique quoi régler d'abord (même esprit que « Pas possible pour l'instant »). */

interface AccordsScreenProps {
  store: AppStore;
  onBack: () => void;
  onNavigate: (route: Route) => void;
}

function Switch({ on, label, busy, onToggle }: { on: boolean; label: string; busy: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="pf-switch mb-tap" disabled={busy} onClick={onToggle}><i /></button>
  );
}

export function AccordsScreen({ store, onBack, onNavigate }: AccordsScreenProps) {
  const t = useT();
  const toast = useToast();
  const summary = store.profileSummary;
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);

  useEffect(() => {
    void store.loadProfileSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phoneOn = summary?.profile.phoneVisible ?? true;
  const promoOn = summary?.profile.promoOptIn ?? false;

  async function toggle(patch: { phoneVisible?: boolean; promoOptIn?: boolean }) {
    if (busy || !summary) return;
    setBusy(true);
    const res = await store.setConsents(patch);
    setBusy(false);
    if (!res.ok) toast.show(res.message);
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    const res = await store.deleteAccount();
    setDeleting(false);
    setConfirmDelete(false);
    if (res.ok) return;   // la session est effacée : App.tsx ramène à la connexion
    if (res.code === 'HAS_UPCOMING_COMMITMENTS') {
      const lines = deleteBlockers(res.details);
      if (lines) { setBlocked(deleteBlockerLines(lines, t)); return; }
    }
    toast.show(res.message);
  }

  return (
    <section className="au-screen pf pf-sub" id="s-accords">
      <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button></div>
      <h1 className="pf-sub__title">{t('Tes accords')}</h1>

      <div className="pf-card pf-accords">
        <div className="pf-accord">
          <span className="pf-accord__txt"><b>{t('Conditions d’utilisation et confidentialité')}</b></span>
          <span className="pf-accord__req">{t('Obligatoire')}</span>
        </div>
        <div className="pf-accord">
          <span className="pf-accord__txt"><b>{t('J’ai 18 ans ou plus')}</b></span>
          <span className="pf-accord__req">{t('Obligatoire')}</span>
        </div>
        <div className="pf-accord">
          <span className="pf-accord__txt">
            <b>{t('Mon numéro visible pour jouer')}</b>
            <span>{phoneOn
              ? t('Par l’organisateur des matchs que tu rejoins, les joueurs des matchs que tu organises et les centres où tu réserves. Sans lui, tu peux seulement regarder.')
              : t('Accord retiré. Tes inscriptions et réservations déjà prises restent, et ton numéro y reste visible. Pour rejoindre un nouveau match ou réserver, réactive-le.')}</span>
          </span>
          <Switch on={phoneOn} label={t('Mon numéro visible pour jouer')} busy={busy || !summary} onToggle={() => { void toggle({ phoneVisible: !phoneOn }); }} />
        </div>
        <div className="pf-accord">
          <span className="pf-accord__txt"><b>{t('Les bons plans des centres près de chez moi')}</b></span>
          <Switch on={promoOn} label={t('Les bons plans des centres près de chez moi')} busy={busy || !summary} onToggle={() => { void toggle({ promoOptIn: !promoOn }); }} />
        </div>
      </div>

      <div className="pf-stop">
        <p>{t('Tu veux tout arrêter ? Tu peux supprimer ton compte : ton nom et ton numéro seront effacés.')}</p>
        <button type="button" className="pf-link mb-tap" onClick={() => setConfirmDelete(true)}>{t('Supprimer mon compte')}</button>
      </div>

      {confirmDelete ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Supprimer ton compte ?')} onClick={() => { if (!deleting) setConfirmDelete(false); }}>
          <div className="mb-sheet rsv-taken" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="rsv-taken__title">{t('Supprimer ton compte ?')}</h3>
            <p className="rsv-taken__body">{t('Ton nom et ton numéro seront effacés.')} {t('On ne pourra pas revenir en arrière.')}</p>
            <div className="rsv-taken__actions">
              <button type="button" className="mb-btn mb-btn--block" disabled={deleting} onClick={() => setConfirmDelete(false)}>{t('Je garde mon compte')}</button>
              <button type="button" className="mb-btn mb-btn--danger mb-btn--block" data-loading={deleting ? 'true' : undefined} disabled={deleting} onClick={() => { void deleteAccount(); }}>{t('Oui, supprimer')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {blocked ? (
        <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Pas possible pour l’instant')} onClick={() => setBlocked(null)}>
          <div className="mb-sheet rsv-taken" onClick={(e) => e.stopPropagation()}>
            <span className="rsv-taken__grab" aria-hidden="true" />
            <h3 className="rsv-taken__title">{t('Pas possible pour l’instant')}</h3>
            <p className="rsv-taken__body">{t('Pour supprimer ton compte, règle d’abord ce qui est encore à venir, puis reviens :')}</p>
            <ul className="pf-sheet-lines">{blocked.map((line) => <li key={line}>{line}</li>)}</ul>
            <div className="rsv-taken__actions">
              <button type="button" className="mb-btn mb-btn--block" onClick={() => { setBlocked(null); onNavigate({ name: 'tab', tab: 'matches' }); }}>{t('Voir mes matchs')}</button>
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => setBlocked(null)}>{t('Fermer')}</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
    </section>
  );
}
