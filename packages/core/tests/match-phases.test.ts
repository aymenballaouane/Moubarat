import { describe, expect, it } from 'vitest';
import {
  CANCEL_FREE_BEFORE_MS, MATCH_LOCK_BEFORE_MS, MATCH_OPEN_MIN_BEFORE_MS, activePlayers, canChangeTeam, canJoinMatch, canLeaveMatch,
  canChangeVisibility, isLockedNow, joinMatch, perPlayer, leaveMatch, matchLeaveKind, registrationPhase, type Match, type MatchPlayer,
} from '../src/index.js';

/* Règle 4 (MODIFIÉE — décisions d'Aymen du 26/10/2026 puis du 16/11/2026) : trois temps. Désistement libre jusqu'à H-2 ; de H-2 au coup
   d'envoi partir compte comme une demi-absence et la place est reproposée (inscriptions de remplacement ouvertes) ; au coup d'envoi tout se ferme.
   Changement d'équipe jusqu'au coup d'envoi. Le 16/11/2026, la « composition figée une heure avant le match » (H-1) a été abandonnée : les
   assertions qui l'affirmaient sont INVERSÉES ci-dessous (GO explicite d'Aymen), et chaque test vérifie aussi la fermeture au coup d'envoi. */

const H = 3_600_000;
const START = Date.parse('2026-11-03T21:00:00Z');
const match: Match = {
  id: 'm1', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Match', venueId: 'v', fieldId: 'f',
  range: { start: START, end: START + 1.5 * H }, capacity: 10, pricePerPlayer: perPlayer(600),
  visibility: 'OPEN', status: 'OPEN', organizerId: 'orga', coordination: { kind: 'IN_APP' }, createdAt: 0,
};
const crew = (n: number): MatchPlayer[] => Array.from({ length: n }, (_, i) => ({
  matchId: 'm1', userId: i === 0 ? 'orga' : `p${i}`, status: 'JOINED' as const, joinedAt: i, team: i % 2 === 0 ? 'A' as const : 'B' as const,
}));
const at = (before: number) => START - before;

