import { activePlayers, type Booking, type Match, type MatchFormat, type MatchPlayer, type MatchTeam, type Sport } from '@moubarat/core';
import { canCreateMatchOn } from './reservationView.js';
import { fieldFormatList } from './venueView.js';

/* Mes matchs (Lot 8, MesMatchs.dc.html) — ce que le joueur a de PRÉVU (ses matchs, ses réservations sans match) et ce qui est PASSÉ (joués, annulés), en listes
   prêtes à afficher. Fonctions pures (tests/mesMatchs.test.ts) : aucune règle métier ici — « peut-on créer un match sur cette réservation » est `canCreateMatchOn`
   (core), « un match est à moi » = organisateur ou inscrit, calculés par l'appelant. Le prix n'apparaît JAMAIS sur une réservation (lot 8), seulement sur un match
   où l'on joue ; un match est nommé par son centre (règle 41). */

export interface MatchEntry { match: Match; players: MatchPlayer[] }
export interface ResaEntry { booking: Booking; format?: MatchFormat | undefined; reference?: string | undefined }

export interface MesMatchsContext {
  meId: string;
  now: number;
  venueName: (venueId: string) => string;
  fieldInfo: (fieldId: string) => { venueName: string; field: { name: string; sport: string; formats?: unknown } } | undefined;
  /** Nom d'un joueur (l'organisateur d'un match annulé) — `undefined` quand il n'est pas connu. */
  nameOf: (userId: string) => string | undefined;
}

export type UpcomingKind = 'resa' | 'orga' | 'joue';

export interface UpcomingCard {
  id: string;
  kind: UpcomingKind;
  startMs: number;
  sport: Sport;
  format: MatchFormat;
  venueName: string;
  fieldName: string | null;
  /** Réservation : « Créer un match dessus » (possible) ou « Voir ta réservation » (sinon). */
  canCreate: boolean;
  /** Réservation téléphonique que le centre n'a pas encore confirmée. */
  pending: boolean;
  /** Match où je joue : mon équipe (null si le serveur ne l'a pas encore dite). */
  team: MatchTeam | null;
  /** Match que j'organise : places restantes. */
  left: number;
  /** Match où je joue : prix par joueur (jamais pour une réservation). */
  priceDa: number;
  matchId?: string;
  bookingId?: string;
  /** Un match que j'organise s'ouvre sur la vue organisateur. */
  mine: boolean;
}

function myTeamIn(m: MatchEntry, meId: string): MatchTeam | null {
  return activePlayers(m.players).find((p) => p.userId === meId)?.team ?? null;
}

/** « À venir » : mes matchs à venir (organisés ou rejoints) et mes réservations à venir SANS match vivant, la plus proche d'abord. */
export function buildUpcoming(matches: readonly MatchEntry[], reservations: readonly ResaEntry[], ctx: MesMatchsContext): UpcomingCard[] {
  const liveMatchIds = new Set(matches.map((e) => e.match.id));
  const cards: UpcomingCard[] = [];
  for (const e of matches) {
    const m = e.match;
    const mine = m.organizerId === ctx.meId;
    cards.push({
      id: `m:${m.id}`, kind: mine ? 'orga' : 'joue', startMs: m.range.start, sport: m.sport, format: m.format,
      venueName: ctx.venueName(m.venueId), fieldName: ctx.fieldInfo(m.fieldId)?.field.name ?? null,
      canCreate: false, pending: false, team: myTeamIn(e, ctx.meId), left: Math.max(0, m.capacity - activePlayers(e.players).length),
      priceDa: m.pricePerPlayer.amount, matchId: m.id, mine,
    });
  }
  for (const r of reservations) {
    const b = r.booking;
    if (b.status !== 'RESERVED' || b.range.start <= ctx.now) continue;
    if (b.matchId !== undefined && liveMatchIds.has(b.matchId)) continue;      // la carte du match suffit
    const info = ctx.fieldInfo(b.fieldId);
    const formats = fieldFormatList(info?.field.formats as never);
    cards.push({
      id: `b:${b.id}`, kind: 'resa', startMs: b.range.start, sport: (info?.field.sport ?? 'FOOTBALL') as Sport,
      format: (r.format ?? formats[0] ?? '5v5') as MatchFormat, venueName: info?.venueName ?? 'Centre', fieldName: info?.field.name ?? null,
      canCreate: canCreateMatchOn(b, ctx.now), pending: b.source === 'PHONE' && !b.verifiedByCenter, team: null, left: 0, priceDa: 0,
      bookingId: b.id, mine: false,
    });
  }
  return cards.sort((a, b) => a.startMs - b.startMs);
}

