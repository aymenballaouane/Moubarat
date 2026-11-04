import type { ReactNode } from 'react';
import { CANCEL_FREE_BEFORE_MS } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { cancelLimitLabel, ticketDateLabel } from '../lib/reserverCreneau.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/reserver-ticket.css';

/* R4 · « C'est réservé » (confirmation) et « Ta réservation » (consultation depuis Mes matchs) — Lot 5, patron
   Reserver.dc.html étape confirme (ReserverConfirme / ReserverVoir). Présentationnel : annulation, création de
   match et réservation réelle restent dans BookingFlow. Un seul ticket pour les deux entrées, comme la maquette. */

export type TicketState = 'reserved' | 'pending' | 'cancelled' | 'past';

export interface ReserverTicketProps {
  mode: 'confirm' | 'view';
  state: TicketState;
  venueName: string;
  fieldName: string;
  format: string | null;
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
  shareUrl: string;
  /** Consultation : retour vers Mes matchs. */
  onBack?: (() => void) | undefined;
  onCancel: () => void;
  onCreateMatch: () => void;
  onMyMatches?: (() => void) | undefined;
  now: number;
  toast: ReactNode;
  sheet?: ReactNode;
}

export function ReserverTicket(p: ReserverTicketProps) {
  const t = useT();
  const lang = useLang();
  const arrow = lang === 'ar' ? '←' : '→';
  const cancelled = p.state === 'cancelled';
  const title = cancelled ? t('Réservation annulée.') : p.mode === 'view' ? t('Ta réservation') : t('C’est réservé');
  const limit = cancelLimitLabel(p.rangeStart - CANCEL_FREE_BEFORE_MS, p.rangeStart, p.now, lang);
  const terrain = p.format ? `${p.fieldName} · ${p.format.toUpperCase()}` : p.fieldName;

  return (
    <section className="au-screen rsv-tk" id="s-proof">
      {p.mode === 'view' && p.onBack ? (
        <button type="button" className="rsv-tk__back mb-tap" aria-label={t('Retour')} onClick={p.onBack}><Icon id="i-back" /></button>
      ) : null}

      <div className="rsv-tk__head">
        {p.mode === 'confirm' && !cancelled ? <span className="rsv-tk__check"><Icon id="i-check" className="mb-ic--lg" /></span> : null}
        <h1 className="rsv-tk__h1">{title}</h1>
        {p.state === 'pending' && !cancelled ? <p className="mb-meta rsv-tk__sub">{t('Le créneau est bloqué. Le centre confirme ta réservation téléphonique.')}</p> : null}
        {cancelled ? <p className="mb-meta rsv-tk__sub">{t('Le créneau est libéré pour les autres joueurs.')}</p> : null}
      </div>

      <div className="rsv-tk__ticket" aria-label={t('Ton ticket')} data-cancelled={cancelled ? 'true' : undefined}>
        <div className="rsv-tk__photo">
          <img src={heroPhoto} alt="" />
          <span className="rsv-tk__scrim" />
          <span className="rsv-tk__title">
            <span className="rsv-tk__date">
              {ticketDateLabel(p.rangeStart, lang)} · <Ltr>{hhmm(epochMinutesOfDay(p.rangeStart))}</Ltr> {arrow} <Ltr>{hhmm(epochMinutesOfDay(p.rangeEnd))}</Ltr>
            </span>
            <span className="rsv-tk__venue">{p.venueName}</span>
          </span>
        </div>
        <div className="rsv-tk__tear" />
        <span className="rsv-tk__notch rsv-tk__notch--s" /><span className="rsv-tk__notch rsv-tk__notch--e" />
        <div className="rsv-tk__facts">
          <span><i>{t('TERRAIN')}</i><b>{terrain}</b></span>
          <span><i>{t('À PAYER')}</i><b><Ltr>{fmt(p.totalDa)}</Ltr> {t('DA')}</b></span>
          <span><i>{t('CODE')}</i><b className="rsv-tk__code"><Ltr>{p.code}</Ltr></b></span>
        </div>
      </div>

      {!cancelled && p.state !== 'past' ? (
        <p className="rsv-tk__note">
          {t('Tu paies sur place, en espèces.')}<br />
          {p.canCancel ? (
            p.late ? (
              <>{t('Tu réserves à moins de 2 h du début : si tu')} <button type="button" className="rsv-tk__link" onClick={p.onCancel}>{t('annules')}</button>{t(', ça comptera comme une demi-absence.')}</>
            ) : (
              <>{t('Un empêchement ?')} <button type="button" className="rsv-tk__link" onClick={p.onCancel}>{t('Annule ici')}</button>{t(', sans souci jusqu’à')} <Ltr>{limit}</Ltr>.</>
            )
          ) : null}
        </p>
      ) : null}

      <div className="rsv-tk__actions">
        {p.canCreateMatch ? (
          <button type="button" className="rsv-tk__cta mb-tap" onClick={p.onCreateMatch}>
            <span>{t('Créer un match sur ce créneau')}</span><Icon id="i-arrow" />
          </button>
        ) : null}
        {!cancelled ? (
          <a className="rsv-tk__share mb-tap" href={p.shareUrl} target="_blank" rel="noopener noreferrer">
            <Icon id="i-share" />{t('Partager sur WhatsApp')}
          </a>
        ) : null}
        {p.onMyMatches ? <button type="button" className="rsv-tk__more mb-tap" onClick={p.onMyMatches}>{t('Voir mes matchs')}</button> : null}
      </div>
      {p.toast}
      {p.sheet}
    </section>
  );
}
