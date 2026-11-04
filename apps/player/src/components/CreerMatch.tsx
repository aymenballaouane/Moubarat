import { Fragment, type ReactNode } from 'react';
import type { MatchFormat, SkillLevel, Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import { Ltr } from './Ltr.js';
import { fmt, hhmm, epochMinutesOfDay } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { levelLabel, sportLabel } from '../lib/labels.js';
import { CREATE_STEPS, NOTE_MAX, formatBadge, stepStates } from '../lib/createMatch.js';
import { fillTemplate, ticketDateLabel } from '../lib/reserverCreneau.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/create.css';

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
        <span className="cr-crumb">{t('CRÉER UN MATCH')}</span>
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
      <CreerHeader step={1} onBack={onBack} />
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

/* --- Aperçu partagé par C1 et C2 : la photo, les badges, le niveau ------------------------------------------------- */

function PreviewShell({ summary, level, variant, children }: { summary: MatchSummary; level: SkillLevel; variant: 'c1' | 'c2'; children: ReactNode }) {
  const t = useT();
  return (
    <div className={`cr-card cr-card--${variant}`}>
      <img src={heroPhoto} alt="" />
      <span className="cr-card__veil" />
      {summary.sport === 'PADEL' ? <span className="cr-card__padel" /> : null}
      <span className="cr-card__tags">
        <SportBadge sport={summary.sport} />
        {variant === 'c1' ? <span className="cr-tag">{formatBadge(summary.format)}</span> : null}
      </span>
      <span className="cr-card__lvl">{t(levelLabel(level)).toUpperCase()}</span>
      <span className="cr-card__body">{children}</span>
    </div>
  );
}

function PerPlayer({ amountDa }: { amountDa: number }) {
  const t = useT();
  return <span className="mb-price" data-unit="player"><Ltr>{fmt(amountDa)}</Ltr><span className="mb-price__cur">{t('DA')}</span></span>;
}

/* --- C1 · Configure ton match ------------------------------------------------------------------------------------- */

export function CreerConfig(p: {
  summary: MatchSummary;
  level: SkillLevel;
  onLevel: (level: SkillLevel) => void;
  /** « Ouvert à tous » (dans Explorer) ou « Sur invitation » (seulement par le lien — règle 6). */
  visibility: 'OPEN' | 'PRIVATE';
  onVisibility: (visibility: 'OPEN' | 'PRIVATE') => void;
  note: string;
  onNote: (note: string) => void;
  publishing: boolean;
  /** Raison affichée sous le bouton quand le match ne peut pas partir (format inconnu…). */
  error: string | null;
  onChangeSlot: () => void;
  onBack: () => void;
  onPublish: () => void;
  toast: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const { summary: s } = p;
  const arrow = lang === 'ar' ? '←' : '→';
  const start = hhmm(epochMinutesOfDay(s.startEpoch));
  const end = hhmm(epochMinutesOfDay(s.endEpoch));
  return (
    <section className="au-screen cr" id="s-creer-config">
      <CreerHeader step={2} onBack={p.onBack} />
      <h1 className="cr-h1 cr-h1--row">{t('Configure ton match')}</h1>

      <section className="cr-preview" aria-label={t('Aperçu de ton match')}>
        <PreviewShell summary={s} level={p.level} variant="c1">
          <span className="cr-card__date">{ticketDateLabel(s.startEpoch, lang)} · <Ltr>{start}</Ltr> {arrow} <Ltr>{end}</Ltr></span>
          <span className="cr-card__name">{s.venueName.toUpperCase()}</span>
          <span className="cr-card__row">
            <span className="cr-card__field">{s.fieldName}</span>
            <span className="cr-card__price"><PerPlayer amountDa={s.perPlayerDa} /></span>
          </span>
        </PreviewShell>
        <div className="cr-change"><button type="button" className="mb-tap" onClick={p.onChangeSlot}><span>{t('Changer de créneau')}</span></button></div>
      </section>

      <section className="cr-block">
        <span className="cr-q" id="cr-q-level">{t('Quel niveau ?')}</span>
        <div className="cr-levels" role="radiogroup" aria-labelledby="cr-q-level">
          {LEVELS.map((l, k) => (
            <button key={l} type="button" role="radio" aria-checked={p.level === l} className="cr-level mb-tap" onClick={() => p.onLevel(l)}>
              <span className="cr-level__bars" aria-hidden="true">
                <i style={{ height: 6 }} data-on="true" /><i style={{ height: 11 }} data-on={k >= 1 ? 'true' : undefined} /><i style={{ height: 16 }} data-on={k >= 2 ? 'true' : undefined} />
              </span>
              <span>{t(levelLabel(l))}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="cr-block">
        <span className="cr-q" id="cr-q-visi">{t('Qui peut venir ?')}</span>
        <div className="cr-seg" role="radiogroup" aria-labelledby="cr-q-visi">
          {(['OPEN', 'PRIVATE'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={p.visibility === v} className="cr-seg__b mb-tap" onClick={() => p.onVisibility(v)}>
              <Icon id={v === 'OPEN' ? 'i-globe' : 'i-lock'} />{t(v === 'OPEN' ? 'Ouvert à tous' : 'Sur invitation')}
            </button>
          ))}
        </div>
      </section>

      <section className="cr-block">
        <label className="cr-q" htmlFor="cr-note">{t('Un petit mot pour les joueurs ?')}</label>
        <textarea
          id="cr-note" className="cr-note" rows={3} maxLength={NOTE_MAX} value={p.note}
          placeholder={t('On joue à la cool. Ramenez une chasuble blanche et une noire.')}
          onChange={(e) => p.onNote(e.target.value)}
        />
      </section>

      <footer className="cr-foot">
        <button type="button" className="cr-cta mb-tap" data-loading={p.publishing ? 'true' : undefined} disabled={p.publishing || p.error !== null} onClick={p.onPublish}>
          {t('Publier le match')}
        </button>
        {p.error ? <p className="cr-err" role="alert">{p.error}</p> : null}
      </footer>
      {p.toast}
    </section>
  );
}

/* --- C2 · Ton match est en ligne ---------------------------------------------------------------------------------- */

export function CreerPublie(p: {
  summary: MatchSummary;
  level: SkillLevel;
  visibility: 'OPEN' | 'PRIVATE';
  /** Le lien du match sans protocole (« app.moubaratsport.com/m/7KQ2XM »), `null` tant que le serveur ne l'a pas servi. */
  linkLabel: string | null;
  copied: boolean;
  onCopy: () => void;
  shareHref: string;
  onSeeMatch: () => void;
  onBack: () => void;
  toast: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const { summary: s } = p;
  const missing = s.places - 1;
  return (
    <section className="au-screen cr" id="s-creer-publie">
      <CreerHeader step={3} onBack={p.onBack} />
      <div className="cr-done">
        <span className="cr-done__check"><Icon id="i-check" /></span>
        <h1>{t('Ton match est en ligne')}</h1>
        <p>{t(p.visibility === 'OPEN' ? 'Envoie le lien à tes potes.' : 'Seuls ceux qui ont le lien peuvent le rejoindre.')}</p>
      </div>

      <section className="cr-preview" aria-label={t('Aperçu du match')} style={{ marginTop: 26 }}>
        <PreviewShell summary={s} level={p.level} variant="c2">
          <span className="cr-card__date">{ticketDateLabel(s.startEpoch, lang)}</span>
          <span className="cr-card__big">
            <b className="cr-card__hour"><Ltr>{hhmm(epochMinutesOfDay(s.startEpoch))}</Ltr></b>
            <span className="cr-card__title">{s.venueName.toUpperCase()}</span>
          </span>
          <span className="cr-card__meta">{formatBadge(s.format)} · <PerPlayer amountDa={s.perPlayerDa} /></span>
          <span className="cr-gauge">
            <span className="cr-gauge__bar"><i style={{ width: `${Math.round(100 / s.places)}%` }} /></span>
            <span className="cr-gauge__txt"><Ltr><b>1</b>/{s.places}</Ltr> · {fillTemplate(t('il en manque {n}'), { n: String(missing) })}</span>
          </span>
        </PreviewShell>
      </section>

      <div className="cr-actions">
        <a className="cr-cta mb-tap" href={p.shareHref} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />{t('Inviter sur WhatsApp')}</a>
        {p.linkLabel ? (
          <div className="cr-linkrow">
            <Icon id="i-link" />
            <span className="cr-linkrow__t"><Ltr>{p.linkLabel}</Ltr></span>
            <button type="button" className="cr-copy mb-tap" onClick={p.onCopy}>{t(p.copied ? 'Copié ✓' : 'Copier')}</button>
          </div>
        ) : null}
        <button type="button" className="cr-ghost mb-tap" onClick={p.onSeeMatch}>{t('Voir le match')}</button>
      </div>
      <div className="cr-pad" />
      {p.toast}
    </section>
  );
}
