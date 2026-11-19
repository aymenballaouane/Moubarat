import type { MatchTeam } from '@moubarat/core';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import { pitchHeight, pitchLayout, slotPositions, PITCH_W } from '../lib/matchView.js';
import type { SlotView, TeamView } from '../lib/matchDetail.js';
import '../styles/match-view.css';

/* Le terrain du détail du match (lot « Match libre », phase 3 — planches Dv1 à Dv9, Fmt-Vue ; dossier §7) : vert « Forêt » à bandes,
   « ÉQUIPE A · 3/5 » et « ÉQUIPE B · 1/5 », un rond par joueur (son initiale), un rond en pointillés « + » par place libre, « Toi » cerclé
   de rouge. Aucun poste dessiné. À l'horizontale jusqu'à 6 par équipe (A au début, B à la fin — miroir en arabe), à la verticale au-delà
   (A en haut, B en bas) ; les places gardent leur taille, le terrain grandit. Positions reprises des planches (terrain de 346 px), en
   pourcentage de la largeur réelle. */

export function MatchPitch({ views, padel, preview, canPlus, onPlus, help, busy }: {
  views: Record<MatchTeam, TeamView>;
  padel: boolean;
  /** Dv5 : le joueur a touché un « + » de cette équipe, pas encore inscrit — la première place libre devient « Toi ». */
  preview: MatchTeam | null;
  /** Un « + » de cette équipe est-il touchable ? */
  canPlus: (team: MatchTeam) => boolean;
  onPlus: (team: MatchTeam) => void;
  help: string | null;
  busy: boolean;
}) {
  const t = useT();
  const layout = pitchLayout(Math.max(views.A.capacity, views.B.capacity));
  const height = pitchHeight(layout);
  const vertical = layout.orientation === 'v';
  const word = padel ? t('PAIRE') : null;

  function slotsOf(team: MatchTeam): SlotView[] {
    const slots = views[team].slots.slice();
    if (preview === team) {
      const i = slots.findIndex((s) => s.kind === 'free');
      if (i >= 0) slots[i] = { kind: 'me' };
    }
    return slots;
  }
  function render(team: MatchTeam) {
    const pos = slotPositions(layout, team);
    return slotsOf(team).map((s, i) => {
      const p = pos[i];
      if (!p) return null;
      const style = { insetInlineStart: `${(p.x / PITCH_W) * 100}%`, top: p.y };
      if (s.kind === 'me') return <span key={`${team}${i}`} className="mv-slot mv-slot--me" style={style} role="img" aria-label={`${t('Toi')} · ${team}`}>{t('Toi')}</span>;
      if (s.kind === 'player') return <span key={`${team}${i}`} className="mv-slot" style={style} role="img" aria-label={s.name}>{s.initial}</span>;
      const label = team === 'A' ? t('Rejoindre l’équipe A') : t('Rejoindre l’équipe B');
      return canPlus(team)
        ? <button key={`${team}${i}`} type="button" className="mv-slot mv-slot--plus mb-tap" style={style} aria-label={label} disabled={busy} onClick={() => onPlus(team)}>+</button>
        : <span key={`${team}${i}`} className="mv-slot mv-slot--plus" style={style} aria-hidden="true">+</span>;
    });
  }
  const title = (team: MatchTeam) => (
    <>{word ? `${word} ${team}` : t(team === 'A' ? 'ÉQUIPE A' : 'ÉQUIPE B')} · <Ltr>{views[team].taken + (preview === team ? 1 : 0)}/{views[team].capacity}</Ltr></>
  );
  return (
    <div className="mv-pitch-wrap">
      <div className={`mv-pitch mv-pitch--${layout.orientation}`} style={{ height }}>
        <svg className="mv-pitch__lines" aria-hidden="true" viewBox={`0 0 ${PITCH_W} ${height}`} preserveAspectRatio="none">
          <rect x="1" y="1" width={PITCH_W - 2} height={height - 2} rx="14" />
          {vertical ? <path d={`M1 ${height / 2}h${PITCH_W - 2}`} /> : <path d={`M${PITCH_W / 2} 1v${height - 2}`} />}
        </svg>
        <span className="mv-pitch__circle" aria-hidden="true" style={vertical ? { width: 36, height: 36 } : undefined} />
        <span className="mv-team mv-team--a">{title('A')}</span>
        <span className={`mv-team mv-team--b${vertical ? ' mv-team--bottom' : ''}`}>{title('B')}</span>
        {render('A')}
        {render('B')}
        {help && !vertical ? <span className="mv-help">{help}</span> : null}
      </div>
      {help && vertical ? <p className="mv-help-below">{help}</p> : null}
    </div>
  );
}
