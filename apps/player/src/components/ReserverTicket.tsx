import type { ReactNode } from 'react';
import { CANCEL_FREE_BEFORE_MS } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { VenuePhoto } from './VenuePhoto.js';
import { useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { fillNodes } from '../lib/fillNodes.js';
import { cancelLimitLabel, ticketDateLabel } from '../lib/reserverCreneau.js';
import '../styles/reserver-ticket.css';
import '../styles/reserver-v2.css';
import '../styles/match-view.css';

/* R6 · « C'est réservé » (lot « Match libre », phase 4 — planche S6, dossier §8) et « Ta réservation » (consultation depuis Mes matchs) :
   un seul ticket. La carte : l'image du centre (logo tant qu'il n'y a pas de photo, phase 6), la date, le centre, « Terrain T1 · 5V5 · au
   nom de … », « À payer sur place » et le prix total, la référence. Dessous : « Un empêchement ? Annule ici jusqu'à 17:30 ». Deux boutons :
   « Créer mon match » (principal) et « Voir mes matchs ». Présentationnel : annulation, création de match et réservation réelle restent
   dans BookingFlow. */

export type TicketState = 'reserved' | 'pending' | 'cancelled' | 'past';

export interface ReserverTicketProps {
  mode: 'confirm' | 'view';
  state: TicketState;
  venueName: string;
  fieldName: string;
  format: string | null;
  /** « au nom de … ». */
  name: string;
  /** Phase photos : la photo du centre (vignette), `null` sans photo — le logo Moubarat sinon. */
  photoUrl?: string | null | undefined;
  totalDa: number;
  code: string;
  rangeStart: number;
  rangeEnd: number;
  /** Annulation possible (règle core, jugée par l'appelant) → ligne « Annule ici ». */
  canCancel: boolean;
  /** Création d'un match possible sur ce créneau (règle core, jugée par l'appelant). */
  canCreateMatch: boolean;
  /** Réservé à moins de 2 h du début (§19) : toute annulation compte comme une demi-absence. */
  late: boolean;
  /** Consultation : retour vers Mes matchs. */
  onBack?: (() => void) | undefined;
  onCancel: () => void;
  onCreateMatch: () => void;
  onMyMatches?: (() => void) | undefined;
  now: number;
  toast: ReactNode;
  sheet?: ReactNode;
}

/** « Terrain T1 » ; un nom qui commence déjà par « terrain » reste tel quel. */
function terrainLabel(name: string, t: (k: string) => string): string {
  return /^terrain\b/i.test(name.trim()) ? name : `${t('Terrain')} ${name}`;
}

export function ReserverTicket(p: ReserverTicketProps) {
  const t = useT();
  const lang = useLang();
  const arrow = lang === 'ar' ? '←' : '→';
  const cancelled = p.state === 'cancelled';
  const title = cancelled ? t('Réservation annulée.') : p.mode === 'view' ? t('Ta réservation') : t('C’est réservé');
  const limit = cancelLimitLabel(p.rangeStart - CANCEL_FREE_BEFORE_MS, p.rangeStart, p.now, lang);
  const date = ticketDateLabel(p.rangeStart, lang);
  const sep = ' · ';

  return (
    <section className="au-screen rv6" id="s-proof">
      {p.mode === 'view' && p.onBack ? (
        <button type="button" className="rv2-back rv6-back mb-tap" aria-label={t('Retour')} onClick={p.onBack}><Icon id="i-back" /></button>
      ) : null}

      <div className="rv6-main">
        {p.mode === 'confirm' && !cancelled ? <span className="rv6-check" aria-hidden="true"><Icon id="i-check" /></span> : null}
        <h1 className="rv6-h1">{title}</h1>
        {p.state === 'pending' && !cancelled ? <p className="rv6-sub">{t('Le créneau est bloqué. Le centre confirme ta réservation téléphonique.')}</p> : null}
        {cancelled ? <p className="rv6-sub">{t('Le créneau est libéré pour les autres joueurs.')}</p> : null}

        <div className="rv6-card" aria-label={t('Ton ticket')} data-cancelled={cancelled ? 'true' : undefined}>
          <div className="rv6-card__img" aria-hidden="true">
            <VenuePhoto src={p.photoUrl ?? null}><svg width="48" height="48" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg></VenuePhoto>
          </div>
          <div className="rv6-card__body">
            <div className="rv6-date">
              {lang === 'ar' ? date : date.toUpperCase()}{sep}<Ltr>{hhmm(epochMinutesOfDay(p.rangeStart))}</Ltr> {arrow} <Ltr>{hhmm(epochMinutesOfDay(p.rangeEnd))}</Ltr>
            </div>
            <div className="rv6-venue">{p.venueName.toUpperCase()}</div>
            <div className="rv6-meta">
              {terrainLabel(p.fieldName, t)}{p.format ? <>{sep}<Ltr>{p.format.toUpperCase()}</Ltr></> : null}
              {p.name ? <>{sep}{t('au nom de')} <Ltr>{p.name}</Ltr></> : null}
            </div>
            <div className="rv6-sep" />
            <div className="rv6-pay">
              <span className="rv6-pay__l">{t('À payer sur place')}</span>
              <span className="rv6-pay__n"><Ltr>{fmt(p.totalDa).split(' ').join(String.fromCharCode(0xa0))}</Ltr> {t('DA')}</span>
            </div>
            <div className="rv6-ref">{fillNodes(t('Réf. {ref}'), { ref: <Ltr>{p.code}</Ltr> })}</div>
          </div>
        </div>

        {!cancelled && p.state !== 'past' && p.canCancel ? (
          <p className="rv6-note">
            {p.late ? (
              <>{t('Tu réserves à moins de 2 h du début : si tu')} <button type="button" className="rv6-link mb-tap" onClick={p.onCancel}>{t('annules')}</button>{t(', ça comptera comme une demi-absence.')}</>
            ) : (
              <>{t('Un empêchement ?')} <button type="button" className="rv6-link mb-tap" onClick={p.onCancel}>{t('Annule ici')}</button> {fillNodes(t('jusqu’à {heure}'), { heure: lang === 'ar' ? <bdi>{limit}</bdi> : <Ltr>{limit}</Ltr> })}</>
            )}
          </p>
        ) : null}
      </div>

      <div className="rv6-actions">
        {p.canCreateMatch ? <button type="button" className="mv-cta mb-tap" onClick={p.onCreateMatch}>{t('Créer mon match')}</button> : null}
        {p.onMyMatches ? <button type="button" className="rv6-more mb-tap" onClick={p.onMyMatches}>{t('Voir mes matchs')}</button> : null}
      </div>
      {p.toast}
      {p.sheet}
    </section>
  );
}
