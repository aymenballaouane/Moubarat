import type { ReactNode } from 'react';
import type { Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { useState } from 'react';
import { DayPickerSheet } from './DayPickerSheet.js';
import { dayLongLabel } from '../lib/calendar.js';
import { useLang, useT } from '../lib/i18n.js';
import type { CityFilter } from '../lib/feedQuery.js';
import {
  CITY_CHOICES, FORMAT_CHOICES, LEVEL_CHOICES, WHEN_CHOICES, sportChipLabel, toggleIn, type WhenFilter,
} from '../lib/explorerFilters.js';
import '../styles/explorer-v2.css';

/* Page « Filtres » d'Explorer (Lot 5, FiltresExplorer.dc.html) : Où ? · Quand ? · Quel sport ? · Quel niveau ? · Quel format ? ·
   « seulement les matchs avec de la place ». Plein écran, par-dessus l'Explorer ; chaque puce écrit tout de suite dans
   l'état de l'écran appelant (comme la maquette — « Voir les matchs » ne fait que refermer). Depuis l'onglet Terrains, seules
   les sections qui ont un sens pour un centre restent : Où ?, sport, format. */

export interface ExplorerFiltersProps {
  tab: 'matchs' | 'terrains';
  city: CityFilter | null;
  onCity: (city: CityFilter | null) => void;
  /** Matchs seulement. */
  when: WhenFilter | null;
  onWhen: (when: WhenFilter | null) => void;
  /** Matchs seulement : jour choisi au calendrier qui n'est aucun des quatre choix (début, ms), décomptes du fil, choix d'un jour. */
  customDay?: number | null;
  dayCounts?: Record<string, number> | null;
  onNeedDayCounts?: () => void;
  onPickDay?: (dayStart: number) => void;
  /** Sports réellement proposés par le catalogue. */
  sports: readonly Sport[];
  sport: Sport | 'ALL' | null;
  onSport: (sport: Sport | 'ALL') => void;
  /** Matchs seulement. */
  levels: readonly string[];
  onLevels: (levels: string[]) => void;
  formats: readonly string[];
  onFormats: (formats: string[]) => void;
  /** Matchs seulement. */
  spots: boolean;
  onSpots: (spots: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}

function Pill({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className="xp-pill mb-tap" aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function ExplorerFilters(p: ExplorerFiltersProps) {
  const t = useT();
  const lang = useLang();
  const [pickerOpen, setPickerOpen] = useState(false);
  const matchs = p.tab === 'matchs';
  const showFormats = p.sport !== 'PADEL';

  return (
    <div className="xp-filters" role="dialog" aria-modal="true" aria-label={t('Filtres')}>
      <header className="xp-filters__head">
        <button type="button" className="xp-iconbtn mb-tap" aria-label={t('Fermer')} onClick={p.onClose}><Icon id="i-x" className="mb-ic--sm" /></button>
        <button type="button" className="xp-filters__clear mb-tap" onClick={p.onClear}>{t('Tout effacer')}</button>
      </header>
      <h1 className="xp-filters__h1">{t('Filtres')}</h1>

      <section className="xp-fsec">
        <h2>{t('Où ?')}</h2>
        <div className="xp-pills">
          {CITY_CHOICES.map((c) => (
            <Pill key={c.value} on={p.city === c.value} onClick={() => p.onCity(p.city === c.value ? null : c.value)}>{t(c.label)}</Pill>
          ))}
        </div>
      </section>

      {matchs ? (
        <section className="xp-fsec">
          <h2>{t('Quand ?')}</h2>
          <div className="xp-pills">
            {WHEN_CHOICES.map((w) => (
              <Pill key={w.value} on={p.when === w.value} onClick={() => p.onWhen(p.when === w.value ? null : w.value)}>{t(w.label)}</Pill>
            ))}
            {p.onPickDay ? (
              <button type="button" className="xp-pill xp-pill--link mb-tap" aria-pressed={p.customDay != null} aria-haspopup="dialog"
                onClick={() => { p.onNeedDayCounts?.(); setPickerOpen(true); }}>
                {p.customDay != null ? dayLongLabel(p.customDay, lang) : t('Choisir un jour')}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="xp-fsec">
        <h2>{t('Quel sport ?')}</h2>
        <div className="xp-pills">
          <Pill on={p.sport === 'ALL'} onClick={() => p.onSport('ALL')}>{t('Tous')}</Pill>
          {p.sports.map((s) => (
            <Pill key={s} on={p.sport === s} onClick={() => p.onSport(s)}>{t(sportChipLabel(s))}</Pill>
          ))}
        </div>
      </section>

      {matchs ? (
        <section className="xp-fsec">
          <h2>{t('Quel niveau ?')}</h2>
          <div className="xp-pills">
            {LEVEL_CHOICES.map((l) => (
              <Pill key={l.value} on={p.levels.includes(l.value)}
                onClick={() => p.onLevels(toggleIn(p.levels, l.value, LEVEL_CHOICES.map((x) => x.value)))}>{t(l.label)}</Pill>
            ))}
          </div>
        </section>
      ) : null}

      {showFormats ? (
        <section className="xp-fsec">
          <h2>{t('Quel format ?')}</h2>
          <div className="xp-pills">
            {FORMAT_CHOICES.map((f) => (
              <Pill key={f} on={p.formats.includes(f)} onClick={() => p.onFormats(toggleIn(p.formats, f, FORMAT_CHOICES))}>{f}</Pill>
            ))}
          </div>
        </section>
      ) : null}

      {matchs ? (
        <section className="xp-fsec">
          <button type="button" role="switch" aria-checked={p.spots} className="xp-switch mb-tap" onClick={() => p.onSpots(!p.spots)}>
            <span>{t('Seulement les matchs avec de la place')}</span>
            <span className="xp-switch__track" aria-hidden="true"><span className="xp-switch__knob" /></span>
          </button>
        </section>
      ) : null}

      {pickerOpen && p.onPickDay ? (
        <DayPickerSheet
          selected={p.customDay ?? null} counts={p.dayCounts ?? null}
          onPick={(d) => { p.onPickDay!(d); setPickerOpen(false); }} onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <footer className="xp-filters__foot">
        <button type="button" className="mb-btn mb-btn--block" onClick={p.onClose}>
          {t(matchs ? 'Voir les matchs' : 'Voir les terrains')}
        </button>
      </footer>
    </div>
  );
}
