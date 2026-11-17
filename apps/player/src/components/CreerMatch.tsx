import { Fragment, type ReactNode } from 'react';
import { useTn } from '../lib/i18n.js';
import type { MatchFormat, SkillLevel, Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { VenuePhoto } from './VenuePhoto.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { levelLabel, sportLabel } from '../lib/labels.js';
import { CREATE_STEPS, NOTE_MAX, formatBadge, stepStates } from '../lib/createMatch.js';
import { fillTemplate, ticketDateLabel } from '../lib/reserverCreneau.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/create.css';
import '../styles/match-view.css';
import '../styles/create-v2.css';
import '../styles/reserver-v2.css';

/* Créer un match (Lot 6, Creer.dc.html) — les trois écrans, PRÉSENTATIONNELS : « Ton créneau » (C0), « Configure ton match »
   (C1), « Ton match est en ligne » (C2), + le suivi en trois étapes. La réservation, le prix et la publication restent dans
   CreateMatchFlow. Padel = même structure (badge PADEL + voile sur la photo), aucun écran à part. */

const LEVELS: readonly SkillLevel[] = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'];

/** Un créneau déjà réservé qu'on peut ouvrir en match (carte de C0). */
export interface ResaCardData {
  id: string;
  /** Clé de semaine (« MER. »), traduite à l'affichage. */
  weekdayKey: string;
  date: number;
  hour: string;
  /** « 1 h 30 » (clé du dictionnaire). */
  duration: string;
  venueName: string;
  fieldName: string;
  sport: Sport;
  format: MatchFormat;
  totalDa: number;
}

/** Ce que C1 et C2 montrent du match à publier. */
export interface MatchSummary {
  sport: Sport;
  format: MatchFormat;
  startEpoch: number;
  endEpoch: number;
  venueName: string;
  fieldName: string;
  /** Prix par joueur affiché (règle 13 : dizaine supérieure), places = capacité du format. */
  perPlayerDa: number;
  places: number;
  /** Phase photos : la photo du centre (vignette), `null` sans photo ou pour un match libre. */
  photoUrl?: string | null | undefined;
}

function SportBadge({ sport }: { sport: Sport }) {
  const t = useT();
  return <span className="cr-badge">{sport === 'PADEL' ? t('PADEL') : sport === 'BASKET' ? sportLabel(sport).toUpperCase() : t('FOOT')}</span>;
}

export function CreerHeader({ step, onBack }: { step: 1 | 2 | 3; onBack: () => void }) {
  const t = useT();
  const states = stepStates(step);
  return (
    <>
      <header className="cr-head">
        <button type="button" className="cr-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button>
        <span className="cv-title">{t('Créer un match')}</span>
      </header>
      <ol className="cr-steps" aria-label={t('Étapes')}>
        {CREATE_STEPS.map((label, i) => {
          const s = states[i]!;
          return (
            <Fragment key={label}>
              {i > 0 ? <li aria-hidden="true" className="cr-steps__bar" data-on={states[i - 1]!.done ? 'true' : undefined} /> : null}
              <li className="cr-step" aria-current={s.current ? 'step' : undefined} data-state={s.done ? 'done' : s.current ? 'current' : 'todo'}>
                <span className="cr-step__dot">{s.done ? <Icon id="i-check" /> : i + 1}</span>
                <span className="cr-step__label">{t(label)}</span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </>
  );
}

/* --- C0 · Ton créneau --------------------------------------------------------------------------------------------- */

export function CreerCreneau({ cards, claimSlot, onPick, onBookAnother, onBack }: {
  cards: readonly ResaCardData[];
  /** Règle 21 : les cartes « C'est bien toi ? » (réservations saisies par un centre à ton numéro), avant la liste. */
  claimSlot?: ReactNode;
  onPick: (id: string) => void;
  onBookAnother: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <section className="au-screen cr" id="s-creer-creneau">
      <CreerHeader step={2} onBack={onBack} />
      <h1 className="cr-h1">{t('Ton créneau')}</h1>
      {claimSlot}
      <section className="cr-list" aria-label={t('Tes réservations sans match')}>
        <h2 className="cr-h2">{t('Tes réservations sans match')}</h2>
        {cards.map((c) => (
          <button
            key={c.id} type="button" className="cr-resa mb-tap"
            aria-label={`${t('Créer un match')} · ${c.venueName} · ${t(c.weekdayKey)} ${c.date} · ${c.hour}`}
            onClick={() => onPick(c.id)}
          >
            <img src={heroPhoto} alt="" />
            <span className="cr-resa__veil" />
            {c.sport === 'PADEL' ? <span className="cr-card__padel" /> : null}
            <span className="cr-resa__tags"><SportBadge sport={c.sport} /><span className="cr-tag">{formatBadge(c.format)}</span></span>
            <span className="cr-resa__body">
              <span className="cr-resa__txt">
                <span className="cr-resa__day">{t(c.weekdayKey)} {c.date} · {t(c.duration)}</span>
                <span className="cr-resa__line">
                  <b className="cr-resa__hour"><Ltr>{c.hour}</Ltr></b>
                  <span className="cr-resa__venue">{c.venueName}</span>
                </span>
                <span className="cr-resa__sub">
                  {c.fieldName} · <span className="mb-price" data-unit="total"><Ltr>{fmt(c.totalDa)}</Ltr><span className="mb-price__cur">{t('DA')}</span></span>
                </span>
              </span>
              <span className="cr-resa__go"><Icon id="i-arrow" /></span>
            </span>
          </button>
        ))}
      </section>
      <button type="button" className="cr-other mb-tap" onClick={onBookAnother}><Icon id="i-plus" />{t('Réserver un autre créneau')}</button>
      <div className="cr-pad" />
    </section>
  );
}

/* --- Le récapitulatif du match (S7 et S8) : logo du centre (photo en phase 6), sport, format, niveau, date, centre ---------------- */

function SummaryCard({ summary: s, level, children }: { summary: MatchSummary; level: SkillLevel; children: ReactNode }) {
  const t = useT();
  const lang = useLang();
  const arrow = lang === 'ar' ? '←' : '→';
  const date = ticketDateLabel(s.startEpoch, lang);
  const bars = level === 'COMPETITION' ? 3 : level === 'INTERMEDIAIRE' ? 2 : 1;
  const lvl = t(levelLabel(level));
  return (
    <div className="cv-card">
      <div className="cv-card__top">
        <VenuePhoto src={s.photoUrl ?? null}>
          <span className="cv-card__logo" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 60 60"><path d="M8 12h20l-7 18 7 18H8l7-18z" fill="#D9D9D9" /><path d="M32 12h20l-7 18 7 18H32l7-18z" fill="#E32A00" /></svg>
          </span>
        </VenuePhoto>
        <span className="cv-card__veil" aria-hidden="true" />
        <div className="cv-card__tags">
          <span className="cv-tags"><SportBadge sport={s.sport} /><span className="cv-tag"><Ltr>{formatBadge(s.format)}</Ltr></span></span>
          <span className="cv-tag">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 20v-5" opacity={bars >= 1 ? 1 : 0.3} /><path d="M12 20v-9" opacity={bars >= 2 ? 1 : 0.3} /><path d="M19 20V4" opacity={bars >= 3 ? 1 : 0.3} />
            </svg>
            {lang === 'ar' ? lvl : lvl.toUpperCase()}
          </span>
        </div>
        <div className="cv-card__low">
          <span className="cv-card__date">{lang === 'ar' ? date : date.toUpperCase()} · <Ltr>{hhmm(epochMinutesOfDay(s.startEpoch))}</Ltr> {arrow} <Ltr>{hhmm(epochMinutesOfDay(s.endEpoch))}</Ltr></span>
          <span className="cv-card__name">{s.venueName.toUpperCase()}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function PerPlayer({ amountDa }: { amountDa: number }) {
  const t = useT();
  return <span className="cv-price"><Ltr>{fmt(amountDa)}</Ltr> {t('DA')}<small>{t('par joueur')}</small></span>;
}

/* --- C1 · Détails (S7) ------------------------------------------------------------------------------------------------------------ */

export function CreerConfig(p: {
  summary: MatchSummary;
  level: SkillLevel;
  onLevel: (level: SkillLevel) => void;
  note: string;
  onNote: (note: string) => void;
  publishing: boolean;
  /** Raison affichée sous le bouton quand le match ne peut pas partir (format inconnu…). */
  error: string | null;
  onBack: () => void;
  /** « Publier mon match » (public) ou le lien « Publier en privé » (dossier §3 : public par défaut). */
  onPublish: (visibility: 'OPEN' | 'PRIVATE') => void;
  toast: ReactNode;
}) {
  const t = useT();
  const { summary: s } = p;
  const terrain = /^terrain\b/i.test(s.fieldName.trim()) ? s.fieldName : `${t('Terrain')} ${s.fieldName}`;
  return (
    <section className="au-screen cr" id="s-creer-config">
      <CreerHeader step={3} onBack={p.onBack} />
      <section className="cr-preview" aria-label={t('Aperçu de ton match')}>
        <SummaryCard summary={s} level={p.level}>
          <div className="cv-card__row">
            <span className="cv-card__field">{terrain}</span>
            <PerPlayer amountDa={s.perPlayerDa} />
          </div>
        </SummaryCard>
      </section>

      <section className="cr-block">
        <h2 className="cv-q" id="cr-q-level">{t('Niveau')}</h2>
        <div className="mv-seg cv-levels" role="radiogroup" aria-labelledby="cr-q-level">
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

      <section className="cr-block cv-desc">
        <label className="cv-q" htmlFor="cr-note">{t('Description')}</label>
        <textarea id="cr-note" className="cr-note cv-note" rows={4} maxLength={NOTE_MAX} value={p.note} dir="auto" onChange={(e) => p.onNote(e.target.value)} />
      </section>

      <footer className="cr-foot cv-foot">
        <button type="button" className="mv-cta mb-tap" data-loading={p.publishing ? 'true' : undefined} disabled={p.publishing || p.error !== null} onClick={() => p.onPublish('OPEN')}>
          {t('Publier mon match')}
        </button>
        <button type="button" className="cv-private mb-tap" disabled={p.publishing || p.error !== null} onClick={() => p.onPublish('PRIVATE')}>
          <Icon id="i-lock" /><span>{t('Publier en privé')}</span>
        </button>
        {p.error ? <p className="cr-err" role="alert">{p.error}</p> : null}
      </footer>
      {p.toast}
    </section>
  );
}

/* --- C2 · Ton match est en ligne / prêt (S8, S8P) — sans la barre d'étapes, sans jauge (dossier §2 : pas de jauge) --------------- */

export function CreerPublie(p: {
  summary: MatchSummary;
  level: SkillLevel;
  visibility: 'OPEN' | 'PRIVATE';
  /** Le lien du match sans protocole (« app.moubarat.app/m/7KQ2XM »), null tant que le serveur ne l'a pas servi. */
  linkLabel: string | null;
  copied: boolean;
  onCopy: () => void;
  shareHref: string;
  onSeeMatch: () => void;
  onBack: () => void;
  toast: ReactNode;
}) {
  const t = useT();
  const tn = useTn();
  const { summary: s } = p;
  const priv = p.visibility === 'PRIVATE';
  return (
    <section className="au-screen cr cv-done" id="s-creer-publie">
      <div className="cv-done__head">
        <span className="rv6-check" aria-hidden="true"><Icon id="i-check" /></span>
        <h1 className="cv-done__h1">{t(priv ? 'Ton match est prêt' : 'Ton match est en ligne')}</h1>
        <p className="cv-done__sub">{t(priv ? 'Il est privé : seuls tes potes avec le lien peuvent le voir.' : 'Envoie le lien à tes potes.')}</p>
      </div>

      <section className="cr-preview" aria-label={t('Aperçu du match')}>
        <SummaryCard summary={s} level={p.level}>
          <div className="cv-card__row">
            <span className="cv-card__field">{tn('Plus que {n} places', Math.max(s.places - 1, 0))}</span>
            {s.perPlayerDa > 0 ? <PerPlayer amountDa={s.perPlayerDa} /> : null}
          </div>
        </SummaryCard>
      </section>

      <div className="cv-actions">
        <a className="mv-cta mb-tap" href={p.shareHref} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />{t('Inviter sur WhatsApp')}</a>
        {p.linkLabel ? (
          <div className="cr-linkrow">
            <Icon id="i-link" />
            <span className="cr-linkrow__t"><Ltr>{p.linkLabel}</Ltr></span>
            <button type="button" className="cr-copy mb-tap" onClick={p.onCopy}>{t(p.copied ? 'Copié ✓' : 'Copier')}</button>
          </div>
        ) : null}
        <button type="button" className="cr-ghost mb-tap" onClick={p.onSeeMatch}>{t('Voir le match')}</button>
      </div>
      {p.toast}
    </section>
  );
}
