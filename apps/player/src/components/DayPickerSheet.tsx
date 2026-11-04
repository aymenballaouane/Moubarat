import { useState } from 'react';
import { Icon } from './Icon.js';
import { haptic } from '../lib/haptic.js';
import { useLang, useT } from '../lib/i18n.js';
import { CALENDAR_HORIZON_DAYS, dayLongLabel, monthCells, monthCount, startOfDay } from '../lib/calendar.js';
import '../styles/explorer-v2.css';

/* « Choisis un jour » (Lot 5, ChoisirJour.dc.html) : feuille posée sur la page « Filtres », calendrier plein mois (lundi → dimanche),
   jours passés grisés, un point sous les jours qui ont des matchs (décomptes RÉELS du fil, `counts` : YYYY-MM-DD → nombre), bouton
   final = le jour choisi en toutes lettres. Fermer (✕) laisse le choix d'avant ; le bouton l'applique. */

const WEEKDAY_LETTERS = {
  // Lettres de la maquette (Lun → Dim) : « L M M J V S D » en français, « ن ث ر خ ج س ح » en arabe (ChoisirJourAr.dc.html).
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  ar: ['ن', 'ث', 'ر', 'خ', 'ج', 'س', 'ح'],
} as const;

export interface DayPickerSheetProps {
  /** Jour déjà choisi (début, ms), ou `null`. */
  selected: number | null;
  /** Matchs par jour (YYYY-MM-DD), `null` tant que la lecture n'est pas revenue (aucun point affiché, jamais un point inventé). */
  counts: Record<string, number> | null;
  onPick: (dayStart: number) => void;
  onClose: () => void;
}

export function DayPickerSheet({ selected, counts, onPick, onClose }: DayPickerSheetProps) {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR';
  const now = Date.now();
  const today = startOfDay(now);
  const months = monthCount(now, CALENDAR_HORIZON_DAYS);
  const [monthIndex, setMonthIndex] = useState(0);
  const [picked, setPicked] = useState<number>(selected ?? today);
  const { year, month, cells } = monthCells(now, monthIndex);
  const monthName = new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const dayLabel = (ms: number) => dayLongLabel(ms, lang);
  const cap = (s: string) => (lang === 'fr' ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Choisis un jour')} onClick={onClose}>
      <div className="mb-sheet xp-cal" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <button type="button" className="xp-iconbtn xp-cal__close mb-tap" aria-label={t('Fermer')} onClick={onClose}><Icon id="i-x" className="mb-ic--sm" /></button>
        <h3 className="rsv-taken__title">{t('Choisis un jour')}</h3>

        <div className="xp-cal__nav">
          <button type="button" className="xp-cal__arrow mb-tap" aria-label={t('Mois précédent')} disabled={monthIndex === 0} onClick={() => setMonthIndex(monthIndex - 1)}>
            <Icon id="i-back" className="mb-ic--sm xp-cal__arrow-ic" />
          </button>
          <span className="xp-cal__month">{cap(monthName)}</span>
          <button type="button" className="xp-cal__arrow xp-cal__arrow--next mb-tap" aria-label={t('Mois suivant')} disabled={monthIndex >= months - 1} onClick={() => setMonthIndex(monthIndex + 1)}>
            <Icon id="i-back" className="mb-ic--sm xp-cal__arrow-ic" />
          </button>
        </div>

        <div className="xp-cal__grid">
          {WEEKDAY_LETTERS[lang].map((l, i) => <span key={i} className="xp-cal__wd">{l}</span>)}
          {cells.map((c, i) => {
            if (c.empty) return <span key={i} />;
            if (c.past) return <span key={i} className="xp-cal__day xp-cal__day--past">{c.day}</span>;
            const has = (counts?.[c.stamp] ?? 0) > 0;
            return (
              <button
                key={i} type="button" className="xp-cal__day mb-tap" aria-pressed={picked === c.dayStart}
                aria-label={`${dayLabel(c.dayStart)}${has ? `, ${t('des matchs ce jour-là')}` : ''}`}
                onClick={() => setPicked(c.dayStart)}
              >
                {c.day}{has ? <i className="xp-cal__dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <p className="xp-cal__legend"><i className="xp-cal__dot xp-cal__dot--static" aria-hidden="true" />{t('des matchs ce jour-là')}</p>
        <button type="button" className="mb-btn mb-btn--block" onClick={() => { haptic('light'); onPick(picked); }}>{cap(dayLabel(picked))}</button>
      </div>
    </div>
  );
}
