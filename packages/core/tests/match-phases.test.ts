import { describe, expect, it } from 'vitest';
import {
  CANCEL_FREE_BEFORE_MS, MATCH_LOCK_BEFORE_MS, MATCH_OPEN_MIN_BEFORE_MS, activePlayers, canChangeTeam, canJoinMatch, canLeaveMatch,
  isLockedNow, joinMatch, perPlayer, leaveMatch, matchLeaveKind, registrationPhase, type Match, type MatchPlayer,
} from '../src/index.js';

/* Règle 4 (MODIFIÉE — décision d'Aymen, 26/10/2026) : trois temps. Désistement libre jusqu'à H-2 ; de H-2 à H-1 partir compte comme une
   demi-absence et la place est reproposée (inscriptions de remplacement ouvertes) ; à H-1 la compo est figée. Changement d'équipe jusqu'à H-1. */

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
  it('les seuils : H-2 pour le désistement libre, H-1 pour le verrou, 2 h pour ouvrir un match', () => {
    expect(CANCEL_FREE_BEFORE_MS).toBe(2 * H);
    expect(MATCH_LOCK_BEFORE_MS).toBe(1 * H);
    expect(MATCH_OPEN_MIN_BEFORE_MS).toBe(2 * H);
  });

  it('registrationPhase : FREE avant H-2, REPLACEMENT de H-2 à H-1, FROZEN à partir de H-1', () => {
    expect(registrationPhase(match, at(5 * H))).toBe('FREE');
    expect(registrationPhase(match, at(2 * H + 1))).toBe('FREE');
    expect(registrationPhase(match, at(2 * H))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(1.5 * H))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(H + 1))).toBe('REPLACEMENT');
    expect(registrationPhase(match, at(H))).toBe('FROZEN');
    expect(registrationPhase(match, at(10 * 60_000))).toBe('FROZEN');
    expect(isLockedNow(match, at(H + 1))).toBe(false);
    expect(isLockedNow(match, at(H))).toBe(true);
  });

  it('désistement : libre avant H-2 (EARLY), possible de H-2 à H-1 mais LATE = demi-absence, refusé à partir de H-1', () => {
    const players = crew(7);
    expect(canLeaveMatch(match, players, 'p1', at(3 * H)).ok).toBe(true);
    expect(matchLeaveKind(match, at(3 * H))).toBe('EARLY');
    expect(canLeaveMatch(match, players, 'p1', at(1.5 * H)).ok).toBe(true);
    expect(matchLeaveKind(match, at(1.5 * H))).toBe('LATE');
    expect(matchLeaveKind(match, at(2 * H))).toBe('LATE');
    expect(matchLeaveKind(match, at(2 * H + 1))).toBe('EARLY');
    const frozen = canLeaveMatch(match, players, 'p1', at(H));
    expect(!frozen.ok && frozen.code).toBe('CANCEL_WINDOW_PASSED');
    const left = leaveMatch(match, players, 'p1', at(1.5 * H));
    expect(left.result.ok).toBe(true);
    expect(activePlayers(left.players!)).toHaveLength(6);
  });

  it('une place libérée dans la fenêtre de remplacement est reproposée : un match complet repasse OPEN et un autre joueur peut la prendre jusqu’à H-1', () => {
    const full: Match = { ...match, status: 'FULL' };
    const afterLeave = leaveMatch(full, crew(10), 'p1', at(1.5 * H));
    expect(afterLeave.status).toBe('OPEN');
    expect(canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(1.5 * H)).ok).toBe(true);
    const taken = joinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(1.5 * H));
    expect(taken.result.ok).toBe(true);
    expect(taken.status).toBe('FULL');
    const closed = canJoinMatch({ ...match, status: 'OPEN' }, afterLeave.players!, 'late-comer', [], at(H));
    expect(!closed.ok && closed.code).toBe('MATCH_LOCKED');
    expect(!closed.ok && closed.message).toContain('1 h');
  });

  it('changement d’équipe : encore possible de H-2 à H-1 (règle 3), figé à partir de H-1', () => {
    const players = crew(6);   // A: 3 (orga, p2, p4), B: 3 (p1, p3, p5)
    expect(canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(1.5 * H)).ok).toBe(true);
    const frozen = canChangeTeam(match, players.slice(0, 5), 'p1', 'A', at(H));
    expect(!frozen.ok && frozen.code).toBe('MATCH_LOCKED');
  });
});
