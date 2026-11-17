import type { Match } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { countdownText, durationText, useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { levelLabel } from '../lib/labels.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { countdown, durationMinutes } from '../lib/matchView.js';
import { venueMapsUrl } from '../lib/venueView.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/match-view.css';

/* Le haut du détail du match (lot « Match libre », phase 3 — planches Dv1 à Dv9, Dp1, Dp2 ; dossier §7) : la bande de 160 px (photo du
   centre, sinon le logo Moubarat sur fond rouge sombre — la photo arrive en phase 6), retour à gauche, partager et « Plus » (signaler)
   à droite, badge « Centre partenaire » ; le calendrier, le compte à rebours, l'heure et la fin ; « FOOT · 5V5 · LOISIR », le nom du
   lieu, l'adresse et « Itinéraire » ; le bandeau de prix. Même mise en page pour le joueur et l'organisateur. */

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
  const endHour = hhmm(epochMinutesOfDay(match.range.end));
  const level = t(levelLabel(match.level));
  const levelBars = match.level === 'COMPETITION' ? 3 : match.level === 'INTERMEDIAIRE' ? 2 : 1;
  const sport = match.sport === 'PADEL' ? t('PADEL') : t('FOOT');
  const price = match.pricePerPlayer.amount;
  const address = centre ? [centre.address, centre.wilaya].map((s) => s.trim()).filter(Boolean).join(', ') : '';
  return (
    <>
      <div className="mv-band">
        <span className="mv-band__logo" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
        </span>
        <span className="mv-band__veil" aria-hidden="true" />
        <div className="mv-band__top">
          {onBack ? <button type="button" className="mv-round mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button> : <span />}
          <span className="mv-band__right">
            {onShare ? <button type="button" className="mv-round mb-tap" aria-label={t('Partager le match')} onClick={onShare}><Icon id="i-share" /></button> : null}
            {onMore ? <button type="button" className="mv-round mb-tap" aria-label={t('Signaler ce match ou un joueur')} onClick={onMore}><Icon id="i-dots" /></button> : null}
          </span>
        </div>
        <span className="mv-partner"><Icon id="i-check" className="mv-partner__ic" />{t('Centre partenaire')}</span>
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
            <span className="mv-until">{fillTemplate(t('jusqu’à {fin} · {duree}'), { fin: endHour, duree: durationText(durationMinutes(match.range), lang) })}</span>
          </div>
        </div>

        <div className="mv-place">
          <div className="mv-tags">
            {sport} · <Ltr>{match.format.toUpperCase()}</Ltr> ·{' '}
            <span className="mv-level">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 20v-5" opacity={levelBars >= 1 ? 1 : 0.3} /><path d="M12 20v-9" opacity={levelBars >= 2 ? 1 : 0.3} /><path d="M19 20V4" opacity={levelBars >= 3 ? 1 : 0.3} />
              </svg>
              {lang === 'ar' ? level : level.toUpperCase()}
            </span>
          </div>
          <h1 className="mv-name">{venueName.toUpperCase()}</h1>
          <div className="mv-addr">
            <Icon id="i-pin" className="mv-addr__ic" />
            <span className="mv-addr__txt">{address ? <Ltr>{address}</Ltr> : null}</span>
            {centre ? (
              <a className="mv-route mb-tap" href={venueMapsUrl(centre)} target="_blank" rel="noopener noreferrer" aria-label={t('Itinéraire')}>
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8z" /></svg>
                {t('Itinéraire')}
              </a>
            ) : null}
          </div>
        </div>

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
