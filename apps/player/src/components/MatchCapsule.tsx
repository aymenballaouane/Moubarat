import type { Match } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import { levelLabel } from '../lib/labels.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { durationMinutes } from '../lib/matchView.js';
import '../styles/match-view.css';

/* La capsule du détail du match (lot B, phase 0 bis — planches Dv1/Dp2) : ballon (raquette pour le padel) · format · barres de niveau et
   niveau · chrono et durée en minutes. Partagée par l'en-tête du détail (MatchHead) et la page d'invitation sans compte (LienMatch,
   phase 2, maquette 02_Page_invitation). */
export function MatchCapsule({ match }: { match: Pick<Match, 'sport' | 'format' | 'level' | 'range'> }) {
  const t = useT();
  const levelBars = match.level === 'COMPETITION' ? 3 : match.level === 'INTERMEDIAIRE' ? 2 : 1;
  return (
    <span className="mv-caps">
      <span className="mv-caps__sport" role="img" aria-label={match.sport === 'PADEL' ? t('Padel') : t('Foot')}><Icon id={match.sport === 'PADEL' ? 'i-padel' : 'i-ball'} /></span>
      <span className="mv-caps__sep" aria-hidden="true" />
      <span className="mv-caps__fmt"><Ltr>{match.format}</Ltr></span>
      <span className="mv-caps__sep" aria-hidden="true" />
      <span className="mv-caps__item">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
          <rect x="1.2" y="8.4" width="3.2" height="5" rx="1" className={levelBars >= 1 ? 'on' : 'off'} />
          <rect x="5.4" y="4.9" width="3.2" height="8.5" rx="1" className={levelBars >= 2 ? 'on' : 'off'} />
          <rect x="9.6" y="1.4" width="3.2" height="12" rx="1" className={levelBars >= 3 ? 'on' : 'off'} />
        </svg>
        {t(levelLabel(match.level))}
      </span>
      <span className="mv-caps__sep" aria-hidden="true" />
      <span className="mv-caps__item">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="14" r="7.6" /><path d="M9.6 2.6h4.8M12 2.6v3.8M18.2 7.2l1.6-1.6M12 14v-3.4" /></svg>
        <span>{fillTemplate(t('{n} min'), { n: String(durationMinutes(match.range)) })}</span>
      </span>
    </span>
  );
}
