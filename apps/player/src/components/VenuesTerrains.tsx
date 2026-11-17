import { useEffect, useState } from 'react';
import type { Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useT } from '../lib/i18n.js';
import { cityLabel } from '../lib/labels.js';
import { fold, inPlayerCity } from '../lib/venueFilters.js';
import type { VenueSummary } from '../state/store.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/reserver.css';
import '../styles/reserver-v2.css';

/* R2 « Réserver un terrain » (lot « Match libre », phase 4 — planche S2B, dossier §8) : « Où tu joues ? », un champ « Chercher un centre
   par son nom » (centres partenaires seulement), puis « AUTOUR DE TOI · ALGER » : une grande carte par centre — l'image du centre en haut
   (la photo arrive en phase 6 ; d'ici là le logo Moubarat sur fond rouge sombre, comme la maquette), une pastille de sport, le nom, puis
   le quartier et la wilaya. Toucher une carte ouvre directement l'écran de réservation, sans fiche de centre.
   « Autour de toi » = les centres de la ville du joueur (tous si aucun n'y est) ; la recherche porte sur tous les centres. */

interface VenuesTerrainsProps {
  store: AppStore;
  onPick: (venueId: string) => Promise<{ ok: boolean; message?: string | undefined }>;
  onExit?: (() => void) | undefined;
  /** Mode « Créer un match » (ancien parcours Créer, jusqu'à la phase 5) : le titre devient « Créer un match ». */
  matchMode?: boolean | undefined;
}

export function VenuesTerrains({ store, onPick, onExit, matchMode }: VenuesTerrainsProps) {
  const t = useT();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => { void store.loadVenueAvailability(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const venues = store.venues;
  const city = store.identity.city;
  const q = fold(query.trim());
  const nearby = venues.filter((v) => inPlayerCity(v.wilaya, city));
  const visible = q !== '' ? venues.filter((v) => fold(v.name).includes(q)) : nearby.length > 0 ? nearby : venues;

  async function pick(venueId: string) {
    if (openingId !== null) return;
    setError(null);
    setOpeningId(venueId);
    const res = await onPick(venueId);
    setOpeningId(null);
    if (!res.ok) setError(res.message ?? t('Ce centre est indisponible pour le moment.'));
  }

  const cityName = city ? t(cityLabel(city)) : null;
  return (
    <section className="au-screen rv2" id="s-venues">
      <div className="rv2-top">
        <div className="rv2-bar">
          {onExit ? <button type="button" className="rv2-back mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button> : null}
          <span className="rv2-title">{t(matchMode ? 'Créer un match' : 'Réserver un terrain')}</span>
        </div>
        <h1 className="rv2-h1">{t('Où tu joues ?')}</h1>
        <label className="rv2-search">
          <Icon id="i-search" className="rv2-search__ic" />
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off"
            placeholder={t('Chercher un centre par son nom')} aria-label={t('Chercher un centre par son nom')}
          />
        </label>
        {q === '' ? <div className="rv2-kicker">{t('AUTOUR DE TOI')}{cityName ? <> · {cityName.toUpperCase()}</> : null}</div> : null}
      </div>

      <div className="rv2-list">
        {error ? <p className="au-error on" role="alert"><Icon id="i-x" className="mb-ic--sm" /><span>{error}</span></p> : null}
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
          visible.map((v) => <VenueCard key={v.id} venue={v} opening={openingId === v.id} onOpen={() => { void pick(v.id); }} />)
        )}
      </div>
    </section>
  );
}

function VenueCard({ venue, opening, onOpen }: { venue: VenueSummary; opening: boolean; onOpen: () => void }) {
  const t = useT();
  const sport = venue.sports[0] as Sport | undefined;
  const place = [venue.address, venue.wilaya].map((s) => s.trim()).filter(Boolean).join(' · ');
  return (
    <button type="button" className="rv2-card mb-tap" aria-busy={opening} aria-label={venue.name} onClick={onOpen}>
      <span className="rv2-card__img">
        <span className="rv2-card__logo" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
        </span>
        {sport ? (
          <span className="rv2-card__sport"><Icon id={sport === 'PADEL' ? 'i-padel' : 'i-ball'} />{sport === 'PADEL' ? t('PADEL') : t('FOOT')}</span>
        ) : null}
      </span>
      <span className="rv2-card__row">
        <span className="rv2-card__col">
          <span className="rv2-card__name">{venue.name}</span>
          <span className="rv2-card__place"><Icon id="i-pin" /><span><Ltr>{place}</Ltr></span></span>
        </span>
        <Icon id="i-chev" className="rv2-card__chev" />
      </span>
    </button>
  );
}
