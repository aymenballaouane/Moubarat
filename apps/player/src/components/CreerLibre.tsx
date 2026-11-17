import { useRef, useState, type ReactNode } from 'react';
import type { MatchFormat, SkillLevel } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { CreerHeader } from './CreerMatch.js';
import { useT } from '../lib/i18n.js';
import { fillTemplate, buildDayChips, PERIOD_LABELS, PERIOD_ORDER, type PeriodKey } from '../lib/reserverCreneau.js';
import { WEEKDAY_KEYS } from '../lib/calendar.js';
import { hhmm } from '../lib/format.js';
import { levelLabel } from '../lib/labels.js';
import { NOTE_MAX, formatBadge } from '../lib/createMatch.js';
import { FREE_DURATIONS, FREE_FORMATS, freePlaceName, partnerSuggestions } from '../lib/freeMatch.js';
import { durationText, useLang } from '../lib/i18n.js';
import '../styles/create.css';
import '../styles/match-view.css';
import '../styles/create-v2.css';
import '../styles/reserver.css';
import '../styles/reserver-v2.css';
import '../styles/creer-libre.css';

/* Créer un match, parcours « match libre » (lot « Match libre », phase 5 — planches W1 à W4, dossier §8). PRÉSENTATIONNELS : la
   réservation chez un centre (S3), la publication réelle et la suite restent dans BookingFlow / FreeMatchFlow.

   W1 « Où ? » : « Où tu joues ? », le champ « Nom du terrain ou adresse », « AUTOUR DE TOI » (les centres partenaires proches : logo,
   nom, ville, « PARTENAIRE ») et « Je ne trouve pas mon terrain ». Toucher un centre mène à la réservation (S3) : chez un partenaire,
   le match naît d'une réservation.
   W2 : dès que le joueur tape, « LIEUX ET ADRESSES » — les centres partenaires dont le nom correspond, puis la saisie telle quelle comme
   lieu libre (« Ben Aknoun · Commune · Alger »). Aucun service de cartes (réponse 13 d'Aymen). « Je ne trouve pas mon terrain » met le
   curseur dans le champ s'il est vide, sinon valide la saisie comme lieu libre (réponse 14).
   W3 « Créneau » : 7 jours, « Durée », « À quelle heure ? » (Matin, Après-midi, Soir) et les heures par demi-heure ; « Continuer ».
   W4 « Détails » : « Format » (5V5 à 11V11, à faire défiler), « Niveau », « Description » ; « Publier mon match » et « Publier en privé ». */

const LEVELS: readonly SkillLevel[] = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'];

function LogoTile() {
  return (
    <span className="cl-logo" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
    </span>
  );
}

export interface PartnerVenue { id: string; name: string; wilaya: string }

/* --- W1 / W2 · Où ? ----------------------------------------------------------------------------------------------------------------- */

