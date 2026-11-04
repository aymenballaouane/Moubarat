import { useEffect } from 'react';
import type { Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { fmt } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { fieldFormatList, sportIcon } from '../lib/venueView.js';
import { useOpenVenue } from '../lib/useOpenVenue.js';
import { useGeolocation } from '../lib/geo.js';
import { freeSlotsLabel, partnerCountLabel, sportChipLabel } from '../lib/explorerFilters.js';
import {
  NO_VENUE_FILTERS, filterOptions, filterVenues, isPristine, sortVenuesByDistance, type VenueFilters,
} from '../lib/venueFilters.js';
import type { VenueAvailability } from '../lib/mappers.js';
import type { VenueSummary } from '../state/store.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import brandMark from '../../../../design/moubarat-icon.svg';
import '../styles/explorer-v2.css';

/* Explorer › Terrains — le catalogue des centres, repeint sur Explorer.dc.html (Lot 5, 25/10/2026) : une rangée
   Tous / Foot / Padel / Libres ce soir, « N centres partenaires », une carte par centre (photo, sport, « dès X DA / h »,
   formats, créneaux encore libres). Les filtres de la page « Filtres » (ville, sport, format) arrivent par `filters`.
   Tout vient de GET /venues (liste enrichie, A5) et du résumé de disponibilité du jour — rien d'inventé. */

interface VenuesPanelProps {
  store: AppStore;
  onNavigate: (route: Route) => void;
  /** Filtres de l'onglet (sans la recherche) — l'état vit dans Explorer : la page « Filtres » écrit dans le même. */
  filters: VenueFilters;
  onFilters: (next: VenueFilters) => void;
}

export function VenuesPanel({ store, onNavigate, filters, onFilters }: VenuesPanelProps) {
  const t = useT();
  const lang = useLang();
  const { openVenue, openingId, error, clearError } = useOpenVenue(store, onNavigate);
  /* Règle 33 : position demandée au téléphone, jamais envoyée ; refusée ou indisponible → ordre par nom + invite, jamais de distance affichée. */
  const geo = useGeolocation();
  const showGeoHint = geo.status === 'denied' || geo.status === 'unavailable';

  // Ce qu'il reste à jouer aujourd'hui : relu à chaque ouverture de l'onglet (donnée qui vieillit vite).
  useEffect(() => { void store.loadVenueAvailability(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const venues = store.venues;
  const availability = store.venueAvailability;
  const sports = filterOptions(venues).sports;
  const visible = sortVenuesByDistance(filterVenues(venues, filters, availability), geo.position);
  const everything = filters.sport === 'ALL' && filters.quick === 'tous';
  const set = (patch: Partial<VenueFilters>) => onFilters({ ...filters, ...patch });

  // Liste jamais lue (réseau/5xx) : ≠ « aucun centre » — on le dit, avec un vrai bouton.
  if (store.venuesError && venues.length === 0) {
    return (
      <div className="ex-panel" key="p-terrains">
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-x" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Centres indisponibles')}</h4>
          <p className="mb-note__text">{t('Impossible de charger la liste des centres pour le moment. Vérifie ta connexion et réessaie.')}</p>
          <button type="button" className="mb-btn mb-btn--sm mb-tap" onClick={() => { void store.refreshVenues(); }}>{t('Réessayer')}</button>
        </div>
      </div>
    );
  }

  if (venues.length === 0) {
    return (
      <div className="ex-panel" key="p-terrains">
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-locate" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Aucun centre partenaire pour l’instant')}</h4>
          <p className="mb-note__text">{t('Les premiers centres arrivent bientôt — reviens vite.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ex-panel" key="p-terrains">
      <div className="xp-chips" role="group" aria-label={t('Filtres')}>
        <button type="button" className="xp-chip mb-tap" aria-pressed={everything} onClick={() => set({ sport: 'ALL', quick: 'tous' })}>{t('Tous')}</button>
        {sports.map((s) => (
          <button key={s} type="button" className="xp-chip mb-tap" aria-pressed={filters.sport === s}
            onClick={() => set({ sport: filters.sport === s ? 'ALL' : s })}>
            <Icon id={sportIcon(s)} className="mb-ic--sm" />{t(sportChipLabel(s))}
          </button>
        ))}
        {availability ? (
          <button type="button" className="xp-chip mb-tap" aria-pressed={filters.quick === 'cesoir'}
            onClick={() => set({ quick: filters.quick === 'cesoir' ? 'tous' : 'cesoir' })}>{t('Libres ce soir')}</button>
        ) : null}
      </div>

      <h2 className="xp-sec" role="status" aria-live="polite">{partnerCountLabel(visible.length, t, lang)}</h2>
      {showGeoHint ? <p className="xp-geo-hint"><Icon id="i-locate" className="mb-ic--sm" />{t('Active ta position pour voir les plus proches')}</p> : null}

      {error ? (
        <p className="au-error on" role="alert" style={{ marginBottom: 12 }}>
          <Icon id="i-x" className="mb-ic--sm" /><span>{error}</span>
          <button type="button" className="xp-filters__clear mb-tap" style={{ marginInlineStart: 'auto' }} onClick={clearError}>OK</button>
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="xp-vlist">
          {visible.map((v) => (
            <VenueCard key={v.id} venue={v} availability={availability?.[v.id]} opening={openingId === v.id}
              onOpen={() => { void openVenue(v.id); }} />
          ))}
        </div>
      ) : (
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-search" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Aucun centre trouvé')}</h4>
          <p className="mb-note__text">{t('Aucun centre ne correspond à ces filtres. Élargis ta recherche ou repars de zéro.')}</p>
          {!isPristine(filters) ? (
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm mb-tap" onClick={() => onFilters(NO_VENUE_FILTERS)}>
              {t('Réinitialiser les filtres')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* --- Carte centre ------------------------------------------------------------------------------------- */

/** Formats de TOUS les terrains actifs du centre (« 5v5 · 6v6 »), sans doublon, dans l'ordre des terrains. */
function formatsOf(venue: VenueSummary): string[] {
  return [...new Set(venue.fields.filter((f) => f.status === 'ACTIVE').flatMap((f) => fieldFormatList(f.formats)))];
}

function VenueCard({ venue, availability, opening, onOpen }: {
  venue: VenueSummary; availability: VenueAvailability | undefined; opening: boolean; onOpen: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const formats = formatsOf(venue);
  const free = availability?.freeStarts ?? null;
  const freeLabel = free === null ? null : freeSlotsLabel(free, t, lang);

  return (
    <button
      type="button" className="xp-vcard mb-tap" aria-busy={opening} aria-label={`${venue.name}, ${venue.wilaya}`} onClick={onOpen}
    >
      {/* Pas encore de photo de centre (aucun envoi possible aujourd'hui, décision du 23/09 : logo par défaut) —
          le signe de la marque sur la surface « terrain » du DS, jamais la photo nocturne répétée sur chaque carte. */}
      <span className="xp-vcard__photo mb-pitch">
        <img className="xp-vcard__mark" src={brandMark} alt="" />
        <span className="xp-vcard__badge">{venue.sports.map((s) => t(sportChipLabel(s as Sport))).join(' · ').toUpperCase()}</span>
      </span>
      <span className="xp-vcard__body">
        <span className="xp-vcard__head">
          <span className="xp-vcard__name">{venue.name}</span>
          {venue.priceFromDa !== null ? (
            <span className="xp-vcard__price">
              {t('dès')} <span className="mb-price" data-unit="hour"><Ltr>{fmt(venue.priceFromDa)}</Ltr><span className="mb-price__cur">{t('DA')}</span></span>
            </span>
          ) : null}
        </span>
        {formats.length > 0 ? (
          <span className="xp-vcard__formats">{formats.map((f) => <span key={f} className="xp-vcard__format">{f}</span>)}</span>
        ) : null}
        <span className="xp-vcard__foot">
          {free === null ? <span /> : freeLabel !== null ? (
            <span className="xp-vcard__free"><i />{freeLabel}</span>
          ) : free === 0 ? (
            <span className="xp-vcard__free xp-vcard__free--none"><i />{t('Complet aujourd’hui')}</span>
          ) : <span />}
          <Icon id="i-arrow" className="xp-vcard__chev" />
        </span>
      </span>
    </button>
  );
}
