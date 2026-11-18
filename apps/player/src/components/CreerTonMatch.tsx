import { useState, type ReactNode } from 'react';
import type { MatchFormat, SkillLevel } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { durationText, useLang, useT } from '../lib/i18n.js';
import { hhmm } from '../lib/format.js';
import { levelLabel } from '../lib/labels.js';
import { buildDayChips, fillTemplate, PERIOD_LABELS, PERIOD_ORDER, type PeriodKey } from '../lib/reserverCreneau.js';
import { WEEKDAY_KEYS } from '../lib/calendar.js';
import { NOTE_MAX, formatBadge } from '../lib/createMatch.js';
import { FREE_DURATIONS, FREE_FORMATS } from '../lib/freeMatch.js';
import '../styles/create.css';
import '../styles/reserver.css';
import '../styles/match-view.css';
import '../styles/creer-libre.css';
import '../styles/creer-ton-match.css';

/* Lot B, phase 1 — « Ton match », une seule page (maquette 03_Ton_match, planche Cm-B2) : elle remplace les écrans Créneau et Détails du
   match libre. Dans l'ordre : le lieu et « Modifier », Quand ?, Durée (1 h 30), À quelle heure ? (aucune heure d'avance), Format (5V5),
   Niveau (Loisir), « Ajouter un mot pour les joueurs » replié ; pied de page toujours visible : le rappel, « Publier mon match » (« Choisis
   une heure » et inactif tant qu'aucune heure n'est choisie), « Publier en privé ». Mêmes composants que la page Réserver (rangée de
   jours, segments, grille d'heures, pied de page) pour que les deux restent identiques. */

const LEVELS: readonly SkillLevel[] = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'];

