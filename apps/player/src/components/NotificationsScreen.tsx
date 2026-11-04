import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  unreadCount, markRead, timeLeftLabel,
  type Challenge, type ChallengeStatus, type Notification, type NotificationType,
} from '@moubarat/core';
import { Icon } from './Icon.js';
import { LoadMoreButton } from './LoadMoreButton.js';
import { SegmentedTabs, type SegTab } from './SegmentedTabs.js';
import { useToast } from '../lib/useToast.js';
import type { ActionResult } from '../lib/api.js';
import { epochDayTimeLabel, teamInitials } from '../lib/format.js';
import { notificationIcon, notificationLabels } from '../lib/notificationView.js';
import {
  notificationGroup, notificationRoute, notificationRow, timeAgoLabel, type NotificationGroup, type NotificationLookups, type NotificationRowView,
} from '../lib/notificationFeed.js';
import { useLang, useT } from '../lib/i18n.js';
import { useClaimAnswer } from './ClaimCard.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { NOTIFICATIONS_SEED } from '../data/notificationsDemo.js';
import { INITIAL_CHALLENGES, opponentOf } from '../data/challengesDemo.js';
import { MY_TEAM_ID } from '../data/teamsDemo.js';
import { TEAMS_CHALLENGES_ENABLED } from '../lib/featureFlags.js';
import type { Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/notifications.css';

/* Centre de notifications — UN ecran, DEUX segments (Tout / Defis), jamais
   3 ecrans routes (spec §10). IA du benchmark : le defi qui attend une
   reponse est une carte bordee rouge, tout le reste des rangees d'activite
   calmes. Etats de l'ancien prototype : badge compte (unreadCount), lu/
   non-lu (readAt), « Tout lire » (markRead), etats vides par onglet.
   Titres/corps STRICTEMENT depuis NOTIFICATION_LABELS (core) — la semantique
   des destinataires (RECIPIENTS) y est deja juste, jamais « enrichie » d'une
   phrase inventee. L'activite est 1:1 avec l'entite Notification du core. */

type NotifTab = 'all' | 'defis';

/* Onglet Defis retire (scope gate MVP, 29/08/2026) : les notifs de defi ne
   sont de toute facon plus semees (notificationsDemo.ts) quand le flag est
   off — un onglet "Defis" vide aurait ete la contradiction UX qu'Aymen
   voulait eviter. */
const TABS: readonly SegTab<NotifTab>[] = [
  { value: 'all', label: 'Tout' },
  ...(TEAMS_CHALLENGES_ENABLED ? [{ value: 'defis' as const, label: 'Défis' }] : []),
];

const CHALLENGE_TYPES = new Set<NotificationType>([
  'CHALLENGE_RECEIVED', 'CHALLENGE_ACCEPTED', 'CHALLENGE_REJECTED', 'CHALLENGE_EXPIRED',
]);

/* Libellés et icônes : lib/notificationView.ts — un type INCONNU de cette version de l'app (serveur plus récent que la PWA en cache)
   s'y affiche comme une notification générique au lieu de faire planter l'écran (bug consigné le 25/09/2026). */

/* Teinte de pastille par categorie : rouge marque = defi a traiter, or =
   attente (coherent --filling), danger = annulation/refus, neutre sinon —
   l'expiration reste neutre eteinte comme .mb-status--expired. */
function toneOf(type: NotificationType): 'red' | 'gold' | 'danger' | 'neutral' {
  switch (type) {
    case 'CHALLENGE_RECEIVED': return 'red';
    case 'RESULT_TO_CONFIRM':
    case 'TEAM_INVITED': return 'gold'; // une réponse est attendue de toi
    case 'MATCH_CANCELLED':
    case 'MATCH_CANCELLED_BY_CENTER':
    case 'BOOKING_CANCELLED_BY_CENTER':
    case 'PLAYER_REMOVED':
    case 'CHALLENGE_REJECTED': return 'danger';
    default: return 'neutral';
  }
}

function challengeOf(refId: string | undefined): Challenge | undefined {
  return refId === undefined ? undefined : INITIAL_CHALLENGES.find((c) => c.id === refId);
}

/* L'adversaire d'un defi = le camp qui n'est pas mon equipe. */
function challengeOpponent(c: Challenge) {
  return opponentOf(c.fromTeamId === MY_TEAM_ID ? c.toTeamId : c.fromTeamId);
}

/* Meme vocabulaire d'etat que le StatusPill local de ChallengesFlow (non
   exporte la-bas) — a partager des que le fichier voisin s'ouvre. */
function DefiStatusPill({ status }: { status: ChallengeStatus }) {
  switch (status) {
    case 'PENDING': return <span className="mb-status mb-status--filling">En attente</span>;
    case 'ACCEPTED': return <span className="mb-status mb-status--open">Accepté</span>;
    case 'REJECTED': return <span className="mb-status mb-status--cancelled">Refusé</span>;
    case 'CANCELLED': return <span className="mb-status mb-status--expired">Retiré</span>;
    case 'EXPIRED': return <span className="mb-status mb-status--expired">Expiré</span>;
  }
}

/* Carte defi — bordure rouge forte seulement quand une reponse est attendue
   de toi (CHALLENGE_RECEIVED encore PENDING) ; hairline sinon. Toute la
   carte navigue, le CTA « Voir le défi » est le geste, pas le seul point
   tapable (piege releve sur le benchmark). */
function DefiCard({ n, ago, onOpen }: { n: Notification; ago: string; onOpen: () => void }) {
  const labels = notificationLabels(n.type);
  const c = challengeOf(n.refId);
  const opp = c === undefined ? undefined : challengeOpponent(c);
  const isUnread = n.readAt === undefined;
  const hot = n.type === 'CHALLENGE_RECEIVED' && c?.status === 'PENDING';
  return (
    <button
      type="button"
      className={'nt-defi mb-enter' + (hot ? ' nt-defi--hot' : '') + (isUnread ? ' nt-defi--unread' : '')}
      onClick={onOpen}
    >
      <span className="nt-defi__top">
        {isUnread ? <i className="nt-dot" aria-hidden="true" /> : null}
        <span className="nt-defi__label">{labels.title}</span>
        <span className="nt-when">{ago}</span>
      </span>
      <span className="nt-defi__row">
        <span className="tm-crest tm-crest--sm">{opp === undefined ? '—' : teamInitials(opp.name)}</span>
        <span className="nt-defi__id">
          <b>{opp?.name ?? 'Équipe adverse'}</b>
          {c !== undefined ? <span>{c.format} · {epochDayTimeLabel(c.proposedRange.start)}</span> : null}
        </span>
        {c !== undefined ? <DefiStatusPill status={c.status} /> : null}
      </span>
      <span className="nt-defi__body">{labels.body}</span>
      <span className="nt-defi__foot">
        <span className="nt-defi__go">Voir le défi<Icon id="i-arrow" className="mb-ic--sm" /></span>
        {c !== undefined && c.status === 'PENDING' ? <span className="mb-tag">{timeLeftLabel(c, Date.now())}</span> : null}
      </span>
    </button>
  );
}

/* Rangee defi compacte — un defi qui n'attend plus rien de toi (issue deja
   connue, ou envoye) redevient une simple ligne d'identite : blason + nom +
   format/creneau + pastille de statut. Meme composition que
   ChallengesFlow.tc-defi-row (inbox défis), qui reproduit deja fidelement
   le screen-notif-defis-envoyes du prototype — jamais la carte bordee rouge,
   reservee au seul defi recu encore PENDING (DefiCard ci-dessus). */
function DefiRow({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const c = challengeOf(n.refId);
  const opp = c === undefined ? undefined : challengeOpponent(c);
  return (
    <button type="button" className="nt-defi-row mb-tap" onClick={onOpen}>
      <span className="tm-crest tm-crest--sm">{opp === undefined ? '—' : teamInitials(opp.name)}</span>
      <span className="n">
        <b>{opp?.name ?? 'Équipe adverse'}</b>
        {c !== undefined ? <span>{c.format} · {epochDayTimeLabel(c.proposedRange.start)}</span> : null}
      </span>
      {c !== undefined ? <DefiStatusPill status={c.status} /> : null}
    </button>
  );
}

/* Rangée d'activité (Notifications.dc.html, Lot 11) : pastille ronde 40 px, titre en gras + horodatage, une ligne de détail, un point rouge à gauche quand elle n'est pas lue.
   Toute la rangée s'ouvre ; « Prendre la place » est un second geste, jamais imbriqué dans le premier (stopPropagation). */
function ActivityRow({ n, view, ago, onOpen, onTake, onClaim, claimBusy }: {
  n: Notification; view: NotificationRowView; ago: string; onOpen: () => void; onTake: () => void;
  onClaim: (kind: 'confirm' | 'decline') => void; claimBusy: boolean;
}) {
  const t = useT();
  const unread = n.readAt === undefined;
  const tone = toneOf(n.type);
  const key = (e: KeyboardEvent<HTMLDivElement>) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } };
  const take = (e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onTake(); };
  return (
    <div className={'nt2-row mb-enter' + (unread ? ' nt2-row--unread' : '')} role="button" tabIndex={0} onClick={onOpen} onKeyDown={key}>
      {unread ? <i className="nt2-dot" aria-hidden="true" /> : null}
      <span className={'nt2-ic' + (n.type === 'SPOT_FREED' ? ' nt2-ic--red' : tone === 'danger' ? ' nt2-ic--danger' : '')}><Icon id={notificationIcon(n.type)} /></span>
      <span className="nt2-col">
        <span className="nt2-top"><b className="nt2-title">{view.title}</b><span className="nt-when">{ago}</span></span>
        {view.line !== null ? <span className="nt2-line">{view.line}</span> : null}
        {view.cta === 'take-spot' ? (
          <span className="nt2-actions"><button type="button" className="nt2-cta mb-tap" onClick={take}>{t('Prendre la place')}</button></span>
        ) : null}
        {view.cta === 'claim' ? (
          <span className="nt2-actions">
            <button type="button" className="cl-btn cl-btn--yes mb-tap" disabled={claimBusy} onClick={(e) => { e.stopPropagation(); onClaim('confirm'); }}>{t('C’est moi')}</button>
            <button type="button" className="cl-btn cl-btn--no mb-tap" disabled={claimBusy} onClick={(e) => { e.stopPropagation(); onClaim('decline'); }}>{t('Ce n’est pas moi')}</button>
          </span>
        ) : null}
      </span>
    </div>
  );
}

