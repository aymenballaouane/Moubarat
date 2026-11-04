import { useEffect, useState } from 'react';
import type { MatchFormat, MatchTeam, Sport } from '@moubarat/core';
import { LoadMoreButton } from './LoadMoreButton.js';
import { Icon } from './Icon.js';
import { ClaimCard, useClaimAnswer } from './ClaimCard.js';
import { Ltr } from './Ltr.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import type { ActionResult } from '../lib/api.js';
import { WEEKDAY_KEYS } from '../lib/calendar.js';
import { arPluralOk } from '../lib/explorerFilters.js';
import { epochDayLabel, epochMinutesOfDay, fmt, hhmm } from '../lib/format.js';
import { useLang, useT } from '../lib/i18n.js';
import { formatBadge } from '../lib/createMatch.js';
import { buildPast, buildUpcoming, pastDateParts, type PastRow, type UpcomingCard } from '../lib/mesMatchs.js';
import { fillTemplate } from '../lib/reserverCreneau.js';
import { useToast } from '../lib/useToast.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import heroPhoto from '../../../../design/photo-nocturne.jpg';
import '../styles/mes-matchs.css';

/* Mes matchs (Lot 8, MesMatchs.dc.html) — deux onglets : « À venir · N » (mes matchs — « TU ORGANISES », « TU JOUES · ÉQUIPE A » — et mes réservations
   « RÉSERVÉ · SANS MATCH », la plus proche d'abord) et « Passés » (joués, annulés : date, centre, « 5v5 · Équipe B », pastille). Rien de prévu : un état
   avec deux sorties (« Trouver un match », « Réserver un terrain »). Une réservation ne montre JAMAIS de prix ; un match est nommé par son centre (règle 41).
   Les actions d'une réservation (annuler, voir le ticket) vivent sur son ticket (R4) et dans la vue organisateur, plus sur la carte.
   Mis de côté avec le point 6 du plan : le bloc « RÉSERVÉ PAR TÉLÉPHONE · C'est bien toi ? » (serveur + CRM + notification du core à construire). */

type Tab = 'avenir' | 'passes';

/** Lettre d'équipe affichée : latine en français ; arabe → أ / ب dans « TU JOUES · الفريق أ » (maquette), latine dans « الفريق B » des passés. */
const AR_TEAM_LETTER: Record<MatchTeam, string> = { A: 'أ', B: 'ب' };

const formatLower = (f: MatchFormat) => formatBadge(f).toLowerCase();

