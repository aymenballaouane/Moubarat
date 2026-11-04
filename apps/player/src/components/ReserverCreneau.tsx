import type { ReactNode } from 'react';
import type { MatchFormat } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { SlotTakenSheet } from './SlotTakenSheet.js';
import { useLang, useT } from '../lib/i18n.js';
import { fmt, hhmm } from '../lib/format.js';
import { WEEKDAY_KEYS } from '../lib/calendar.js';
import { formatBadge } from '../lib/createMatch.js';
import type { AvailabilityStart } from '../lib/mappers.js';
import {
  PERIOD_LABELS, PERIOD_ORDER, buildDayChips, fallbackStarts, formatPrice, periodOf, startsForFormat, type PeriodKey,
} from '../lib/reserverCreneau.js';

/* R3 · « Ta réservation » (Lot 5, patron Reserver.dc.html, étape creneau, variante d'heures « périodes ») :
   jour → format → durée → heure → nom, un pied collant avec le récap et le CTA (règle 17). Présentationnel :
   la disponibilité, le terrain affecté et la réservation réelle restent dans BookingFlow. */

const DURATIONS: readonly { min: number; label: string }[] = [
  { min: 60, label: '1 h' }, { min: 90, label: '1 h 30' }, { min: 120, label: '2 h' },
];

export interface ReserverCreneauProps {
  /** Mode « Créer un match » (maquette Reserver mode=match) : fil d'Ariane, titre et CTA changent. */
  matchMode?: boolean | undefined;
  venueName: string;
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
      <header className="rsv-r3__head">
        <button type="button" className="rsv-r3__back mb-tap" aria-label={t('Retour')} onClick={p.onBack}><Icon id="i-back" /></button>
        <span className="rsv-r3__crumb">
          <span>{t(p.matchMode ? 'CRÉER UN MATCH · LE TERRAIN' : 'RÉSERVER UN TERRAIN')}</span>
          <b>{p.venueName}</b>
        </span>
      </header>
      <h1 className="rsv-r3__h1">{t(p.matchMode ? 'Le créneau de ton match' : 'Ta réservation')}</h1>

      <h2 className="rsv-r3__q">{t('C’est pour quand ?')}</h2>
      <div className="rsv-r3__days">
        {days.map((d) => (
          <button key={d.weekday} type="button" className="rsv-r3__day mb-tap" aria-pressed={p.weekday === d.weekday} onClick={() => p.onSelectWeekday(d.weekday)}>
            <span className="rsv-r3__day-abbr">{t(d.isToday ? 'AUJ.' : WEEKDAY_KEYS[d.weekday]!)}</span>
            <span className="rsv-r3__day-n">{d.date}</span>
          </button>
        ))}
      </div>

      <h2 className="rsv-r3__q">{t('Quel format ?')}</h2>
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

      <h2 className="rsv-r3__q">{t('Tu joues combien de temps ?')}</h2>
      <div className="rsv-r3__seg">
        {DURATIONS.map((d) => (
          <button key={d.min} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={p.duration === d.min} onClick={() => p.onSelectDuration(d.min)}>{isoLatin(t(d.label))}</button>
        ))}
      </div>

      <h2 className="rsv-r3__q">{t('À quelle heure ?')}</h2>
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

      <label className="rsv-r3__q rsv-r3__q--label" htmlFor="nomResa">{t('C’est au nom de qui ?')}</label>
      <input
        id="nomResa" className="rsv-r3__name" maxLength={40} autoComplete="name"
        value={p.name} onChange={(e) => p.onName(e.target.value)}
      />

      <footer className="rsv-r3__foot">
        <div className="rsv-r3__recap">
          <span className="rsv-r3__recap-l">
            {p.selectedStart !== null ? (
              <>
                {dayWord} · <Ltr>{hhmm(p.selectedStart)}</Ltr> {arrow} <Ltr>{hhmm(p.selectedStart + p.duration)}</Ltr>
                {p.activeFormat ? ` · ${p.activeFormat.toUpperCase()}` : ''}{p.fieldName ? ` · ${p.fieldName}` : ''}
              </>
            ) : dayWord}
          </span>
          {p.total !== null ? (
            <span className="rsv-r3__total">
              <span><b><Ltr>{fmt(p.total)}</Ltr></b><i> {t('DA')}</i></span>
              <small>{t('le créneau, sur place')}</small>
            </span>
          ) : null}
        </div>
        <button type="button" className="mb-btn mb-btn--block" data-loading={p.confirming ? 'true' : undefined} disabled={!p.canConfirm || p.confirming} onClick={p.onConfirm}>
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
