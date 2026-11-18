import type { ReactNode } from 'react';
import type { MatchFormat, Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { VenuePhoto } from './VenuePhoto.js';
import { SlotTakenSheet } from './SlotTakenSheet.js';
import { useLang, useT, useTn } from '../lib/i18n.js';
import type { LimitReached } from '../lib/bookingLimits.js';
import '../styles/match-view.css';
import '../styles/reserver-v2.css';
import { fmt, hhmm } from '../lib/format.js';
import { WEEKDAY_KEYS } from '../lib/calendar.js';
import { formatBadge } from '../lib/createMatch.js';
import type { AvailabilityStart } from '../lib/mappers.js';
import {
  PERIOD_LABELS, PERIOD_ORDER, buildDayChips, fallbackStarts, formatPrice, periodOf, startsForFormat, type PeriodKey,
} from '../lib/reserverCreneau.js';

/* R3 + R4 · la fiche du centre et la réservation sur un même écran (lot « Match libre », phase 4 — planches S3 et S3L, dossier §8) :
   en haut l'image du centre (logo tant qu'il n'y a pas de photo, phase 6), retour et partager, le sport, le nom, l'adresse et
   « Itinéraire », « N créneaux disponibles aujourd'hui » ; puis « Quand ? », « Format » (avec le prix du créneau), « Durée », « Heure »
   (Matin / Après-midi / Soir, puis les heures libres) et « Au nom de » ; un pied collant avec le récap, le prix et « Confirmer la
   réservation ». « Limite atteinte » (S3L) remplace le reste du formulaire et désactive le bouton. Présentationnel : la disponibilité,
   le terrain affecté et la réservation réelle restent dans BookingFlow. */

const DURATIONS: readonly { min: number; label: string }[] = [
  { min: 60, label: '1 h' }, { min: 90, label: '1 h 30' }, { min: 120, label: '2 h' },
];

export interface ReserverCreneauProps {
  /** Mode « Créer un match » (ancien parcours Créer, jusqu'à la phase 5) : seul le bouton change. */
  matchMode?: boolean | undefined;
  venueName: string;
  /** L'en-tête du centre (S3). */
  venueAddress: string;
  /** Phase photos : la photo du centre (grande taille), `null` sans photo — le logo Moubarat sinon. */
  photoUrl?: string | null | undefined;
  mapsUrl: string | null;
  shareUrl: string;
  /** Sports du centre ; plusieurs = un choix au-dessus de « Quand ? » (la maquette n'en montre qu'un). */
  sports: readonly Sport[];
  sport: Sport | null;
  onSelectSport: (sport: Sport) => void;
  /** Départs libres aujourd'hui (90 min, tous formats du sport) ; null tant que non lu. */
  freeToday: number | null;
  /** S3L : la limite qui bloque une réservation ce jour-là, ou null. */
  limit: LimitReached;
  onMyMatches?: (() => void) | undefined;
  onBack: () => void;
  weekday: number;
  onSelectWeekday: (weekday: number) => void;
  /** Formats du sport (tarif horaire de base) — `undefined` tant que le serveur n'a pas répondu. */
  formatOptions: readonly { format: MatchFormat }[] | undefined;
  activeFormat: MatchFormat | null;
  onSelectFormat: (format: MatchFormat) => void;
  duration: number;
  onSelectDuration: (min: number) => void;
  /** Tous les départs libres du jour (tous formats) et ceux du format actif. */
  allStarts: readonly AvailabilityStart[] | undefined;
  selectedStart: number | null;
  onSelectStart: (startMin: number) => void;
  period: PeriodKey | null;
  onSelectPeriod: (period: PeriodKey) => void;
  name: string;
  onName: (value: string) => void;
  /** Total EXACT du départ + format choisis (serveur) ; `null` tant qu'il n'y en a pas. */
  total: number | null;
  /** Nom du terrain affecté (T1…), pour le récap. */
  fieldName: string | null;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  toast: ReactNode;
  /** Le départ visé vient d'être pris (SLOT_TAKEN) : feuille « Oups, il vient d'être pris » avec créneaux de repli. */
  taken: { startMin: number; fieldName: string } | null;
  onTakeAlternative: (startMin: number) => void;
  onCloseTaken: () => void;
}

/** « 1 h » / « 2 h » (laissés tels quels dans la maquette arabe) : isolés en gauche-à-droite, sinon le sens RTL
    les afficherait « h 1 ». « 1 سا 30 » reste du texte arabe. */
function isoLatin(label: string): ReactNode {
  return /^[ -~]+$/.test(label) ? <Ltr>{label}</Ltr> : label;
}

export function ReserverCreneau(p: ReserverCreneauProps) {
  const t = useT();
  const tn = useTn();
  const lang = useLang();
  const now = new Date();
  const days = buildDayChips(now);
  const allStarts = p.allStarts ?? [];
  const formatStarts = startsForFormat(allStarts, p.activeFormat);
  const activePeriod: PeriodKey = p.period ?? (p.selectedStart !== null ? periodOf(p.selectedStart) : 'soir');
  const periodStarts = formatStarts.filter((s) => periodOf(s.startMin) === activePeriod);
  const arrow = lang === 'ar' ? '←' : '→';

  const dayChip = days.find((d) => d.weekday === p.weekday);
  const dayWordFor = (startMin: number | null): string => {
    if (dayChip?.isToday) return startMin !== null && startMin < 18 * 60 ? t('Aujourd’hui') : t('Ce soir');
    const key = WEEKDAY_KEYS[p.weekday]!;
    if (lang === 'ar') return `${t(key)} ${dayChip?.date ?? ''}`;
    return `${key.charAt(0)}${key.slice(1).toLowerCase()} ${dayChip?.date ?? ''}`;
  };
  const dayWord = dayWordFor(p.selectedStart);
  /* Dans la phrase de la feuille (« Quelqu'un a réservé ce soir à… »), le jour est en minuscules en français. */
  const takenDayRaw = dayWordFor(p.taken?.startMin ?? null);
  const takenDay = lang === 'fr' ? takenDayRaw.replace(/^./, (c) => c.toLowerCase()) : takenDayRaw;

  return (
    <section className="au-screen rsv-r3" id="s-slots">
      <div className="rv3-band">
        <VenuePhoto src={p.photoUrl ?? null}>
          <span className="rv3-band__logo" aria-hidden="true">
            <svg width="84" height="84" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
          </span>
        </VenuePhoto>
        <span className="rv3-band__veil" aria-hidden="true" />
        <div className="rv3-band__top">
          <button type="button" className="mv-round mb-tap" aria-label={t('Retour')} onClick={p.onBack}><Icon id="i-back" /></button>
          <a className="mv-round mb-tap" aria-label={t('Partager')} href={p.shareUrl} target="_blank" rel="noopener noreferrer"><Icon id="i-share" /></a>
        </div>
      </div>
      <div className="rv3-head">
        {p.sport ? <span className="rv3-sport">{p.sport === 'PADEL' ? t('PADEL') : t('FOOT')}</span> : null}
        <h1 className="rv3-name">{p.venueName.toUpperCase()}</h1>
        <div className="mv-addrline">
          <Icon id="i-pin" className="mv-addrline__ic" />
          <span className="mv-addrline__txt">{p.venueAddress ? <Ltr>{p.venueAddress}</Ltr> : null}</span>
          {p.mapsUrl ? (
            <a className="mv-routebtn mb-tap" href={p.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={t('Itinéraire')}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8z" /></svg>
              {t('Itinéraire')}
            </a>
          ) : null}
        </div>
        {!p.limit && p.freeToday !== null && p.freeToday > 0 ? (
          <div className="rv3-free"><i aria-hidden="true" />{tn('{n} créneaux disponibles aujourd’hui', p.freeToday)}</div>
        ) : null}
        {p.sports.length > 1 ? (
          <div className="rsv-r3__seg rv3-sports" role="group" aria-label={t('Quel sport ?')}>
            {p.sports.map((sp) => (
              <button key={sp} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={p.sport === sp} onClick={() => p.onSelectSport(sp)}>{sp === 'PADEL' ? t('PADEL') : t('FOOT')}</button>
            ))}
          </div>
        ) : null}
      </div>

      <h2 className="rsv-r3__q">{t('Quand ?')}</h2>
      <div className="rsv-r3__days">
        {days.map((d) => (
          <button key={d.weekday} type="button" className="rsv-r3__day mb-tap" aria-pressed={p.weekday === d.weekday} onClick={() => p.onSelectWeekday(d.weekday)}>
            <span className="rsv-r3__day-abbr">{t(d.isToday ? 'AUJ.' : WEEKDAY_KEYS[d.weekday]!)}</span>
            <span className="rsv-r3__day-n">{d.date}</span>
          </button>
        ))}
      </div>

      {p.limit ? (
        <div className="rv3-limit" role="alert">
          <Icon id="i-help" className="rv3-limit__ic" />
          <div className="rv3-limit__col">
            <span className="rv3-limit__title">{t('Limite atteinte')}</span>
            <span className="rv3-limit__txt">{p.limit.kind === 'day'
              ? tn('Tu as déjà {n} réservations ce jour-là. Choisis un autre jour.', p.limit.max)
              : tn('Tu as déjà {n} réservations à venir. Annule-en une ou attends qu’un match ait eu lieu.', p.limit.max)}</span>
            {p.onMyMatches ? <button type="button" className="rv3-limit__link mb-tap" onClick={p.onMyMatches}>{t('Voir mes matchs')}</button> : null}
          </div>
        </div>
      ) : (<>
      <h2 className="rsv-r3__q">{t('Format')}</h2>
      {p.formatOptions === undefined ? (
        <p className="mb-meta rsv-r3__meta">{t('Vérification des disponibilités…')}</p>
      ) : (
        <div className="rsv-r3__formats" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(p.formatOptions.length, 1), 4)}, minmax(0, 1fr))` }}>
          {p.formatOptions.map((o) => {
            const price = formatPrice(allStarts, o.format, p.selectedStart);
            return (
              <button key={o.format} type="button" className="rsv-r3__format mb-tap" aria-pressed={p.activeFormat === o.format} onClick={() => p.onSelectFormat(o.format)}>
                <span className="rsv-r3__format-l">{formatBadge(o.format)}</span>
                {price ? (
                  <span className="rsv-r3__format-p">{price.exact ? '' : `${t('dès')} `}<Ltr>{fmt(price.total)}</Ltr> {t('DA')}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <h2 className="rsv-r3__q">{t('Durée')}</h2>
      <div className="rsv-r3__seg">
        {DURATIONS.map((d) => (
          <button key={d.min} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={p.duration === d.min} onClick={() => p.onSelectDuration(d.min)}>{isoLatin(t(d.label))}</button>
        ))}
      </div>

      <h2 className="rsv-r3__q">{t('Heure')}</h2>
      <div className="rsv-r3__seg">
        {PERIOD_ORDER.map((k) => (
          <button key={k} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={activePeriod === k} onClick={() => p.onSelectPeriod(k)}>{t(PERIOD_LABELS[k])}</button>
        ))}
      </div>
      {p.allStarts === undefined ? (
        <p className="mb-meta rsv-r3__meta">{t('Vérification des disponibilités…')}</p>
      ) : periodStarts.length === 0 ? (
        <p className="mb-meta rsv-r3__meta">{t('Aucun départ libre')}</p>
      ) : (
        <div className="rsv-r3__hours">
          {periodStarts.map((s) => (
            <button key={s.startMin} type="button" className="rsv-r3__hour mb-tap" aria-pressed={p.selectedStart === s.startMin} onClick={() => p.onSelectStart(s.startMin)}>
              <Ltr>{hhmm(s.startMin)}</Ltr>
            </button>
          ))}
        </div>
      )}

      <label className="rsv-r3__q rsv-r3__q--label" htmlFor="nomResa">{t('Au nom de')}</label>
      <input
        id="nomResa" className="rsv-r3__name" maxLength={40} autoComplete="name" dir="auto"
        value={p.name} onChange={(e) => p.onName(e.target.value)}
      />
      </>)}

      <footer className="rsv-r3__foot">
        <div className="rsv-r3__recap">
          <span className="rsv-r3__recap-l">
            {p.selectedStart !== null && !p.limit ? (
              <>
                {dayWord} · <Ltr>{hhmm(p.selectedStart)}</Ltr> {arrow} <Ltr>{hhmm(p.selectedStart + p.duration)}</Ltr>
                {p.activeFormat ? <> · <Ltr>{p.activeFormat.toUpperCase()}</Ltr></> : null}
              </>
            ) : dayWord}
          </span>
          {p.total !== null && !p.limit ? (
            <span className="rsv-r3__total">
              <span><b><Ltr>{fmt(p.total)}</Ltr></b><i> {t('DA')}</i></span>
            </span>
          ) : null}
        </div>
        <button type="button" className="mb-btn mb-btn--block" data-loading={p.confirming ? 'true' : undefined} disabled={!p.canConfirm || p.confirming || p.limit !== null} onClick={p.onConfirm}>
          {t(p.matchMode ? 'Réserver et configurer le match' : 'Confirmer la réservation')}
        </button>
      </footer>
      {p.toast}
      {p.taken ? (
        <SlotTakenSheet
          dayWord={takenDay} takenStartMin={p.taken.startMin} venueName={p.venueName} fieldName={p.taken.fieldName}
          durationMin={p.duration}
          alternatives={fallbackStarts(formatStarts, p.taken.startMin).map((x) => x.startMin)}
          onTake={p.onTakeAlternative} onClose={p.onCloseTaken}
        />
      ) : null}
    </section>
  );
}
