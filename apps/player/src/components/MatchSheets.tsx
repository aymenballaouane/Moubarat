import type { MatchTeam } from '@moubarat/core';
import { useT } from '../lib/i18n.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { freeCount, type SlotView, type TeamView } from '../lib/matchDetail.js';
import '../styles/explorer-v2.css';
import '../styles/match-detail.css';

/* Feuilles du détail d'un match et de la vue organisateur (Lot 7) : « Choisis ton équipe » / « Change d'équipe » (DetailMatchChoixEquipe,
   DetailMatchChangerEquipe) et la confirmation générique (ConfDesinscription, ConfRetirer, ConfAnnulerMatch : titre, texte, deux
   boutons). Présentationnelles — la règle (quelle équipe a de la place) vient du core, les appels au store restent dans l'écran. */

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

/** « 3 places » / « Complète » dans l'option d'une équipe (maquette : `k + ' place(s)'`). */
export function placesText(n: number, t: (k: string) => string): string {
  if (n <= 0) return t('Complète');
  return n === 1 ? t('1 place') : fillTemplate(t('{n} places'), { n: String(n) });
}

export function TeamAvatars({ slots }: { slots: readonly SlotView[] }) {
  const t = useT();
  const taken = slots.filter((s) => s.kind !== 'free');
  return (
    <span className="md-mini" aria-hidden="true">
      {taken.map((s, i) => (
        <span key={i} className={`md-mini__av${s.kind === 'me' ? ' md-mini__av--me' : ''}`}>{s.kind === 'me' ? t('TOI') : s.kind === 'player' ? s.initial : ''}</span>
      ))}
    </span>
  );
}

/** « Choisis ton équipe » (ou « Change d'équipe ») : deux options ; l'équipe qui a le plus de places est choisie d'office. */
export function ChooseTeamSheet({ mode, padel, views, mine, choice, onChoice, priceLine, ruleLine, busy, onClose, onConfirm }: {
  mode: 'join' | 'change';
  padel: boolean;
  views: Record<MatchTeam, TeamView>;
  /** Mon équipe actuelle (mode « change »). */
  mine: MatchTeam | null;
  choice: MatchTeam | null;
  onChoice: (team: MatchTeam) => void;
  priceLine: string;
  ruleLine: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const word = t(padel ? 'PAIRE' : 'ÉQUIPE');
  const title = mode === 'change' ? t(padel ? 'Change de paire' : 'Change d’équipe') : t(padel ? 'Choisis ta paire' : 'Choisis ton équipe');
  const label = (team: MatchTeam) => `${word} ${team}`;
  const possible = (team: MatchTeam) => freeCount(views[team]) > 0 && !(mode === 'change' && team === mine);
  const confirmLabel = choice === null
    ? t(padel ? 'L’autre paire est complète' : 'L’autre équipe est complète')
    : `${t(mode === 'change' ? (padel ? 'Je passe dans la paire' : 'Je passe dans l’équipe') : (padel ? 'Je rejoins la paire' : 'Je rejoins l’équipe'))} ${choice}`;
  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={title} onClick={() => { if (!busy) onClose(); }}>
      <div className="mb-sheet xp-cob" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{title}</h3>
        <div className="md-opts" role="radiogroup" aria-label={title}>
          {(['A', 'B'] as const).map((team) => {
            const free = freeCount(views[team]);
            const ok = possible(team);
            const current = mode === 'change' && team === mine;
            return (
              <button
                key={team} type="button" role="radio" aria-checked={choice === team} disabled={!ok}
                aria-label={`${label(team)}, ${placesText(free, t)}`}
                className="md-opt mb-tap" data-selected={choice === team ? 'true' : undefined}
                onClick={() => { if (ok) onChoice(team); }}
              >
                <b>{label(team)}</b>
                <TeamAvatars slots={views[team].slots} />
                <span className="md-opt__free">
                  <i data-tone={current ? 'mine' : free === 0 ? 'full' : 'free'} />
                  {current ? t(padel ? 'Ta paire' : 'Ton équipe') : placesText(free, t)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="md-sheet__rules"><span>{priceLine}</span><span>{ruleLine}</span></p>
        <button
          type="button" className="mb-btn mb-btn--block" disabled={choice === null || busy}
          data-loading={busy ? 'true' : undefined} onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