export type PastState = 'played' | 'cancelled';
export type PastRole =
  | { kind: 'organized' }
  | { kind: 'team'; team: MatchTeam | null }
  | { kind: 'cancelledBy'; name: string }
  | { kind: 'none' };

export interface PastRow {
  id: string;
  startMs: number;
  sport: Sport;
  format: MatchFormat;
  venueName: string;
  state: PastState;
  role: PastRole;
  matchId?: string;
}

/** « Passés » : mes matchs joués ou annulés, et mes réservations passées (honorées) ou annulées sans match — la plus récente d'abord. Une réservation « no-show » n'est
    jamais affichée comme annulée (ce serait faux) ni comme jouée : elle n'apparaît pas ici. */
export function buildPast(matches: readonly MatchEntry[], reservations: readonly ResaEntry[], ctx: MesMatchsContext): PastRow[] {
  const rows: PastRow[] = [];
  const seenMatchIds = new Set<string>();
  for (const e of matches) {
    const m = e.match;
    if (m.status !== 'PLAYED' && m.status !== 'CANCELLED') continue;
    seenMatchIds.add(m.id);
    const mine = m.organizerId === ctx.meId;
    const state: PastState = m.status === 'PLAYED' ? 'played' : 'cancelled';
    const name = ctx.nameOf(m.organizerId);
    const role: PastRole = state === 'cancelled'
      ? (!mine && name ? { kind: 'cancelledBy', name } : { kind: 'none' })
      : mine ? { kind: 'organized' } : { kind: 'team', team: myTeamIn(e, ctx.meId) };
    rows.push({ id: `m:${m.id}`, startMs: m.range.start, sport: m.sport, format: m.format, venueName: ctx.venueName(m.venueId), state, role, matchId: m.id });
  }
  for (const r of reservations) {
    const b = r.booking;
    if (b.matchId !== undefined && seenMatchIds.has(b.matchId)) continue;      // la ligne du match suffit
    const honored = (b.status === 'HONORED' || b.status === 'PAID') && b.range.start <= ctx.now;
    const cancelled = b.status === 'CANCELLED';
    if (!honored && !cancelled) continue;
    const info = ctx.fieldInfo(b.fieldId);
    const formats = fieldFormatList(info?.field.formats as never);
    rows.push({
      id: `b:${b.id}`, startMs: b.range.start, sport: (info?.field.sport ?? 'FOOTBALL') as Sport, format: (r.format ?? formats[0] ?? '5v5') as MatchFormat,
      venueName: info?.venueName ?? 'Centre', state: cancelled ? 'cancelled' : 'played', role: { kind: 'none' },
    });
  }
  return rows.sort((a, b) => b.startMs - a.startMs);
}

/** « OCT. » / « أكتوبر » et « 09 » : le bloc date d'une ligne passée (chiffres occidentaux en arabe aussi). */
export function pastDateParts(startMs: number, lang: 'fr' | 'ar'): { month: string; day: string } {
  const d = new Date(startMs);
  const month = d.toLocaleDateString(lang === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-FR', { month: 'short' });
  return { month: lang === 'ar' ? month : month.toUpperCase(), day: String(d.getDate()).padStart(2, '0') };
}
