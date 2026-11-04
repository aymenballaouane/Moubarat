import { useEffect, useState } from 'react';
import type { Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import { fmt, hhmm } from '../lib/format.js';
import { sportLabel } from '../lib/labels.js';
import { sportIcon } from '../lib/venueView.js';
import { filterOptions } from '../lib/venueFilters.js';
import type { VenueSummary } from '../state/store.js';
import type { AppStore } from '../state/useAppStore.js';
import brandMark from '../../../../design/moubarat-icon.svg';
import '../styles/reserver.css';

/* R1 « Trouve ton terrain » (Lot 5, patron Reserver.dc.html, étape "terrains") — point d'entrée
   RAPIDE de Réserver : tous les centres réels (GET /venues + /venues/availability-summary, déjà
   chargés par l'app), filtre sport rapide, une carte compacte par centre. Distinct de l'Explorer ›
   Terrains (VenuesPanel, point 7 du lot — pas encore repeint) qui reste l'écran de recherche
   complet (filtres/tri/recherche) : ici, on va vite. Les pastilles de créneaux du maquette
   (jusqu'à 4 heures par centre) ne sont PAS reproduites : le serveur ne donne qu'un prochain
   départ par centre (GET /venues/availability-summary, pas une liste) — jamais un horaire
   inventé pour remplir une rangée de boutons. */

interface VenuesTerrainsProps {
  store: AppStore;
  onPick: (venueId: string) => Promise<{ ok: boolean; message?: string | undefined }>;
  onExit?: (() => void) | undefined;
  /** Mode « Créer un match » (Lot 6, maquette Reserver mode=match) : fil d'Ariane + bandeau « Choisis le terrain de ton match ». */
  matchMode?: boolean | undefined;
}

export function VenuesTerrains({ store, onPick, onExit, matchMode }: VenuesTerrainsProps) {
  const t = useT();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sports, setSports] = useState<Set<Sport> | null>(null);

  useEffect(() => { void store.loadVenueAvailability(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const venues = store.venues;
  const availability = store.venueAvailability;
  const realSports = filterOptions(venues).sports;
  const active = sports ?? new Set(realSports);

  async function pick(venueId: string) {
    if (openingId !== null) return;
    setError(null);
    setOpeningId(venueId);
    const res = await onPick(venueId);
    setOpeningId(null);
    if (!res.ok) setError(res.message ?? t('Ce centre est indisponible pour le moment.'));
  }

  function toggleSport(s: Sport) {
    setSports((prev) => {
      const base = prev ?? new Set(realSports);
      if (base.has(s) && base.size <= 1) return base;
      const next = new Set(base);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const visible = venues.filter((v) => v.sports.some((s) => active.has(s as Sport)));

  return (
    <section className="au-screen" id="s-venues">
      <div className="bk-pad">
        <div className="bk-top">
          {onExit ? <button type="button" className="mb-back mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button> : <span className="mb-back-spacer" />}
          {matchMode ? <span className="rsv-r1__crumb">{t('CRÉER UN MATCH · LE TERRAIN')}</span> : <span className="mb-back-spacer" />}
        </div>
        <h1 className="mb-d2 rsv-h1">{t('Trouve ton terrain')}</h1>
        {matchMode ? <p className="rsv-r1__banner"><i aria-hidden="true" />{t('Choisis le terrain de ton match')}</p> : null}

        {realSports.length > 1 ? (
          <div className="rsv-sportfilter" role="group" aria-label={t('Filtrer par sport')}>
            {realSports.map((s) => (
              <button
                key={s} type="button" className="rsv-chip" aria-pressed={active.has(s)}
                onClick={() => toggleSport(s)}
              >
                {t(sportLabel(s))}
              </button>
            ))}
          </div>
        ) : null}

        {store.venuesError && venues.length === 0 ? (
          <div className="mb-note">
            <div className="mb-note__mark"><Icon id="i-x" className="mb-ic--lg" /></div>
            <h4 className="mb-note__title">{t('Centres indisponibles')}</h4>
            <p className="mb-note__text">{t('Impossible de charger la liste des centres pour le moment. Vérifie ta connexion et réessaie.')}</p>
            <button type="button" className="mb-btn mb-btn--sm mb-tap" onClick={() => { void store.refreshVenues(); }}>{t('Réessayer')}</button>
          </div>
        ) : venues.length === 0 ? (
          <div className="mb-note">
            <div className="mb-note__mark"><Icon id="i-locate" className="mb-ic--lg" /></div>
            <h4 className="mb-note__title">{t('Aucun centre partenaire pour l’instant')}</h4>
            <p className="mb-note__text">{t('Les premiers centres arrivent bientôt — reviens vite.')}</p>
          </div>
        ) : (
          <div className="rsv-vlist">
            {error ? (
              <p className="au-error on" role="alert"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span></p>
            ) : null}
            {visible.map((v) => (
              <VenueRow key={v.id} venue={v} freeStarts={availability?.[v.id]?.freeStarts ?? null} nextStartMin={availability?.[v.id]?.nextStartMin ?? null}
                opening={openingId === v.id} onOpen={() => { void pick(v.id); }} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VenueRow({ venue, freeStarts, nextStartMin, opening, onOpen }: {
  venue: VenueSummary; freeStarts: number | null; nextStartMin: number | null; opening: boolean; onOpen: () => void;
}) {
  const t = useT();
  const primarySport = venue.sports[0] as Sport | undefined;

  return (
    <article
      className={`rsv-vrow${opening ? ' rsv-vrow--opening' : ''}`} role="button" tabIndex={0} aria-busy={opening}
      aria-label={venue.name}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <span className="rsv-vrow__thumb mb-pitch">
        <img className="rsv-vrow__mark" src={brandMark} alt="" />
        {primarySport ? <span className="rsv-vrow__badge"><Icon id={sportIcon(primarySport)} className="mb-ic--sm" />{t(sportLabel(primarySport))}</span> : null}
      </span>
      <span className="rsv-vrow__body">
        <span className="rsv-vrow__name">{venue.name}</span>
        {venue.priceFromDa !== null ? (
          <span className="rsv-vrow__price">{t('dès')} <b className="mb-price" data-unit="hour">{fmt(venue.priceFromDa)}<span className="mb-price__cur">{t('DA')}</span></b></span>
        ) : null}
        {freeStarts === null ? null : freeStarts > 0 ? (
          <span className="rsv-vrow__avail">
            <span className="rsv-vrow__dot" />
            {nextStartMin !== null ? <>{t('Prochain')} <Ltr>{hhmm(nextStartMin)}</Ltr></> : t('Créneaux libres')}
          </span>
        ) : (
          <span className="rsv-vrow__avail rsv-vrow__avail--none"><span className="rsv-vrow__dot rsv-vrow__dot--off" />{t('Complet aujourd’hui')}</span>
        )}
      </span>
      <Icon id="i-arrow" className="rsv-vrow__chev" />
    </article>
  );
}