interface NotificationsScreenProps {
  onExit: () => void;
  onNavigate?: ((route: Route) => void) | undefined;
  /** Liste controlee par App (etat partage avec le badge de la cloche du
      Home) — repli sur un etat local si absente. */
  items?: Notification[] | undefined;
  onItemsChange?: ((items: Notification[]) => void) | undefined;
  findMatch: AppStore['findMatch'];
  /** Le centre d'un match (d'après l'identifiant du match — plusieurs centres existent, jamais « le centre courant »). */
  venueNameOfMatch: (matchId: string) => string | null;
  /** La réservation `bookingId` : son centre et son créneau, `null` si l'app ne la connaît pas. */
  booking: NotificationLookups['booking'];
  /** Règle 21 : les demandes « C'est bien toi ? » et leur réponse (la carte des notifications répond sans quitter l'écran). */
  store: AppStore;
  /** « Afficher plus » (L3, 25/09/2026) : les notifications plus anciennes que la page chargée. Absent = jamais de bouton. */
  more?: { visible: boolean; loading: boolean; onLoad: () => Promise<ActionResult> } | undefined;
}

const GROUPS: readonly { id: NotificationGroup; label: string }[] = [
  { id: 'today', label: 'Aujourd’hui' }, { id: 'week', label: 'Cette semaine' }, { id: 'older', label: 'Plus ancien' },
];

