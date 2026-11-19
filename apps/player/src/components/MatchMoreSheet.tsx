import { useState } from 'react';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { ReportSheet, type ReportTarget } from './ReportSheet.js';
import { useT } from '../lib/i18n.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { isolate } from '../lib/pasPossible.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/match-more.css';

/* Lot B, phase 4 (maquettes 3_Bloquer : 01_Menu_signaler_bloquer, 02_Confirmation_bloquer) — le bouton « … » du détail du match ouvre
   « Que veux-tu faire ? » : « Signaler ce match », « Signaler un joueur » (le signalement existant, inchangé) et « Bloquer un joueur » :
   choisir le joueur parmi ceux du match (« Qui veux-tu bloquer ? »), puis la confirmation. Les effets sont appliqués par le serveur
   (modules/blocks) ; personne n'est prévenu ; le blocage se lève dans Profil › Confidentialité › Joueurs bloqués. */

export interface MatchPerson { userId: string; name: string }

type Step = { kind: 'menu' } | { kind: 'report'; targets: ReportTarget[] } | { kind: 'pick' } | { kind: 'confirm'; person: MatchPerson };

export function MatchMoreSheet({ matchId, players, store, onClose, onToast }: {
  matchId: string;
  /** Les autres joueurs du match (jamais soi-même), organisateur compris. */
  players: readonly MatchPerson[];
  store: AppStore;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [busy, setBusy] = useState(false);
  const playerTargets: ReportTarget[] = players.map((p) => ({ type: 'PLAYER', id: p.userId, label: p.name }));

  if (step.kind === 'report') {
    return (
      <ReportSheet
        targets={step.targets}
        send={(target, reason, note) => store.sendReport(target, reason, note)}
        onClose={onClose}
        onSent={(duplicate) => { onClose(); onToast(duplicate ? t('Tu as déjà signalé ça : le support s’en occupe.') : t('Merci, c’est transmis au support Moubarat.')); }}
      />
    );
  }

  async function block(person: MatchPerson) {
    if (busy) return;
    setBusy(true);
    const res = await store.blockPlayer(person.userId);
    setBusy(false);
    if (!res.ok) { onToast(res.message); return; }
    onClose();
    onToast(fillTemplate(t('{nom} est bloqué.'), { nom: isolate(person.name) }));
  }

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Que veux-tu faire ?')} onClick={onClose}>
      <div className="mb-sheet xp-cob mm2" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        {step.kind === 'menu' ? (
          <>
            <h3 className="mm2-t">{t('Que veux-tu faire ?')}</h3>
            <MoreRow icon={<FlagIcon />} title={t('Signaler ce match')} sub={t('Faux match, contenu ou lieu douteux.')}
              onClick={() => setStep({ kind: 'report', targets: [{ type: 'MATCH', id: matchId, label: t('Ce match') }] })} />
            {players.length > 0 ? (
              <>
                <MoreRow icon={<UserFlagIcon />} title={t('Signaler un joueur')} sub={t('Insultes, arnaque, faux profil.')}
                  onClick={() => setStep({ kind: 'report', targets: playerTargets })} />
                <MoreRow icon={<BlockIcon />} danger title={t('Bloquer un joueur')} sub={t('Tu ne le croiseras plus dans tes matchs.')}
                  onClick={() => setStep({ kind: 'pick' })} />
              </>
            ) : null}
            <button type="button" className="mm2-close mb-tap" onClick={onClose}>{t('Fermer')}</button>
          </>
        ) : step.kind === 'pick' ? (
          <>
            <h3 className="mm2-t">{t('Qui veux-tu bloquer ?')}</h3>
            <div className="mm2-list">
              {players.map((p) => (
                <button key={p.userId} type="button" className="mm2-person mb-tap" onClick={() => setStep({ kind: 'confirm', person: p })}>
                  <span className="mm2-av" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                  <span className="mm2-person__n"><Ltr>{p.name}</Ltr></span>
                  <Icon id="i-arrow" className="mm2-row__go" />
                </button>
              ))}
            </div>
            <button type="button" className="mm2-close mb-tap" onClick={() => setStep({ kind: 'menu' })}>{t('Annuler')}</button>
          </>
        ) : (
          <>
            <div className="mm2-who">
              <span className="mm2-av mm2-av--lg" aria-hidden="true">{step.person.name.charAt(0).toUpperCase()}</span>
              <h3 className="mm2-who__t">{fillTemplate(t('Bloquer {nom} ?'), { nom: isolate(step.person.name) })}</h3>
            </div>
            <ul className="mm2-bullets">
              <li>{t('Tu ne verras plus ses matchs.')}</li>
              <li>{t('Il ne pourra plus rejoindre les tiens.')}</li>
              <li>{t('Il n’est pas prévenu. Tu peux le débloquer dans Profil, Confidentialité.')}</li>
            </ul>
            <button type="button" className="mv-cta mb-tap" data-loading={busy ? 'true' : undefined} disabled={busy} onClick={() => { void block(step.person); }}>
              {fillTemplate(t('Bloquer {nom}'), { nom: isolate(step.person.name) })}
            </button>
            <button type="button" className="mm2-close mb-tap" onClick={onClose}>{t('Annuler')}</button>
          </>
        )}
      </div>
    </div>
  );
}

function MoreRow({ icon, title, sub, onClick, danger = false }: { icon: JSX.Element; title: string; sub: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className="mm2-row mb-tap" onClick={onClick}>
      <span className={`mm2-row__ic${danger ? ' mm2-row__ic--danger' : ''}`} aria-hidden="true">{icon}</span>
      <span className="mm2-row__txt"><b>{title}</b><span>{sub}</span></span>
      <Icon id="i-arrow" className="mm2-row__go" />
    </button>
  );
}

const FlagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
const UserFlagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 3v7M16 3h4l-1 1.6 1 1.6h-4" /></svg>
);
const BlockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>
);
