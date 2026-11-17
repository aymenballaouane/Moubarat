import type { Match, MatchPlayer } from '@moubarat/core';
import { MatchCardArt } from './MatchCardArt.js';
import { Ltr } from './Ltr.js';
import { Icon } from './Icon.js';
import { VenuePhoto } from './VenuePhoto.js';
import { useT, useTn } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { cardArtKind, formatPill, freePlaces, placesBadge } from '../lib/matchCardView.js';
import '../styles/match-card.css';

/* La carte de match de l'accueil et de l'onglet Jouer (lot « Match libre », phase 2 — planche Cd2 telle que rendue dans Acc5, Acc6 et
   Jo1 ; dossier §6). Le minimum pour toucher et ouvrir le match : une grande image avec le format, les places et l'heure, puis le lieu,
   la wilaya et le prix par joueur. Ni jauge, ni niveau, ni texte gris en plus. Match complet : image et textes gris, pastille
   « Complet », la carte reste touchable. Toute la carte est un seul bouton. */

const NBSP = String.fromCharCode(0xa0);

export function MatchListCard({ match, players, venueName, venueWilaya, photoUrl, onOpen }: {
  match: Match;
  players: readonly MatchPlayer[];
  venueName: string;
  venueWilaya?: string | undefined;
  /** Phase photos : la photo du centre (vignette), `null` sans photo. */
  photoUrl?: string | null | undefined;
  onOpen: () => void;
}) {
  const t = useT();
  const tn = useTn();
  const free = freePlaces(match, players);
  const badge = placesBadge(free);
  const full = badge.tone === 'full';
  const placesText = badge.kind === 'full' ? t('Complet') : badge.kind === 'last' ? t('Plus que 1 place') : tn('{n} places', free);
  const hour = hhmm(epochMinutesOfDay(match.range.start));
  const price = match.pricePerPlayer.amount;
  return (
    <button type="button" className="mc mb-tap" data-full={full ? 'true' : undefined} onClick={onOpen}
      aria-label={`${hour} · ${venueName} · ${formatPill(match)} · ${placesText}`}>
      <span className="mc-top">
        {/* Phase photos : la photo du centre si elle existe ; sinon l'illustration du sport (centre) ou le logo (match libre) — dossier §6. */}
        <span className="mc-art"><VenuePhoto src={photoUrl ?? null}><MatchCardArt kind={cardArtKind(match)} /></VenuePhoto></span>
        <span className="mc-scrim" aria-hidden="true" />
        <span className="mc-pill mc-pill--format"><Ltr>{formatPill(match)}</Ltr></span>
        <span className="mc-pill mc-pill--places" data-tone={badge.tone}>{placesText}</span>
        <span className="mc-hour"><Ltr>{hour}</Ltr></span>
      </span>
      <span className="mc-body">
        <span className="mc-name">{venueName}</span>
        <span className="mc-row">
          <span className="mc-city">
            {venueWilaya ? <><Icon id="i-pin" className="mc-city__ic" /><Ltr>{venueWilaya}</Ltr></> : null}
          </span>
          {price > 0 ? (
            <span className="mc-price">
              <Ltr>{fmt(price).split(' ').join(NBSP)}</Ltr>{NBSP}{t('DA')} <span className="mc-price__unit">{t('/ joueur')}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
