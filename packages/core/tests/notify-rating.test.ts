import { describe, expect, it } from 'vitest';
import {
  notify, RECIPIENTS, reminderDueAt, unreadCount, markRead, NOTIFICATION_LABELS,
  canRate, applyRating, ratingSummary, submitResult, confirmResult, disputeResult,
  sweepAutoConfirm, outcomeFor, winRateFrom, computeOvr,
  RATING_WINDOW_MS, PLAYER_RATING_MIN_COUNT, VENUE_RATING_MIN_COUNT,
  type Match, type MatchPlayer, type MatchResult, type Notification, type NotificationType, type Rating,
} from '../src/index.js';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const H = 3_600_000;

/* --------------------------------------------------------------- Phase 9 */
describe('notifications', () => {
  it('événement → destinataires : annulation à tous sauf l’annuleur, défi au capitaine', () => {
    const cancel = notify(RECIPIENTS.matchCancelled(['a', 'b', 'c'], 'a'), 'MATCH_CANCELLED', 'm1', NOW);
    expect(cancel.map((n) => n.userId)).toEqual(['b', 'c']);
    expect(RECIPIENTS.challengeReceived('sidali')).toEqual(['sidali']);
    expect(reminderDueAt(NOW + 8 * H)).toBe(NOW + 5 * H); // H-3 (règle 12 modifiée) — une heure avant la fin du désistement libre
  });
  it('rappel H-3 à cheval sur minuit : un match à 00:30 se rappelle à 21:30 la veille (epoch pur, pas de jour calendaire)', () => {
    // Lot P1 (03/09/2026), point 6 — piège « changement de jour » explicitement
    // couvert : la fenêtre est une soustraction d'epochs, jamais une lecture
    // du jour calendaire du créneau.
    const start = Date.parse('2026-08-23T00:30:00Z');
    expect(reminderDueAt(start)).toBe(Date.parse('2026-08-22T21:30:00Z'));
    expect(RECIPIENTS.matchReminder(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('le compteur non lu est un COUNT réel ; marquer lu (un, ou tout)', () => {
    let ns: Notification[] = [
      ...notify(['u1'], 'PLAYER_JOINED', 'm1', NOW),
      ...notify(['u1'], 'CHALLENGE_RECEIVED', 'c1', NOW),
      ...notify(['u2'], 'PLAYER_JOINED', 'm1', NOW),
    ];
    expect(unreadCount(ns, 'u1')).toBe(2);
    ns = markRead(ns, 'u1', NOW + 1, [ns[0]!.id]);
    expect(unreadCount(ns, 'u1')).toBe(1);
    ns = markRead(ns, 'u1', NOW + 2);
    expect(unreadCount(ns, 'u1')).toBe(0);
    expect(unreadCount(ns, 'u2')).toBe(1);   // l'autre n'est pas touché
  });
  it('invitation d’équipe (25/09/2026) : TEAM_INVITED prévient l’invité seul, avec l’équipe pour référence, et a son libellé', () => {
    expect(RECIPIENTS.teamInvited('u-invite')).toEqual(['u-invite']);
    const [n] = notify(RECIPIENTS.teamInvited('u-invite'), 'TEAM_INVITED', 't1', NOW);
    expect(n).toMatchObject({ userId: 'u-invite', type: 'TEAM_INVITED', refId: 't1' });
    expect(unreadCount([n!], 'u-invite')).toBe(1);
    expect(NOTIFICATION_LABELS.TEAM_INVITED.title).toBe('Tu es invité dans une équipe');
    expect(NOTIFICATION_LABELS.TEAM_INVITED.body.length).toBeGreaterThan(3);
    // chaque type du core — y compris celui-ci — a un libellé : le Record<NotificationType, …> l'impose à la compilation
    const every: NotificationType[] = Object.keys(NOTIFICATION_LABELS) as NotificationType[];
    expect(every).toContain('TEAM_INVITED');
    expect(every).toHaveLength(20); // 13 + les deux types « annulé par le centre » (26/09/2026) + PLAYER_REMOVED (27/09/2026) + SPOT_FREED, MATCH_FILLING, MATCH_ALERT (Lot 11, 26/10/2026)
  });
  it('retrait par l’organisateur (BUG-5, 27/09/2026) : le joueur retiré, et lui seul, avec un libellé qui dit qu’il ne revient pas', () => {
    expect(RECIPIENTS.playerRemoved('u-out')).toEqual(['u-out']);
    const [n] = notify(RECIPIENTS.playerRemoved('u-out'), 'PLAYER_REMOVED', 'm1', NOW);
    expect(n).toMatchObject({ userId: 'u-out', type: 'PLAYER_REMOVED', refId: 'm1' });
    expect(NOTIFICATION_LABELS.PLAYER_REMOVED.title.length).toBeGreaterThan(3);
    expect(NOTIFICATION_LABELS.PLAYER_REMOVED.body).toContain('ne peux pas revenir');
  });
  it('annulation par le CENTRE (26/09/2026, BUG-1) : les inscrits SANS exception pour le match, le réservant pour la résa — libellés qui ne nomment jamais l’organisateur', () => {
    // Le centre n'est pas un joueur : personne n'est « l'annuleur » parmi les inscrits, l'organisateur est prévenu aussi.
    expect(RECIPIENTS.matchCancelledByCenter(['org', 'b', 'c'])).toEqual(['org', 'b', 'c']);
    expect(RECIPIENTS.bookingCancelledByCenter('booker')).toEqual(['booker']);
    const ns = notify(RECIPIENTS.matchCancelledByCenter(['org', 'b']), 'MATCH_CANCELLED_BY_CENTER', 'm1', NOW);
    expect(ns.map((n) => n.userId)).toEqual(['org', 'b']);
    expect(ns[0]).toMatchObject({ type: 'MATCH_CANCELLED_BY_CENTER', refId: 'm1' });
    const [b] = notify(RECIPIENTS.bookingCancelledByCenter('booker'), 'BOOKING_CANCELLED_BY_CENTER', 'bk1', NOW);
    expect(b).toMatchObject({ userId: 'booker', type: 'BOOKING_CANCELLED_BY_CENTER', refId: 'bk1' });
    // « L'organisateur a annulé » reste réservé à MATCH_CANCELLED (annulation par un joueur) : le libellé centre dit LE CENTRE.
    expect(NOTIFICATION_LABELS.MATCH_CANCELLED.body).toContain('organisateur');
    expect(NOTIFICATION_LABELS.MATCH_CANCELLED_BY_CENTER.body).not.toContain('organisateur');
    expect(NOTIFICATION_LABELS.MATCH_CANCELLED_BY_CENTER.title).toBe('Match annulé par le centre');
    expect(NOTIFICATION_LABELS.BOOKING_CANCELLED_BY_CENTER.title).toBe('Réservation annulée par le centre');
    for (const t of ['MATCH_CANCELLED_BY_CENTER', 'BOOKING_CANCELLED_BY_CENTER'] as const) {
      expect(NOTIFICATION_LABELS[t].body.length).toBeGreaterThan(3);
    }
  });
  it('chaque type a son libellé français', () => {
    const types: NotificationType[] = ['MATCH_REMINDER','PLAYER_JOINED','PLAYER_LEFT','MATCH_CANCELLED',
      'CHALLENGE_RECEIVED','CHALLENGE_ACCEPTED','CHALLENGE_REJECTED','CHALLENGE_EXPIRED',
      'BOOKING_CONFIRMED','EXTERNAL_BOOKING_TO_VERIFY','RESULT_TO_CONFIRM','RESULT_CONFIRMED'];
    for (const t of types) {
      expect(NOTIFICATION_LABELS[t].title.length).toBeGreaterThan(3);
      expect(NOTIFICATION_LABELS[t].body.length).toBeGreaterThan(3);
    }
  });
});

/* --------------------------------------------------------------- Phase 10 */
const match: Match = {
  id: 'm1', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Défi',
  venueId: 'v1', fieldId: 'f1', range: { start: NOW - 3 * H, end: NOW - 1.5 * H },
  capacity: 10, pricePerPlayer: { amount: 450, currency: 'DZD', unit: 'PER_PLAYER' },
  visibility: 'OPEN', status: 'PLAYED', organizerId: 'aymen',
  coordination: { kind: 'WHATSAPP' }, createdAt: NOW - 80 * H,
};
const players: MatchPlayer[] = ['aymen', 'karim', 'sidali'].map((u) => ({
  matchId: 'm1', userId: u, status: 'JOINED', joinedAt: NOW - 80 * H,
}));
const rate = (raterId: string, targetId: string, stars: Rating['stars'], targetType: Rating['targetType'] = 'PLAYER'): Rating =>
  ({ id: `r-${raterId}-${targetId}`, raterId, targetType, targetId, matchId: 'm1', stars, createdAt: NOW });

describe('notation', () => {
  it('R1–R3 : joué, inscrit, pas soi-même, cible du match, fenêtre 72 h', () => {
    expect(canRate({ match, players, raterId: 'karim', targetType: 'PLAYER', targetId: 'aymen', now: NOW }).ok).toBe(true);
    expect(canRate({ match, players, raterId: 'x', targetType: 'PLAYER', targetId: 'aymen', now: NOW }).ok).toBe(false);
    expect(canRate({ match, players, raterId: 'karim', targetType: 'PLAYER', targetId: 'karim', now: NOW }).ok).toBe(false);
    expect(canRate({ match, players, raterId: 'karim', targetType: 'PLAYER', targetId: 'inconnu', now: NOW }).ok).toBe(false);
    expect(canRate({ match, players, raterId: 'karim', targetType: 'VENUE', targetId: 'v2', now: NOW }).ok).toBe(false);
    const late = canRate({ match, players, raterId: 'karim', targetType: 'PLAYER', targetId: 'aymen',
      now: match.range.start + RATING_WINDOW_MS + 1 });
    expect(!late.ok && late.code).toBe('RATING_WINDOW_CLOSED');
    const notPlayed = canRate({ match: { ...match, status: 'OPEN' }, players, raterId: 'karim', targetType: 'PLAYER', targetId: 'aymen', now: NOW });
    expect(!notPlayed.ok && notPlayed.code).toBe('NOT_PLAYED');
  });
  it('R3 : dans la fenêtre, la nouvelle note remplace l’ancienne', () => {
    let rs = applyRating([], rate('karim', 'aymen', 4));
    rs = applyRating(rs, rate('karim', 'aymen', 5));
    expect(rs.length).toBe(1);
    expect(rs[0]!.stars).toBe(5);
  });
  it('R4 : agrégat seulement — joueur visible à 3 notes, terrain à 5 avis', () => {
    const two = [rate('a', 'p', 5), rate('b', 'p', 4)];
    expect(ratingSummary(two, 'PLAYER', 'p').visible).toBe(false);
    const three = [...two, rate('c', 'p', 3)];
    const s = ratingSummary(three, 'PLAYER', 'p');
    expect(s.visible).toBe(true);
    expect(s.avg).toBe(4);
    expect(PLAYER_RATING_MIN_COUNT).toBe(3);
    const venue4 = ['a','b','c','d'].map((u) => rate(u, 'v1', 5, 'VENUE'));
    expect(ratingSummary(venue4, 'VENUE', 'v1').visible).toBe(false);
    expect(ratingSummary([...venue4, rate('e', 'v1', 4, 'VENUE')], 'VENUE', 'v1').visible).toBe(true);
    expect(VENUE_RATING_MIN_COUNT).toBe(5);
  });
});

describe('résultats & OVR', () => {
  it('saisie organisateur, confirmation adverse, contestation, auto-validation 24 h', () => {
    const sub = submitResult({ match, reporterId: 'aymen', homeScore: 3, awayScore: 2, now: NOW });
    expect(sub.result.ok).toBe(true);
    expect(submitResult({ match, reporterId: 'karim', homeScore: 3, awayScore: 2, now: NOW }).result.ok).toBe(false);
    expect(submitResult({ match, reporterId: 'aymen', homeScore: -1, awayScore: 2, now: NOW }).result.ok).toBe(false);
    const r = sub.matchResult!;
    expect(confirmResult(r, 'sidali', NOW + H).matchResult!.status).toBe('CONFIRMED');
    expect(confirmResult(r, 'aymen', NOW + H).result.ok).toBe(false);
    expect(disputeResult(r, 'sidali').matchResult!.status).toBe('DISPUTED');
    const { results, confirmedIds } = sweepAutoConfirm([r, { ...r, matchId: 'm2', reportedAt: NOW - 25 * H }], NOW);
    expect(confirmedIds).toEqual(['m2']);
    expect(results.find((x) => x.matchId === 'm1')!.status).toBe('PENDING_CONFIRMATION');
  });
  it('R5 : le nul ne compte ni victoire ni défaite ; l’OVR sort de la formule', () => {
    const draw: MatchResult = { matchId: 'm3', homeScore: 2, awayScore: 2, reportedBy: 'a', reportedAt: NOW, status: 'CONFIRMED' };
    expect(outcomeFor(draw, 'HOME')).toBe('DRAW');
    expect(winRateFrom(['WIN', 'WIN', 'LOSS', 'DRAW'])).toBeCloseTo(2 / 3);
    expect(computeOvr({ ratedMatches: 5, avgRating: 4, winRate: 2 / 3, matchesPlayed: 12 }))
      .toBe(Math.min(99, Math.round(40 + (3 / 4) * 35 + (2 / 3) * 15 + (12 / 30) * 9)));
  });
});
