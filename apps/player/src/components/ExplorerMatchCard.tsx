import { activePlayers, type Match, type MatchPlayer, type Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { levelLabel, sportLabel } from '../lib/labels.js';
import { placesLabel } from '../lib/explorerFilters.js';
import { sportIcon } from '../lib/venueView.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import { formatBadge } from '../lib/createMatch.js';
import '../styles/explorer-v2.css';

/* Carte d'un match dans Explorer › Matchs (Lot 5, Explorer.dc.html) : panneau photo à gauche (sport + heure en Bebas), onglet du niveau en haut,
   à droite le centre, le format, l'état (« 3 places libres » / « Complet » / « Tu es inscrit ») et le prix par joueur. Toucher la carte ouvre
   le match — plus de bouton « Rejoindre » sur la carte, la maquette n'en a pas (on rejoint depuis le détail). */

export interface ExplorerMatchCardProps {
  match: Match;
  players: readonly MatchPlayer[];
  venueName: string;
  onOpen: () => void;
}

export function ExplorerMatchCard({ match, players, venueName, onOpen }: ExplorerMatchCardProps) {
  const t = useT();
  const lang = useLang();
  const active = activePlayers(players);
  const mine = match.organizerId === CURRENT_USER_ID || active.some((p) => p.userId === CURRENT_USER_ID);
  const left = match.capacity - active.length;
  const kind = mine ? 'mine' : left <= 0 ? 'full' : 'open';
  // Arabe : « N أماكن متاحة » de 3 à 10 seulement (gabarit de la maquette) — au-delà, « متاح » seul plutôt qu'une grammaire fausse.
  const state = kind === 'mine' ? t('Tu es inscrit') : kind === 'full' ? t('Complet')
    : (placesLabel(left, t, lang) ?? t('Libre'));
  const level = t(levelLabel(match.level)).toUpperCase();
  const sport = match.sport as Sport;

  return (
    <button type="button" className="xp-mcard mb-tap" data-kind={kind} onClick={onOpen}
      aria-label={`${venueName}, ${hhmm(epochMinutesOfDay(match.range.start))}, ${state}`}>
      <span className="xp-mcard__photo">
        <img src={heroPhoto} alt="" />
        <span className="xp-mcard__veil" />
        <span className="xp-mcard__stack">
          <span className="xp-mcard__badge"><Icon id={sportIcon(sport)} className="mb-ic--sm" />{t(sport === 'FOOTBALL' ? 'Foot' : sportLabel(sport)).toUpperCase()}</span>
          <b className="xp-mcard__hour"><Ltr>{hhmm(epochMinutesOfDay(match.range.start))}</Ltr></b>
        </span>
      </span>
      <span className="xp-mcard__tab">{level}</span>
      <span className="xp-mcard__body">
        <span className="xp-mcard__venue">{venueName}</span>
        <span className="xp-mcard__format">{formatBadge(match.format)}</span>
        <span className="xp-mcard__foot">
          <span className="xp-mcard__state"><i />{state}</span>
          <span className="xp-mcard__price">
            <span className="mb-price" data-unit="player"><Ltr>{fmt(match.pricePerPlayer.amount)}</Ltr><span className="mb-price__cur">{t('DA')}</span></span>
          </span>
        </span>
      </span>
    </button>
  );
}
