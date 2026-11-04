import { activePlayers, type Match, type MatchPlayer, type Notification, type NotificationType } from '@moubarat/core';
import { isKnownNotificationType, notificationLabels } from './notificationView.js';
import { isSameCalendarDay, relativeDayLabel, hhmm, epochMinutesOfDay } from './format.js';
import type { Route } from '../nav.js';
import { claimSlotLabel, type Claim } from './claimView.js';
import { getLang } from './lang.js';

/* Lot 11 (Notifications.dc.html, règles 38 et 39) : ce que dit chaque ligne du centre de notifications, dans quel groupe elle tombe, et où elle mène.
   Fonctions PURES (aucun hook) : `t` et les lectures du dépôt sont passés en paramètre. Une ligne n'affiche jamais un fait qu'on ne connaît pas — pas de centre
   connu = pas de centre, pas d'acteur connu = le libellé du core tel quel (« Un joueur a rejoint ton match »). */

/** L'acteur d'une notification (« Karim a rejoint ton match ») : servi par `GET /me/notifications` à côté du type core, qui ne porte que son id. */
export type NotificationWithActor = Notification & { actorName?: string | undefined };
export const actorNameOf = (n: Notification): string | undefined => (n as NotificationWithActor).actorName;

export type NotificationGroup = 'today' | 'week' | 'older';
const WEEK_MS = 7 * 86_400_000;

/** « Aujourd'hui » = même jour calendaire ; « Cette semaine » = les 7 jours qui précèdent ; le reste, « Plus ancien ». */
export function notificationGroup(createdAt: number, now: number): NotificationGroup {
  if (isSameCalendarDay(createdAt, now)) return 'today';
  return now - createdAt < WEEK_MS ? 'week' : 'older';
}

export interface NotificationLookups {
  now: number;
  myId: string;
  t: (key: string) => string;
  findMatch: (matchId: string) => { match: Match; players: MatchPlayer[] } | undefined;
  venueNameOfMatch: (matchId: string) => string | null;
  /** La réservation `bookingId` : son centre et son créneau, `null` si elle n'est pas (ou plus) dans l'app. */
  booking: (bookingId: string) => { venueName: string | null; start: number; end: number } | null;
  /** « C'est bien toi ? » : la demande EN ATTENTE pour cette réservation, `null` si elle est répondue, annulée ou inconnue. */
  claim?: (bookingId: string) => Claim | null;
}

export interface NotificationRowView {
  title: string;
  /** La ligne de détail (centre · jour heure…), `null` quand rien de sûr à dire. */
  line: string | null;
  /** « Prendre la place » : seulement quand la place peut encore se prendre (ou qu'on ne sait pas encore). */
  cta: 'take-spot' | 'claim' | null;
}

const fill = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);

