import { useEffect, useRef, useState } from 'react';
import { activePlayers, type Match, type MatchPlayer, type Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useLang, useT } from '../lib/i18n.js';
import { hhmm, epochMinutesOfDay, relativeDayLabel } from '../lib/format.js';
import { placesLabel, sportChipLabel } from '../lib/explorerFilters.js';
import { NO_VENUE_FILTERS, filterVenues, sortVenuesByName } from '../lib/venueFilters.js';
import { useOpenVenue } from '../lib/useOpenVenue.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import brandMark from '../../../../design/moubarat-icon.svg';
import { formatBadge } from '../lib/createMatch.js';
import '../styles/explorer-v2.css';

/* Recherche d'Explorer (Lot 5, Recherche.dc.html) : page plein écran — retour + champ, puis deux groupes : « Centres » (nom, wilaya, adresse ;
   en mémoire sur le catalogue) et « Matchs » (titre ou format, côté serveur, les premiers résultats). Toucher un centre ouvre sa fiche (R2),
   un match ouvre son détail. Remplace le champ intégré à l'en-tête d'Explorer (l'onglet Équipes garde le sien). */

const MATCH_LIMIT = 5;
const CENTER_LIMIT = 8;

interface Found { match: Match; players: MatchPlayer[] }

export function ExplorerSearch({ store, onNavigate, onClose }: { store: AppStore; onNavigate: (route: Route) => void; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Found[]>([]);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const { openVenue, openingId, error, clearError } = useOpenVenue(store, onNavigate);
  const text = query.trim();

  // Matchs : une requête par mot tapé (300 ms après la dernière frappe), la réponse d'une frappe déjà remplacée est jetée.
  useEffect(() => {
    if (text === '') { seq.current++; setMatches([]); setFailed(false); return; }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      store.searchMatches(text, MATCH_LIMIT).then((found) => {
        if (mine === seq.current) { setMatches(found); setFailed(false); }
      }).catch(() => { if (mine === seq.current) { setMatches([]); setFailed(true); } });
    }, 300);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const centers = text === '' ? [] : sortVenuesByName(filterVenues(store.venues, { ...NO_VENUE_FILTERS, query: text }, null)).slice(0, CENTER_LIMIT);
  const nothing = text !== '' && centers.length === 0 && matches.length === 0 && !failed;
  const now = Date.now();

  const openMatch = (m: Match) => onNavigate(m.organizerId === CURRENT_USER_ID
    ? { name: 'match', mode: 'organizer', matchId: m.id }
    : { name: 'match', mode: 'detail', matchId: m.id });

  return (
    <div className="xp-search" role="dialog" aria-modal="true" aria-label={t('Rechercher')}>
      <header className="xp-search__head">
        <button type="button" className="xp-iconbtn mb-tap" aria-label={t('Retour')} onClick={onClose}><Icon id="i-back" className="mb-ic--sm xp-search__back" /></button>
        <label className="xp-search__field">
          <Icon id="i-search" className="mb-ic--sm" />
          <input
            type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Rechercher')} aria-label={t('Rechercher')} maxLength={80}
          />
          {query !== '' ? (
            <button type="button" className="xp-search__clear mb-tap" aria-label={t('Effacer la recherche')} onClick={() => setQuery('')}><Icon id="i-x" className="mb-ic--sm" /></button>
          ) : null}
        </label>
      </header>

      {error ? (
        <p className="au-error on" role="alert"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span>
          <button type="button" className="xp-filters__clear mb-tap" style={{ marginInlineStart: 'auto' }} onClick={clearError}>OK</button></p>
      ) : null}

      {centers.length > 0 ? (
        <section>
          <h2 className="xp-search__h2">{t('Centres')}</h2>
          <div className="xp-search__list">
            {centers.map((v) => (
              <button key={v.id} type="button" className="xp-search__row mb-tap" aria-busy={openingId === v.id} onClick={() => { void openVenue(v.id); }}>
                <span className="xp-search__thumb mb-pitch"><img className="xp-search__mark" src={brandMark} alt="" /></span>
                <span className="xp-search__body">
                  <span className="xp-search__tag">{v.sports.map((s) => t(sportChipLabel(s as Sport))).join(' · ').toUpperCase()}</span>
                  <b>{v.name}</b>
                </span>
                <Icon id="i-arrow" className="xp-search__chev" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {matches.length > 0 ? (
        <section>
          <h2 className="xp-search__h2">{t('Matchs')}</h2>
          <div className="xp-search__list">
            {matches.map(({ match, players }) => {
              const left = match.capacity - activePlayers(players).length;
              const places = left > 0 ? placesLabel(left, t, lang) : null;
              return (
                <button key={match.id} type="button" className="xp-search__row mb-tap" onClick={() => openMatch(match)}>
                  <span className="xp-search__thumb mb-pitch"><img className="xp-search__mark" src={brandMark} alt="" /></span>
                  <span className="xp-search__body">
                    <span className="xp-search__tag">
                      {relativeDayLabel(match.range.start, now, t).toUpperCase()} · <Ltr>{hhmm(epochMinutesOfDay(match.range.start))}</Ltr>
                    </span>
                    <b>{store.venueName(match.venueId)}</b>
                    <span className="xp-search__meta">{formatBadge(match.format)}{places ? ` · ${places}` : ''}</span>
                  </span>
                  <Icon id="i-arrow" className="xp-search__chev" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {failed ? <p className="mb-note__text" role="alert">{t('Impossible de charger les matchs')}</p> : null}
      {nothing ? (
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-search" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Aucun résultat')}</h4>
        </div>
      ) : null}
    </div>
  );
}