describe('règle 4 — les trois temps', () => {
  it('les seuils : H-2 pour le désistement libre, le coup d’envoi pour le verrou (plus de H-1), 2 h pour ouvrir un match', () => {
    expect(CANCEL_FREE_BEFORE_MS).toBe(2 * H);
    expect(MATCH_LOCK_BEFORE_MS).toBe(0);
    expect(MATCH_OPEN_MIN_BEFORE_MS).toBe(2 * H);
  });

  it('registrationPhase : FREE avant H-2, REPLACEMENT de H-2 au coup d’envoi (H-1 compris), FROZEN à partir du coup d’envoi', () => {
    expect(registrationPhase(match, at(5 * H))).toBe('FREE');
    expect(registrationPhase(match, at(2 * H + 1))).toBe('FREE');
    expect(registrationPhase(match, at(2 * H))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(1.5 * H))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(H))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(10 * 60_000))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(1))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(0))).toBe('FROZEN');
    expect(registrationPhase(match, START + 10 * 60_000)).toBe('FROZEN');
    expect(isLockedNow(match, at(H))).toBe(false);
    expect(isLockedNow(match, at(1))).toBe(false);
    expect(isLockedNow(match, at(0))).toBe(true);
  });

  it('désistement : libre avant H-2 (EARLY), possible de H-2 au coup d’envoi mais LATE = demi-absence, refusé à partir du coup d’envoi', () => {
    const players = crew(7);
    expect(canLeaveMatch(match, players, 'p1', at(3 * H)).ok).toBe(true);
    expect(matchLeaveKind(match, at(3 * H))).toBe('EARLY');
    expect(canLeaveMatch(match, players, 'p1', at(1.5 * H)).ok).toBe(true);
    expect(matchLeaveKind(match, at(1.5 * H))).toBe('LATE');
    expect(matchLeaveKind(match, at(2 * H))).toBe('LATE');
    expect(matchLeaveKind(match, at(2 * H + 1))).toBe('EARLY');
    expect(canLeaveMatch(match, players, 'p1', at(H)).ok).toBe(true);
    expect(canLeaveMatch(match, players, 'p1', at(10 * 60_000)).ok).toBe(true);
    expect(matchLeaveKind(match, at(10 * 60_000))).toBe('LATE');
    const started = canLeaveMatch(match, players, 'p1', at(0));
    expect(!started.ok && started.code).toBe('CANCEL_WINDOW_PASSED');
    const left = leaveMatch(match, players, 'p1', at(1.5 * H));
    expect(left.result.ok).toBe(true);
    expect(activePlayers(left.players!)).toHaveLength(6);
  });

  it('une place libérée dans la fenêtre de remplacement est reproposée : un match complet repasse OPEN et un autre joueur peut la prendre jusqu’au coup d’envoi', () => {
    const full: Match = { ...match, status: 'FULL' };
    const afterLeave = leaveMatch(full, crew(10), 'p1', at(1.5 * H));
    expect(afterLeave.status).toBe('OPEN');
    expect(canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(1.5 * H)).ok).toBe(true);
    expect(canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(H)).ok).toBe(true);
    expect(canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(50 * 60_000)).ok).toBe(true);
    const taken = joinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(10 * 60_000));
    expect(taken.result.ok).toBe(true);
    expect(taken.status).toBe('FULL');
    const closed = canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(0));
    expect(!closed.ok && closed.code).toBe('MATCH_LOCKED');
    expect(!closed.ok && closed.message).toContain('commencé');
  });

  it('changement d’équipe : encore possible de H-2 au coup d’envoi (règle 3), H-1 compris, fermé à partir du coup d’envoi', () => {
    const players = crew(6);   // A: 3 (orga, p2, p4), B: 3 (p1, p3, p5)
    expect(canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(1.5 * H)).ok).toBe(true);
    expect(canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(H)).ok).toBe(true);
    expect(canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(1)).ok).toBe(true);
    const started = canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(0));
    expect(!started.ok && started.code).toBe('MATCH_LOCKED');
  });
});

/* Lot « Match libre » (16/11/2026) : l'organisateur passe son match en privé (ou le rend public) après publication. */
describe('visibilité après publication — canChangeVisibility', () => {
  it('l’organisateur seul, avant le coup d’envoi, sur un match vivant, et seulement vers l’autre visibilité', () => {
    expect(canChangeVisibility(match, 'orga', 'PRIVATE', at(30 * 60_000)).ok).toBe(true);
    expect(canChangeVisibility({ ...match, visibility: 'PRIVATE' }, 'orga', 'OPEN', at(3 * H)).ok).toBe(true);
    expect(canChangeVisibility({ ...match, status: 'FULL' }, 'orga', 'PRIVATE', at(3 * H)).ok).toBe(true);
    const stranger = canChangeVisibility(match, 'p1', 'PRIVATE', at(3 * H));
    expect(!stranger.ok && stranger.code).toBe('NOT_ORGANIZER');
    const same = canChangeVisibility(match, 'orga', 'OPEN', at(3 * H));
    expect(!same.ok && same.code).toBe('SAME_VISIBILITY');
    const started = canChangeVisibility(match, 'orga', 'PRIVATE', at(0));
    expect(!started.ok && started.code).toBe('MATCH_LOCKED');
    const cancelled = canChangeVisibility({ ...match, status: 'CANCELLED' }, 'orga', 'PRIVATE', at(3 * H));
    expect(!cancelled.ok && cancelled.code).toBe('MATCH_CANCELLED');
    const played = canChangeVisibility({ ...match, status: 'PLAYED' }, 'orga', 'PRIVATE', at(3 * H));
    expect(!played.ok && played.code).toBe('MATCH_PLAYED');
  });
});