export function NotificationsScreen({ onExit, onNavigate, items: itemsProp, onItemsChange, findMatch, venueNameOfMatch, booking, store, more }: NotificationsScreenProps) {
  const t = useT();
  const claimAnswer = useClaimAnswer(store, (route) => onNavigate?.(route));
  const claimOf = (bookingId: string) => store.claims.find((c) => c.bookingId === bookingId) ?? null;
  const lang = useLang();
  const [localItems, setLocalItems] = useState<Notification[]>(NOTIFICATIONS_SEED);
  const items = itemsProp ?? localItems;
  const applyItems = (next: Notification[]) => { if (onItemsChange) onItemsChange(next); else setLocalItems(next); };
  const [tab, setTab] = useState<NotifTab>('all');
  const toast = useToast();
  const now = Date.now();
  const lookups: NotificationLookups = { now, myId: CURRENT_USER_ID, t, findMatch, venueNameOfMatch, booking, claim: claimOf };

  const unread = unreadCount(items, CURRENT_USER_ID);
  const mine = items
    .filter((n) => n.userId === CURRENT_USER_ID)
    .sort((a, b) => b.createdAt - a.createdAt);

  const defis = mine.filter((n) => CHALLENGE_TYPES.has(n.type));
  /* Seul un defi recu encore PENDING « crie » en carte dans l'onglet Tout ;
     les issues de defi (accepte/refuse/expire) redeviennent de l'activite. */
  const isActionable = (n: Notification) =>
    n.type === 'CHALLENGE_RECEIVED' && challengeOf(n.refId)?.status === 'PENDING';
  const hotDefis = mine.filter(isActionable);
  const activity = mine.filter((n) => !isActionable(n));

  const open = (n: Notification) => {
    /* markRead cible d'abord, navigation ensuite — l'ecran revisite plus
       tard doit montrer la notif deja lue. */
    if (n.readAt === undefined) applyItems(markRead(items, CURRENT_USER_ID, Date.now(), [n.id]));
    const route = notificationRoute(n, lookups, TEAMS_CHALLENGES_ENABLED);
    if (route !== null) onNavigate?.(route);
  };

  const readAll = () => {
    if (unread === 0) return;
    applyItems(markRead(items, CURRENT_USER_ID, Date.now()));
    toast.show(unread === 1 ? t('Notification marquée comme lue.') : t('Toutes les notifications sont marquées comme lues.'));
  };

  const ago = (n: Notification) => timeAgoLabel(n.createdAt, now, t, lang);

  return (
    <section className="au-screen" id="s-notifications">
      <header className="nt-top">
        <button type="button" className="mb-back mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button>
        <button type="button" className="nt2-readall mb-tap" disabled={unread === 0} onClick={readAll}>
          {unread === 0 ? t('Tout est lu ✓') : t('Tout marquer comme lu')}
        </button>
      </header>
      <h1 className="nt2-h1">{t('Notifications')}</h1>

      {TABS.length > 1 ? (
        <div className="nt-tabs">
          <SegmentedTabs tabs={TABS} active={tab} onSelect={setTab} />
        </div>
      ) : null}

      {tab === 'all' ? (
        mine.length === 0 ? (
          <div className="mb-note nt-empty">
            <div className="mb-note__mark"><Icon id="i-bell" className="mb-ic--lg" /></div>
            <h4 className="mb-note__title">{t('Tout est calme')}</h4>
            <p className="mb-note__text">{t('Aucune notification pour l’instant. Tes défis et tes matchs apparaîtront ici.')}</p>
          </div>
        ) : (
          <>
            {hotDefis.length > 0 ? (
              <>
                <h2 className="hm-section-label nt-sec">{t('Défis')}</h2>
                <div className="nt-cards">
                  {hotDefis.map((n) => <DefiCard key={n.id} n={n} ago={ago(n)} onOpen={() => open(n)} />)}
                </div>
              </>
            ) : null}
            {GROUPS.map((g) => {
              const rows = activity.filter((n) => notificationGroup(n.createdAt, now) === g.id);
              if (rows.length === 0) return null;
              return (
                <div key={g.id} className="nt2-group">
                  <h2 className="nt2-sec">{t(g.label)}</h2>
                  <div className="nt2-list">
                    {rows.map((n) => (
                      <ActivityRow key={n.id} n={n} view={notificationRow(n, lookups)} ago={ago(n)} onOpen={() => open(n)} onTake={() => open(n)}
                        onClaim={(kind) => { const c = n.refId === undefined ? null : claimOf(n.refId); if (c) void claimAnswer.answer(c, kind); }} claimBusy={claimAnswer.busy} />
                    ))}
                  </div>
                </div>
              );
            })}
            {more ? <LoadMoreButton visible={more.visible} loading={more.loading} onLoad={more.onLoad} /> : null}
          </>
        )
      ) : defis.length === 0 ? (
        <div className="mb-note nt-empty">
          <div className="mb-note__mark"><Icon id="i-shield" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Aucun défi')}</h4>
          <p className="mb-note__text">{t('Quand ton équipe est défiée — ou qu’un adversaire répond — ça se passe ici.')}</p>
        </div>
      ) : (
        <div className="nt-cards nt-cards--tab">
          {defis.map((n) => (
            isActionable(n)
              ? <DefiCard key={n.id} n={n} ago={ago(n)} onOpen={() => open(n)} />
              : <DefiRow key={n.id} n={n} onOpen={() => open(n)} />
          ))}
        </div>
      )}

      <div className={'mb-toast' + (toast.message ? ' on' : '')} role="status" aria-live="polite">{toast.message ?? ''}</div>
      {claimAnswer.sheet}
    </section>
  );
}