export function CreerTonMatch(p: {
  placeName: string;
  /** « Rue Ali Khodja, Alger » : l'adresse sous l'épingle et la wilaya. */
  placeSub: string;
  onEditPlace: () => void;
  dayIndex: number;
  onDay: (i: number) => void;
  duration: number;
  onDuration: (min: number) => void;
  period: PeriodKey;
  onPeriod: (k: PeriodKey) => void;
  starts: readonly number[];
  startMin: number | null;
  onStart: (min: number) => void;
  format: MatchFormat;
  onFormat: (f: MatchFormat) => void;
  level: SkillLevel;
  onLevel: (l: SkillLevel) => void;
  note: string;
  onNote: (note: string) => void;
  publishing: boolean;
  onPublish: (visibility: 'OPEN' | 'PRIVATE') => void;
  onBack: () => void;
  toast: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const days = buildDayChips(new Date());
  const [noteOpen, setNoteOpen] = useState(p.note.trim() !== '');
  const day = days[p.dayIndex];
  const dayAbbr = day ? t(day.isToday ? 'AUJ.' : WEEKDAY_KEYS[day.weekday]!) : '';
  const dayWord = lang === 'ar' ? dayAbbr : dayAbbr.charAt(0) + dayAbbr.slice(1).toLowerCase();
  const ready = p.startMin !== null;

  return (
    <section className="au-screen cr cl ctm" id="s-creer-ton-match">
      <header className="ctm-head">
        <button type="button" className="ctm-back mb-tap" aria-label={t('Retour')} onClick={p.onBack}><Icon id="i-back" /></button>
        <span className="ctm-title">{t('Créer un match')}</span>
        <span className="ctm-step"><Ltr>2/2</Ltr></span>
      </header>

      <div className="ctm-place">
        <span className="ctm-place__ic" aria-hidden="true"><Icon id="i-pin" /></span>
        <span className="ctm-place__txt">
          <b dir="auto">{p.placeName}</b>
          {p.placeSub ? <span><Ltr>{p.placeSub}</Ltr></span> : null}
        </span>
        <button type="button" className="ctm-place__edit mb-tap" onClick={p.onEditPlace}>{t('Modifier')}</button>
      </div>

      <h2 className="rsv-r3__q">{t('Quand ?')}</h2>
      <div className="rsv-r3__days">
        {days.map((d, i) => (
          <button key={d.weekday} type="button" className="rsv-r3__day mb-tap" aria-pressed={p.dayIndex === i} onClick={() => p.onDay(i)}>
            <span className="rsv-r3__day-abbr">{t(d.isToday ? 'AUJ.' : WEEKDAY_KEYS[d.weekday]!)}</span>
            <span className="rsv-r3__day-n">{d.date}</span>
          </button>
        ))}
      </div>

      <h2 className="rsv-r3__q">{t('Durée')}</h2>
      <div className="rsv-r3__seg">
        {FREE_DURATIONS.map((m) => (
          <button key={m} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={p.duration === m} onClick={() => p.onDuration(m)}>
            {lang === 'ar' ? durationText(m, lang) : <Ltr>{durationText(m, lang)}</Ltr>}
          </button>
        ))}
      </div>

      <h2 className="rsv-r3__q">{t('À quelle heure ?')}</h2>
      <div className="rsv-r3__seg">
        {PERIOD_ORDER.map((k) => (
          <button key={k} type="button" className="rsv-r3__seg-b mb-tap" aria-pressed={p.period === k} onClick={() => p.onPeriod(k)}>{t(PERIOD_LABELS[k])}</button>
        ))}
      </div>
      {p.starts.length === 0 ? (
        <p className="mb-meta rsv-r3__meta">{t('Aucun départ libre')}</p>
      ) : (
        <div className="rsv-r3__hours">
          {p.starts.map((m) => (
            <button key={m} type="button" className="rsv-r3__hour mb-tap" aria-pressed={p.startMin === m} onClick={() => p.onStart(m)}>
              <Ltr>{hhmm(m)}</Ltr>
            </button>
          ))}
        </div>
      )}

      <h2 className="rsv-r3__q" id="ctm-q-format">{t('Format')}</h2>
      <div className="ctm-formats" role="radiogroup" aria-labelledby="ctm-q-format">
        {FREE_FORMATS.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={p.format === f} className="mb-tap" onClick={() => p.onFormat(f)}>
            <Ltr>{formatBadge(f)}</Ltr>
          </button>
        ))}
      </div>

      <h2 className="rsv-r3__q" id="ctm-q-level">{t('Niveau')}</h2>
      <div className="rsv-r3__seg ctm-levels" role="radiogroup" aria-labelledby="ctm-q-level">
        {LEVELS.map((l, k) => (
          <button key={l} type="button" role="radio" aria-checked={p.level === l} aria-pressed={p.level === l} className="rsv-r3__seg-b mb-tap" onClick={() => p.onLevel(l)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 20v-5" /><path d="M12 20v-9" opacity={k >= 1 ? 1 : 0.3} /><path d="M19 20V4" opacity={k >= 2 ? 1 : 0.3} />
            </svg>
            {t(levelLabel(l))}
          </button>
        ))}
      </div>

      {noteOpen ? (
        <div className="ctm-note">
          <label className="rsv-r3__q" htmlFor="ctm-note">{t('Un mot pour les joueurs')}</label>
          <textarea
            id="ctm-note" className="cr-note cv-note" rows={4} maxLength={NOTE_MAX} value={p.note} dir="auto" autoFocus
            placeholder={t('Ex. : rendez-vous à l’entrée principale, ramenez une chasuble blanche et une noire.')}
            onChange={(e) => p.onNote(e.target.value)}
          />
        </div>
      ) : (
        <button type="button" className="ctm-addnote mb-tap" onClick={() => setNoteOpen(true)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {t('Ajouter un mot pour les joueurs')}
        </button>
      )}

      <footer className="ctm-foot">
        {ready ? (
          <p className="ctm-recap">
            {(() => {
              const line = fillTemplate(t('{jour} {date} · {debut} → {fin} · {format}'), {
                jour: dayWord, date: String(day?.date ?? ''), debut: hhmm(p.startMin!), fin: hhmm(p.startMin! + p.duration), format: p.format,
              });
              return lang === 'ar' ? line : <Ltr>{line}</Ltr>;   // l'arabe a sa propre phrase (« من … إلى … »)
            })()}
          </p>
        ) : null}
        <button type="button" className="mv-cta mb-tap" data-loading={p.publishing ? 'true' : undefined} disabled={!ready || p.publishing} onClick={() => p.onPublish('OPEN')}>
          {ready ? t('Publier mon match') : t('Choisis une heure')}
        </button>
        <button type="button" className="ctm-private mb-tap" disabled={!ready || p.publishing} onClick={() => p.onPublish('PRIVATE')}>
          <Icon id="i-lock" /><span>{t('Publier en privé')}</span>
        </button>
      </footer>
      {p.toast}
    </section>
  );
}