const clock = (ms: number): string => hhmm(epochMinutesOfDay(ms));
/** Le jour au milieu d'une phrase : « ce soir », « demain », « mer. 21 oct. » (l'arabe n'a pas de casse : inchangé). */
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** « Stade de Birkhadem · Ce soir 21:30 » (sans point final) — le centre peut manquer (un match que l'app ne connaît pas encore). */
function whenPart(venue: string | null, start: number, lk: NotificationLookups, sep: string): string {
  const when = `${lowerFirst(relativeDayLabel(start, lk.now, lk.t))} ${clock(start)}`;
  return `${venue === null ? '' : `${venue}${sep}`}${when}`;
}

/** En arabe, un point final derrière du texte latin (nom du centre) s'affiche AU DÉBUT de la ligne : une marque droite-à-gauche avant lui le garde à la fin. */
export function rtlStop(line: string | null, lang: 'fr' | 'ar'): string | null {
  return lang === 'ar' && line !== null && line.endsWith('.') ? `${line.slice(0, -1)}‏.` : line;
}

export function notificationRow(n: Notification, lk: NotificationLookups): NotificationRowView {
  const row = notificationRowRaw(n, lk);
  return { ...row, line: rtlStop(row.line, getLang()) };
}

function notificationRowRaw(n: Notification, lk: NotificationLookups): NotificationRowView {
  const { t } = lk;
  const labels = notificationLabels(n.type);
  const actor = actorNameOf(n);
  const entry = n.refId === undefined ? undefined : lk.findMatch(n.refId);
  const venue = n.refId === undefined ? null : lk.venueNameOfMatch(n.refId);
  const start = entry?.match.range.start;

  if (!isKnownNotificationType(n.type)) return { title: t(labels.title), line: t(labels.body), cta: null };

  switch (n.type) {
    case 'PLAYER_JOINED':
    case 'PLAYER_LEFT': {
      const joined = n.type === 'PLAYER_JOINED';
      const title = actor === undefined
        ? t(labels.title)
        : fill(t(joined ? '{nom} a rejoint ton match' : '{nom} s’est désinscrit de ton match'), { nom: actor });
      if (entry === undefined || start === undefined) return { title, line: null, cta: null };
      const count = joined ? ` · ${activePlayers(entry.players).length}/${entry.match.capacity}` : '';
      return { title, line: `${whenPart(venue, start, lk, ', ')}${count}.`, cta: null };
    }
    case 'MATCH_FILLING': {
      if (entry === undefined || start === undefined) return { title: t(labels.title), line: null, cta: null };
      return { title: t(labels.title), line: `${whenPart(venue, start, lk, ', ')} · ${activePlayers(entry.players).length}/${entry.match.capacity}.`, cta: null };
    }
    case 'SPOT_FREED': {
      const takeable = entry === undefined
        || (entry.match.status !== 'CANCELLED' && entry.match.status !== 'PLAYED' && entry.match.status !== 'LOCKED'
          && activePlayers(entry.players).length < entry.match.capacity && entry.match.range.start > lk.now
          && !activePlayers(entry.players).some((p) => p.userId === lk.myId));
      return { title: t('Une place s’est libérée !'), line: start === undefined ? null : `${whenPart(venue, start, lk, ' · ')}.`, cta: takeable ? 'take-spot' : null };
    }
    case 'BOOKING_CLAIM': {
      // Règle 21 : « Complexe Ryad · jeu. 22, 21:00 → 22:30. » + « C'est moi » / « Ce n'est pas moi » tant que la demande attend ; répondue, il ne reste que le texte.
      const claim = n.refId === undefined ? null : (lk.claim?.(n.refId) ?? null);
      return { title: t(labels.title), line: claim === null ? null : `${claim.venue.name} · ${claimSlotLabel(claim)}.`, cta: claim === null ? null : 'claim' };
    }
    case 'MATCH_ALERT':
      return { title: t(labels.title), line: start === undefined ? null : `${whenPart(venue, start, lk, ' · ')}.`, cta: null };
    case 'MATCH_CANCELLED': {
      if (actor !== undefined && start !== undefined) {
        const day = lowerFirst(relativeDayLabel(start, lk.now, lk.t));
        return {
          title: t('Match annulé'),
          line: venue === null
            ? fill(t('{nom} a annulé le match de {jour}.'), { nom: actor, jour: day })
            : fill(t('{nom} a annulé le match de {jour} à {centre}.'), { nom: actor, jour: day, centre: venue }),
          cta: null,
        };
      }
      return { title: t('Match annulé'), line: t(labels.body), cta: null };
    }
    case 'BOOKING_CONFIRMED': {
      const b = n.refId === undefined ? null : lk.booking(n.refId);
      return {
        title: t(labels.title),
        line: b === null ? t(labels.body) : `${b.venueName === null ? '' : `${b.venueName} · `}${lowerFirst(relativeDayLabel(b.start, lk.now, lk.t))}, ${clock(b.start)} → ${clock(b.end)}.`,
        cta: null,
      };
    }
    default:
      return { title: t(labels.title), line: venue !== null ? `${venue}.` : t(labels.body), cta: null };
  }
}

/** Où mène un tap (règle 39). `null` : rien à ouvrir, la notification se marque lue et reste sur place. */
export function notificationRoute(n: Notification, lk: Pick<NotificationLookups, 'findMatch' | 'myId' | 'booking'>, teamsEnabled: boolean): Route | null {
  if (!isKnownNotificationType(n.type)) return null;
  const type: NotificationType = n.type;
  if (type === 'TEAM_INVITED') return teamsEnabled ? { name: 'teams' } : null;
  if (type.startsWith('CHALLENGE_')) return n.refId !== undefined ? { name: 'challenges', challengeId: n.refId } : { name: 'challenges' };
  // Une réservation confirmée ouvre « Ta réservation » ; si elle n'est plus dans l'app, Mes matchs.
  if (type === 'BOOKING_CONFIRMED') {
    return n.refId !== undefined && lk.booking(n.refId) !== null ? { name: 'booking', viewReservationId: n.refId } : { name: 'tab', tab: 'matches' };
  }
  // Règle 21 : « C'est bien toi ? » → Mes matchs, où la carte attend aussi la réponse.
  if (type === 'BOOKING_CLAIM') return { name: 'tab', tab: 'matches' };
  if (type === 'BOOKING_CANCELLED_BY_CENTER') return { name: 'tab', tab: 'matches', matchesTab: 'passes' };
  // Un match annulé n'a plus de page utile : Mes matchs › Passés, où il apparaît « Annulé ».
  if (type === 'MATCH_CANCELLED' || type === 'MATCH_CANCELLED_BY_CENTER' || type === 'PLAYER_REMOVED') return { name: 'tab', tab: 'matches', matchesTab: 'passes' };
  if (n.refId === undefined) return { name: 'tab', tab: 'matches' };
  const entry = lk.findMatch(n.refId);
  // Quelqu'un a rejoint / s'est désinscrit / « ton match se remplit » : la vue organisateur de MON match, jamais le détail « rejoindre ».
  if (entry !== undefined && entry.match.organizerId === lk.myId) return { name: 'match', mode: 'organizer', matchId: n.refId };
  return { name: 'match', mode: 'detail', matchId: n.refId };
}

/** « il y a 5 min » / « il y a 2 h » / « hier » / « il y a 3 j ». Minutes et heures : les gabarits des maquettes (« il y a {n} min », « il y a {n} h ») ;
    au-delà, et « à l'instant », Intl de la langue active (jamais un mot arabe retapé à la main — même principe que `relativeDayLabel`). */
export function timeAgoLabel(createdAt: number, now: number, t: (key: string) => string, lang: 'fr' | 'ar'): string {
  const mins = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (mins < 60) {
    if (mins < 1) return lang === 'fr' ? 'à l’instant' : new Intl.RelativeTimeFormat('ar-DZ', { numeric: 'auto' }).format(0, 'second');
    return fill(t('il y a {n} min'), { n: String(mins) });
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fill(t('il y a {n} h'), { n: String(hours) });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('hier');
  return lang === 'fr' ? `il y a ${days} j` : new Intl.RelativeTimeFormat('ar-DZ', { numeric: 'auto', style: 'short' }).format(-days, 'day');
}
