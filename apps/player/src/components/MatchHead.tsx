import type { Match } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { VenuePhoto } from './VenuePhoto.js';
import { venuePhotoUrl } from '../lib/venuePhoto.js';
import { countdownText, useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { levelLabel } from '../lib/labels.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { countdown, durationMinutes } from '../lib/matchView.js';
import { placeMapsUrl, venueMapsUrl } from '../lib/venueView.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/match-view.css';

/* Le haut du détail du match (lot « Match libre », phase 3 — planches Dv1 à Dv9, Dp1, Dp2 ; dossier §7) : la bande de 160 px (photo du
   centre, sinon le logo Moubarat sur fond rouge sombre — la photo arrive en phase 6), retour à gauche, partager et « Plus » (signaler)
   à droite, badge « Centre partenaire » ; le calendrier, le compte à rebours, l'heure et la fin ; « FOOT · 5V5 · LOISIR », le nom du
   lieu, l'adresse et « Itinéraire » ; le bandeau de prix. Même mise en page pour le joueur et l'organisateur.
   Lot B, phase 0 bis (dossier du 18/11/2026, §7, planches Dv1 et Dp2 mises à jour) : l'heure est seule sur sa ligne (plus de « jusqu'à
   21:00 · 1 h 30 ») ; « FOOT · 5V5 · LOISIR » devient une fine capsule (ballon · format · barres de niveau et niveau · chrono et durée
   en minutes) ; l'adresse devient une carte arrondie (petit plan, quartier et wilaya, « Itinéraire »), entièrement touchable.
   Match libre (phase 5 ; aucune planche, dossier §7 et réponse d'Aymen) : même écran sans badge « Centre partenaire » ni bandeau de
   prix, le logo sur la bande ; le nom et l'adresse sont ceux saisis, « Itinéraire » cherche ce texte et la ville dans Google Maps. */

const NBSP = String.fromCharCode(0xa0);
type Centre = NonNullable<ReturnType<AppStore['venueSummary']>>;

export function MatchHead({ match, venueName, centre, now, onBack, onShare, onMore }: {
  match: Match;
  venueName: string;
  centre: Centre | undefined;
  now: number;
  onBack?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  onMore?: (() => void) | undefined;
}) {
  const t = useT();
  const lang = useLang();
  const start = new Date(match.range.start);
  const month = lang === 'ar'
    ? new Intl.DateTimeFormat('ar-DZ-u-nu-latn', { month: 'long' }).format(start)
    : new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(start).toUpperCase();
  const weekday = lang === 'ar'
    ? new Intl.DateTimeFormat('ar-DZ-u-nu-latn', { weekday: 'long' }).format(start)
    : new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(start).toUpperCase();
  const cd = countdown(match.range.start, now);
  const startHour = hhmm(epochMinutesOfDay(match.range.start));
  const level = t(levelLabel(match.level));
  const levelBars = match.level === 'COMPETITION' ? 3 : match.level === 'INTERMEDIAIRE' ? 2 : 1;
  const price = match.pricePerPlayer.amount;
  const free = match.venueId === null ? (match.place ?? null) : null;
  const address = free
    ? [free.area ?? '', free.wilaya].map((s) => s.trim()).filter(Boolean).join(', ')   // lot B : en arabe aussi, l'adresse reste en lettres latines (Ar-Dv1)
    : centre ? [centre.address, centre.wilaya].map((s) => s.trim()).filter(Boolean).join(', ') : '';
  const mapsHref = free ? placeMapsUrl(free) : centre ? venueMapsUrl(centre) : null;
  return (
    <>
      <div className="mv-band">
        <VenuePhoto src={free || !centre ? null : venuePhotoUrl(centre.id, centre.photoVersion, 'large')}>
          <span className="mv-band__logo" aria-hidden="true">
            <svg width="64" height="64" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
          </span>
        </VenuePhoto>
        <span className="mv-band__veil" aria-hidden="true" />
        <div className="mv-band__top">
          {onBack ? <button type="button" className="mv-round mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button> : <span />}
          <span className="mv-band__right">
            {onShare ? <button type="button" className="mv-round mb-tap" aria-label={t('Partager le match')} onClick={onShare}><Icon id="i-share" /></button> : null}
            {onMore ? <button type="button" className="mv-round mb-tap" aria-label={t('Signaler ce match ou un joueur')} onClick={onMore}><Icon id="i-dots" /></button> : null}
          </span>
        </div>
        {free ? null : <span className="mv-partner"><Icon id="i-check" className="mv-partner__ic" />{t('Centre partenaire')}</span>}
      </div>

      <div className="mv-pad">
        <div className="mv-when">
          <div className="mv-cal" aria-hidden="true">
            <span className="mv-cal__month">{month}</span>
            <span className="mv-cal__day"><Ltr>{start.getDate()}</Ltr></span>
            <span className="mv-cal__wd">{weekday}</span>
          </div>
          <div className="mv-when__txt">
            {cd ? <span className="mv-count">{countdownText(cd, lang)}</span> : null}
            <span className="mv-hour"><Ltr>{startHour}</Ltr></span>
          </div>
        </div>

        <div className="mv-place">
          <div className="mv-tags">
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
                {level}
              </span>
              <span className="mv-caps__sep" aria-hidden="true" />
              <span className="mv-caps__item">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="14" r="7.6" /><path d="M9.6 2.6h4.8M12 2.6v3.8M18.2 7.2l1.6-1.6M12 14v-3.4" /></svg>
                <span>{fillTemplate(t('{n} min'), { n: String(durationMinutes(match.range)) })}</span>
              </span>
            </span>
          </div>
          <h1 className="mv-name" dir="auto">{venueName.toUpperCase()}</h1>
        </div>

        {address || mapsHref ? <AddressCard address={address} href={mapsHref} routeLabel={t('Itinéraire')} ariaLabel={t('Itinéraire dans Google Maps')} /> : null}

        {price > 0 ? (
          <div className="mv-price">
            <Icon id="i-cash" className="mv-price__ic" />
            <span className="mv-price__txt">
              {fillTemplate(t('{prix} DA chacun'), { prix: fmt(price).split(' ').join(NBSP) })}
              <span className="mv-price__sub">{t('· à payer sur place')}</span>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* La carte de l'adresse (Dv1) : un petit plan dessiné avec un repère rouge, le quartier et la wilaya, puis « Itinéraire ». Toute la
   carte se touche et ouvre Google Maps (sur la position de l'épingle pour un match libre qui en a une — venueView.placeMapsUrl). */
function AddressCard({ address, href, routeLabel, ariaLabel }: { address: string; href: string | null; routeLabel: string; ariaLabel: string }) {
  const body = (
    <>
      <span className="mv-addr__map" aria-hidden="true">
        <svg width="62" height="62" viewBox="0 0 62 62"><path d="M-4 40L70 22M-4 10L70 52M18 -4L34 64M44 -4L50 64" className="mv-addr__roads" /><path d="M-4 28L70 36" className="mv-addr__main" /></svg>
        <span className="mv-addr__pin">
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" fill="currentColor" /><circle cx="12" cy="10" r="2.6" className="mv-addr__hole" /></svg>
        </span>
      </span>
      <span className="mv-addr__col">
        {address ? <span className="mv-addr__txt"><Ltr>{address}</Ltr></span> : null}
        {href ? (
          <span className="mv-route">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8z" /></svg>
            {routeLabel}
          </span>
        ) : null}
      </span>
    </>
  );
  return href
    ? <a className="mv-addr mb-tap" href={href} target="_blank" rel="noopener noreferrer" aria-label={address ? `${ariaLabel} · ${address}` : ariaLabel}>{body}</a>
    : <div className="mv-addr">{body}</div>;
}
