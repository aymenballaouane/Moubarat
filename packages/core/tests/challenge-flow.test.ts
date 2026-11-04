import { describe, expect, it } from 'vitest';
import {
  newChallenge, rejectChallenge, cancelChallenge, expireChallenges, challengeInbox,
  timeLeftLabel, acceptChallenge, challengeMatchTitle, range, bookingTotal, perHour,
  type Booking, type Challenge, type TeamMember,
} from '../src/index.js';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const H = 3_600_000;
const members: TeamMember[] = [
  { teamId: 'A', userId: 'aymen', role: 'CAPTAIN', status: 'ACTIVE', joinedAt: NOW },
  { teamId: 'B', userId: 'sidali', role: 'CAPTAIN', status: 'ACTIVE', joinedAt: NOW },
  { teamId: 'B', userId: 'p1', role: 'PLAYER', status: 'ACTIVE', joinedAt: NOW },
];
const base = () => newChallenge({
  id: 'c1', fromTeamId: 'A', toTeamId: 'B', sport: 'FOOTBALL', format: '5v5',
  proposedRange: range(NOW + 72 * H, 90), stakeKind: 'CLASSEMENT', createdAt: NOW,
});

describe('fermeture du cycle', () => {
  it('refus : capitaine défié uniquement, statut REJECTED, aucun match', () => {
    const r = rejectChallenge(base(), 'sidali', members, NOW + H);
    expect(r.result.ok).toBe(true);
    expect(r.challenge!.status).toBe('REJECTED');
    expect(r.challenge!.matchId).toBeUndefined();
    expect(rejectChallenge(base(), 'p1', members, NOW + H).result.ok).toBe(false);
    expect(rejectChallenge(base(), 'aymen', members, NOW + H).result.ok).toBe(false);
  });
  it('annulation : émetteur uniquement, et seulement en attente', () => {
    expect(cancelChallenge(base(), 'aymen', members).challenge!.status).toBe('CANCELLED');
    expect(cancelChallenge(base(), 'sidali', members).result.ok).toBe(false);
    const done = { ...base(), status: 'ACCEPTED' as const };
    expect(cancelChallenge(done, 'aymen', members).result.ok).toBe(false);
  });
  it('balayage : seuls les PENDING dépassés expirent, et on sait qui prévenir', () => {
    const fresh = base();
    const old = { ...base(), id: 'c2', createdAt: NOW - 50 * H, expiresAt: NOW - 2 * H };
    const done = { ...base(), id: 'c3', status: 'ACCEPTED' as const, expiresAt: NOW - 2 * H };
    const { challenges, expiredIds } = expireChallenges([fresh, old, done], NOW);
    expect(expiredIds).toEqual(['c2']);
    expect(challenges.find((c) => c.id === 'c2')!.status).toBe('EXPIRED');
    expect(challenges.find((c) => c.id === 'c1')!.status).toBe('PENDING');
    expect(challenges.find((c) => c.id === 'c3')!.status).toBe('ACCEPTED');
  });
  it('boîte Reçus / Envoyés par équipe, du plus récent au plus ancien', () => {
    const a = base();
    const b = { ...base(), id: 'c2', fromTeamId: 'B', toTeamId: 'A', createdAt: NOW + H };
    const box = challengeInbox([a, b], 'A');
    expect(box.sent.map((c) => c.id)).toEqual(['c1']);
    expect(box.received.map((c) => c.id)).toEqual(['c2']);
  });
  it('compte à rebours : heures, minutes, expiré', () => {
    const c = base();
    expect(timeLeftLabel(c, NOW + H)).toBe('Expire dans 47 h');
    expect(timeLeftLabel(c, c.expiresAt - 35 * 60_000)).toBe('Expire dans 35 min');
    expect(timeLeftLabel(c, c.expiresAt + 1)).toBe('Expiré');
    expect(timeLeftLabel({ ...c, status: 'REJECTED' }, NOW)).toBe('Expiré');
  });
  it('acceptation (rappel Phase 2) : le match créé référence le défi, et inversement', () => {
    const b = base();
    const booking: Booking = {
      id: 'b-defi', fieldId: 't1', range: b.proposedRange, status: 'RESERVED',
      source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'sidali',
      priceTotal: bookingTotal(perHour(3000), 90), createdAt: NOW,
    };
    const { challenge, match } = acceptChallenge(b, 'm-defi', booking, challengeMatchTitle('FC Kahwa', 'Panthers Alger'), NOW + H);
    expect(challenge.matchId).toBe('m-defi');
    expect(match.challengeId).toBe('c1');
    expect(match.visibility).toBe('PRIVATE');
    expect(match.bookingId).toBe('b-defi');
    expect(match.pricePerPlayer.amount).toBe(450);
    expect(match.title).toBe('FC Kahwa vs Panthers Alger');
  });
});