export function CreerLieu(p: {
  /** Centres « autour de toi » (W1) — ceux de la ville du joueur, sinon tous. */
  nearby: readonly PartnerVenue[];
  /** Tous les centres partenaires, pour les suggestions de W2. */
  venues: readonly PartnerVenue[];
  /** La ville du match libre (celle du joueur), affichée : « Commune · Alger ». */
  wilayaLabel: string;
  initialQuery?: string | undefined;
  openingId: string | null;
  error: string | null;
  onPickVenue: (venueId: string) => void;
  onFreePlace: (name: string, query: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(p.initialQuery ?? '');
  const input = useRef<HTMLInputElement>(null);
  const typing = query.trim() !== '';
  const free = freePlaceName(query);
  const suggestions = partnerSuggestions(p.venues, query);

  function notFound() {
    if (free) p.onFreePlace(free, query);
    else input.current?.focus();
  }

  const partnerRow = (v: PartnerVenue) => (
    <button key={v.id} type="button" className="cl-row mb-tap" aria-busy={p.openingId === v.id ? 'true' : undefined} onClick={() => p.onPickVenue(v.id)}>
      <LogoTile />
      <span className="cl-row__col">
        <span className="cl-row__name">{v.name}</span>
        <span className="cl-row__sub">
          <Icon id="i-pin" className="cl-row__pin" />
          <span className="cl-row__city">{t(v.wilaya)}</span>
          <span className="cl-partner">{t('PARTENAIRE')}</span>
        </span>
      </span>
      <Icon id="i-arrow" className="cl-row__go" />
    </button>
  );

  return (
    <section className="au-screen cr cl" id="s-creer-lieu">
      <CreerHeader step={1} onBack={p.onBack} />
      <h1 className="rv2-h1 cl-h1">{t('Où tu joues ?')}</h1>
      <label className="rv2-search" data-active={typing ? 'true' : undefined}>
        <Icon id="i-search" className="rv2-search__ic" />
        <input
          ref={input} type="text" enterKeyHint="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" maxLength={80}
          placeholder={t('Nom du terrain ou adresse')} aria-label={t('Chercher un lieu')}
          onKeyDown={(e) => { if (e.key === 'Enter' && free) p.onFreePlace(free, query); }}
        />
      </label>

      <span className="rv2-kicker cl-kicker">{t(typing ? 'LIEUX ET ADRESSES' : 'AUTOUR DE TOI')}</span>
      <div className="cl-list">
        {typing ? (
          <>
            {suggestions.map(partnerRow)}
            {free ? (
              <button type="button" className="cl-row cl-row--place mb-tap" onClick={() => p.onFreePlace(free, query)}>
                <span className="cl-pin" aria-hidden="true"><Icon id="i-pin" /></span>
                <span className="cl-row__col">
                  <bdi className="cl-row__name" dir="auto">{free}</bdi>
                  <span className="cl-row__sub">{fillTemplate(t('Commune · {wilaya}'), { wilaya: p.wilayaLabel })}</span>
                </span>
                <Icon id="i-arrow" className="cl-row__go" />
              </button>
            ) : null}
          </>
        ) : p.nearby.map(partnerRow)}
      </div>
      {p.error ? <p className="cr-err" role="alert">{p.error}</p> : null}

      <button type="button" className="cl-notfound mb-tap" onClick={notFound}>
        <Icon id="i-pin" className="cl-notfound__ic" />{t('Je ne trouve pas mon terrain')}
      </button>
      <div className="cr-pad" />
    </section>
  );
}

/* --- W3 · Créneau -------------------------------------------------------------------------------------------------------------------- */

export function CreerLibreCreneau(p: {
  /** Index du jour choisi (0 = aujourd'hui … 6). */
  dayIndex: number;
  onDay: (i: number) => void;
  duration: number;
  onDuration: (min: number) => void;
  period: PeriodKey;
  onPeriod: (k: PeriodKey) => void;
  /** Les heures (minutes depuis minuit) proposées pour ce jour et cette période. */
  starts: readonly number[];
  startMin: number | null;
  onStart: (min: number) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const days = buildDayChips(new Date());
  return (
    <section className="au-screen cr cl" id="s-creer-libre-creneau">
      <CreerHeader step={2} onBack={p.onBack} />
      <div className="rsv-r3__days cl-days">
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

      <footer className="rsv-r3__foot cl-foot">
        <button type="button" className="mv-cta mb-tap" disabled={p.startMin === null} onClick={p.onContinue}>{t('Continuer')}</button>
      </footer>
    </section>
  );
}

/* --- W4 · Détails -------------------------------------------------------------------------------------------------------------------- */

export function CreerLibreDetails(p: {
  format: MatchFormat;
  onFormat: (f: MatchFormat) => void;
  level: SkillLevel;
  onLevel: (l: SkillLevel) => void;
  note: string;
  onNote: (note: string) => void;
  publishing: boolean;
  error: string | null;
  onPublish: (visibility: 'OPEN' | 'PRIVATE') => void;
  onBack: () => void;
  toast: ReactNode;
}) {
  const t = useT();
  return (
    <section className="au-screen cr cl" id="s-creer-libre-details">
      <CreerHeader step={3} onBack={p.onBack} />
      <section className="cr-block">
        <h2 className="cv-q" id="cl-q-format">{t('Format')}</h2>
        <div className="mv-seg cl-formats" role="radiogroup" aria-labelledby="cl-q-format">
          {FREE_FORMATS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={p.format === f} aria-pressed={p.format === f} className="mb-tap" onClick={() => p.onFormat(f)}>
              <Ltr>{formatBadge(f)}</Ltr>
            </button>
          ))}
        </div>
      </section>

      <section className="cr-block">
        <h2 className="cv-q" id="cl-q-level">{t('Niveau')}</h2>
        <div className="mv-seg cv-levels" role="radiogroup" aria-labelledby="cl-q-level">
          {LEVELS.map((l, k) => (
            <button key={l} type="button" role="radio" aria-checked={p.level === l} aria-pressed={p.level === l} className="mb-tap" onClick={() => p.onLevel(l)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 20v-5" /><path d="M12 20v-9" opacity={k >= 1 ? 1 : 0.3} /><path d="M19 20V4" opacity={k >= 2 ? 1 : 0.3} />
              </svg>
              {t(levelLabel(l))}
            </button>
          ))}
        </div>
      </section>

      <section className="cr-block cv-desc cl-desc">
        <label className="cv-q" htmlFor="cr-note">{t('Description')}</label>
        <textarea id="cr-note" className="cr-note cv-note cl-note" rows={8} maxLength={NOTE_MAX} value={p.note} dir="auto" onChange={(e) => p.onNote(e.target.value)} />
      </section>

      <footer className="cr-foot cv-foot">
        <button type="button" className="mv-cta mb-tap" data-loading={p.publishing ? 'true' : undefined} disabled={p.publishing} onClick={() => p.onPublish('OPEN')}>
          {t('Publier mon match')}
        </button>
        <button type="button" className="cv-private mb-tap" disabled={p.publishing} onClick={() => p.onPublish('PRIVATE')}>
          <Icon id="i-lock" /><span>{t('Publier en privé')}</span>
        </button>
        {p.error ? <p className="cr-err" role="alert">{p.error}</p> : null}
      </footer>
      {p.toast}
    </section>
  );
}