export function MatchesScreen({ onNavigate, store, initialTab = 'avenir' }: { onNavigate: (route: Route) => void; store: AppStore; initialTab?: 'avenir' | 'passes' }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const claimAnswer = useClaimAnswer(store, onNavigate);
  useEffect(() => { void store.loadClaims(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [tab, setTab] = useState<Tab>(initialTab);
  const now = Date.now();

  const ctx = {
    meId: CURRENT_USER_ID, now, venueName: (id: string) => store.venueName(id), fieldInfo: (id: string) => store.fieldInfo(id),
    nameOf: (id: string) => store.knownPlayerName(id),
  };
  const mine = store.myMatches();
  const upcoming = buildUpcoming(store.myUpcoming(), store.reservations, ctx);
  const past = buildPast(mine, store.reservations, ctx);
  const moreToLoad = store.hasMore('reservations') || store.hasMore('myMatches');

  /** « Afficher plus » charge la page suivante des réservations ET des matchs (les deux listes nourrissent les deux onglets). */
  async function loadMoreAll(): Promise<ActionResult> {
    let res: ActionResult = { ok: true };
    if (store.hasMore('reservations')) res = await store.loadMore('reservations');
    if (res.ok && store.hasMore('myMatches')) res = await store.loadMore('myMatches');
    return res;
  }

  function openCard(c: UpcomingCard) {
    if (c.matchId) {
      onNavigate(c.mine ? { name: 'match', mode: 'organizer', matchId: c.matchId } : { name: 'match', mode: 'detail', matchId: c.matchId });
    } else if (c.bookingId) {
      // Une réservation s'ouvre TOUJOURS sur son ticket (R4 : annuler, créer un match) ; « Créer un match dessus → » est un raccourci à part (voir la carte).
      onNavigate({ name: 'booking', viewReservationId: c.bookingId });
    }
  }

  /* Même pivot que l'écran de succès de Réserver (prefill → Configure directement, la réservation est déjà résolue) — jamais un second chemin de création. Le flux
     travaille sur le centre OUVERT : d'abord aligné sur le centre de CETTE réservation. */
  async function createMatchOn(bookingId: string) {
    const r = store.reservations.find((x) => x.booking.id === bookingId);
    if (!r) return;
    const { booking } = r;
    const info = store.fieldInfo(booking.fieldId);
    if (info && store.venue?.id !== info.venueId) {
      const switched = await store.selectVenue(info.venueId);
      if (!switched.ok) { toast.show(switched.message); return; }
    }
    onNavigate({
      name: 'match', mode: 'create',
      prefill: {
        booking,
        label: `${epochDayLabel(booking.range.start)} · ${hhmm(epochMinutesOfDay(booking.range.start))} → ${hhmm(epochMinutesOfDay(booking.range.end))}`,
        ref: r.reference ?? '', sport: info?.field.sport as Sport | undefined, format: r.format,
      },
    });
  }

  const tabLabel = upcoming.length > 0 ? `${t('À venir')} · ${upcoming.length}${moreToLoad ? '+' : ''}` : t('À venir');

  return (
    <section className="tab-screen mm" id="s-matches">
      <header className="mm-head"><h1>{t('Mes matchs')}</h1></header>
      <div className="mm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'avenir'} className="mm-tab mb-tap" onClick={() => setTab('avenir')}>{tabLabel}</button>
        <button type="button" role="tab" aria-selected={tab === 'passes'} className="mm-tab mb-tap" onClick={() => setTab('passes')}>{t('Passés')}</button>
      </div>

      {/* Règle 21 : « C'est bien toi ? » — avant toute liste, tant que la réponse manque. */}
      {tab === 'avenir' ? store.claims.map((c) => (
        <ClaimCard key={c.bookingId} claim={c} busy={claimAnswer.busy} onAnswer={(kind) => { void claimAnswer.answer(c, kind); }} />
      )) : null}

      {tab === 'avenir' ? (
        upcoming.length === 0 ? (
          <div className="mm-empty">
            <span className="mm-empty__ic"><Icon id="i-cal" /></span>
            <h2>{t('Rien de prévu')}<br />{t('pour l’instant')}</h2>
            <p>{t('Rejoins un match près de chez toi, ou réserve un terrain avec tes potes.')}</p>
            <div className="mm-empty__cta">
              <button type="button" className="mm-cta mb-tap" onClick={() => onNavigate({ name: 'tab', tab: 'explorer' })}>{t('Trouver un match')}</button>
              <button type="button" className="mm-cta mm-cta--ghost mb-tap" onClick={() => onNavigate({ name: 'booking' })}>{t('Réserver un terrain')}</button>
            </div>
          </div>
        ) : (
          <section className="mm-list">
            {upcoming.map((c) => <UpcomingCardView key={c.id} c={c} onOpen={() => openCard(c)} onCreate={() => { if (c.bookingId) void createMatchOn(c.bookingId); }} />)}
            <LoadMoreButton visible={moreToLoad} loading={store.isLoadingMore('reservations') || store.isLoadingMore('myMatches')}
              onLoad={loadMoreAll} />
          </section>
        )
      ) : (
        <section className="mm-past" aria-label={t('Passés')}>
          {past.length === 0 ? <p className="mm-past__none">{t('Aucun match passé pour l’instant.')}</p> : past.map((r) => <PastRowView key={r.id} r={r} lang={lang}
            /* Règle 25 (audit 26/10, P1-4) : un match que J'AI ORGANISÉ et qui s'est joué s'ouvre sur la vue organisateur — c'est là qu'on déclare un inscrit absent. Les autres lignes restent de simples lignes (maquette). */
            onOpen={r.role.kind === 'organized' && r.state === 'played' && r.matchId ? () => onNavigate({ name: 'match', mode: 'organizer', matchId: r.matchId! }) : undefined} />)}
          <LoadMoreButton visible={moreToLoad} loading={store.isLoadingMore('reservations') || store.isLoadingMore('myMatches')}
            onLoad={loadMoreAll} />
        </section>
      )}
      <div className={`mb-toast${toast.message ? ' on' : ''}`} role="status" aria-live="polite">{toast.message ?? ''}</div>
      {claimAnswer.sheet}
    </section>
  );
}

function SportBadge({ sport }: { sport: Sport }) {
  const t = useT();
  return <span className="mm-badge">{sport === 'PADEL' ? t('PADEL') : t('FOOT')}</span>;
}

/** Une carte de « À venir » : la photo avec le jour et l'heure, puis l'état, le centre, le format et ce qu'on peut faire. */
function UpcomingCardView({ c, onOpen, onCreate }: { c: UpcomingCard; onOpen: () => void; onCreate: () => void }) {
  const t = useT();
  const lang = useLang();
  const d = new Date(c.startMs);
  const padel = c.sport === 'PADEL';
  const letter = (team: MatchTeam) => (lang === 'ar' ? AR_TEAM_LETTER[team] : team);

  const etat = c.kind === 'orga' ? t('TU ORGANISES')
    : c.kind === 'joue'
      ? (c.team ? fillTemplate(t(padel ? 'TU JOUES · PAIRE {team}' : 'TU JOUES · ÉQUIPE {team}'), { team: letter(c.team) }) : t('TU JOUES'))
      : c.pending ? t('À confirmer par le centre').toUpperCase() : t('RÉSERVÉ · SANS MATCH');

  const bas = c.kind === 'orga'
    ? (c.left === 0 ? t('Complet')
      : lang === 'ar' ? (arPluralOk(c.left) ? fillTemplate(t('Plus que {n} joueurs à trouver'), { n: String(c.left) }) : '')
        : `Plus que ${c.left} joueur${c.left > 1 ? 's' : ''} à trouver`)
    : c.kind === 'joue' ? fillTemplate(t('{prix} DA à payer sur place'), { prix: fmt(c.priceDa) })
      : t(c.canCreate ? 'Créer un match dessus →' : 'Voir ta réservation →');

  /* La carte entière ouvre sa cible ; sur une réservation où l'on peut créer un match, « Créer un match dessus → » est un bouton À PART (par-dessus la carte) — sans quoi le
     ticket d'une réservation qui peut porter un match ne serait plus joignable, donc plus annulable. */
  return (
    <div className="mm-card" data-kind={c.kind}>
      <button type="button" className="mm-card__hit mb-tap" aria-label={`${c.venueName} · ${etat}`} onClick={onOpen} />
      <span className="mm-card__photo">
        <img src={heroPhoto} alt="" />
        <span className="mm-card__veil" />
        {padel ? <span className="mm-card__padel" /> : null}
        <span className="mm-card__stack">
          <SportBadge sport={c.sport} />
          <span className="mm-card__day">{t(WEEKDAY_KEYS[d.getDay()]!)} {d.getDate()}</span>
          <b className="mm-card__hour"><Ltr>{hhmm(epochMinutesOfDay(c.startMs))}</Ltr></b>
        </span>
      </span>
      <span className="mm-card__body">
        <span className="mm-card__etat">{etat}</span>
        <span className="mm-card__name">{c.venueName}</span>
        <span className="mm-card__fmtrow"><span className="mm-card__fmt">{formatBadge(c.format)}</span>{c.fieldName ? <span className="mm-card__field">{c.fieldName}</span> : null}</span>
        {bas ? (c.kind === 'resa' && c.canCreate
          ? <button type="button" className="mm-card__bas mm-card__bas--btn" data-link="true" onClick={onCreate}>{bas}</button>
          : <span className="mm-card__bas" data-link={c.kind === 'resa' ? 'true' : undefined}>{bas}</span>) : null}
      </span>
    </div>
  );
}

/** Une ligne de « Passés » : le bloc date, le sport et le centre, « 5v5 · Équipe B », la pastille « Joué » / « Annulé ». */
function PastRowView({ r, lang, onOpen }: { r: PastRow; lang: 'fr' | 'ar'; onOpen?: (() => void) | undefined }) {
  const t = useT();
  const { month, day } = pastDateParts(r.startMs, lang);
  const padel = r.sport === 'PADEL';
  const fmtText = formatLower(r.format);
  const role = r.role.kind === 'organized' ? t('organisé')
    : r.role.kind === 'team' ? (r.role.team ? fillTemplate(t(padel ? 'Paire {team}' : 'Équipe {team}'), { team: r.role.team }) : null)
      : r.role.kind === 'cancelledBy' ? fillTemplate(t('annulé par {nom}'), { nom: r.role.name }) : null;
  const Row = onOpen ? 'button' : 'div';
  return (
    <Row className={`mm-prow${onOpen ? ' mm-prow--tap mb-tap' : ''}`} {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}>
      <span className="mm-prow__date"><small>{month}</small><b><Ltr>{day}</Ltr></b></span>
      <span className="mm-prow__who">
        <span className="mm-prow__top"><SportBadge sport={r.sport} /><b>{r.venueName}</b></span>
        <span className="mm-prow__sub"><Ltr>{fmtText}</Ltr>{role ? ` · ${role}` : ''}</span>
      </span>
      <span className="mm-prow__state" data-state={r.state}>{t(r.state === 'played' ? 'Joué' : 'Annulé')}</span>
    </Row>
  );
}
