import { describe, expect, it } from 'vitest';
import {
  createMatch, joinMatch, leaveMatch, changeTeam, canChangeTeam, canJoinTeam, defaultTeam, teamCapacity, teamCounts, teamFreePlaces,
  perHour, bookingTotal,
  type Booking, type Field, type Match, type MatchPlayer, type MatchTeam,
} from '../src/index.js';

/* Règle 3 (refonte app joueur, 26/10/2026 — règle NOUVELLE) : on choisit son équipe (sa paire au padel), pas son poste ;
   changement d'équipe possible tant que les inscriptions sont ouvertes. Fonctions additives : aucun test existant touché. */

const NOW = Date.parse('2026-08-21T12:00:00Z');
const H = 3_600_000;
const field: Pick<Field, 'id' | 'sport' | 'formats'> = { id: 'f1', sport: 'FOOTBALL', formats: ['5v5'] };
const booking: Booking = {
  id: 'b1', fieldId: 'f1', range: { start: NOW + 8 * H, end: NOW + 9.5 * H },
  status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'org',
  priceTotal: bookingTotal(perHour(3000), 90), createdAt: NOW,
};
const created = createMatch({
  id: 'm1', booking, field, venueId: 'v1', title: 'Green Arena', format: '5v5', level: 'LOISIR', organizerId: 'org', now: NOW,
}) as { match: Match; organizerEntry: MatchPlayer };
const match = created.match;   // capacité 10 → 5 par équipe

function withTeam(n: number, team: MatchTeam, from = 0): MatchPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ matchId: 'm1', userId: `${team}${from + i}`, status: 'JOINED' as const, joinedAt: NOW, team }));
}

describe('règle 3 — équipes', () => {
  it('l’organisateur ouvre l’équipe A ; chaque équipe a la moitié de la capacité', () => {
    expect(created.organizerEntry.team).toBe('A');
    expect(teamCapacity(match)).toBe(5);
    expect(teamCapacity({ capacity: 4 })).toBe(2);   // padel
  });

  it('teamCounts / teamFreePlaces : seuls les inscrits actifs comptent, un inscrit sans équipe n’est dans aucune', () => {
    const players: MatchPlayer[] = [
      created.organizerEntry, ...withTeam(2, 'B'),
      { matchId: 'm1', userId: 'left', status: 'LEFT', joinedAt: NOW, team: 'B' },
      { matchId: 'm1', userId: 'old', status: 'JOINED', joinedAt: NOW },
    ];
    expect(teamCounts(players)).toEqual({ A: 1, B: 2 });
    expect(teamFreePlaces(match, players, 'A')).toBe(4);
    expect(teamFreePlaces(match, players, 'B')).toBe(3);
  });

  it('defaultTeam : l’équipe qui a le plus de places (A à égalité), null si aucune', () => {
    expect(defaultTeam(match, [created.organizerEntry])).toBe('B');            // A: 4 libres, B: 5
    expect(defaultTeam(match, [])).toBe('A');                                  // égalité → A
    expect(defaultTeam(match, [...withTeam(5, 'A'), ...withTeam(5, 'B')])).toBeNull();
  });

  it('joinMatch avec équipe : enregistre l’équipe ; équipe complète → MATCH_TEAM_FULL, l’autre reste ouverte', () => {
    const full = [...withTeam(5, 'A')];
    const refused = joinMatch(match, full, 'nouveau', [], NOW, 'A');
    expect(refused.result.ok).toBe(false);
    expect(!refused.result.ok && refused.result.code).toBe('MATCH_TEAM_FULL');
    const okRes = joinMatch(match, full, 'nouveau', [], NOW, 'B');
    expect(okRes.result.ok).toBe(true);
    expect(okRes.players!.find((p) => p.userId === 'nouveau')!.team).toBe('B');
  });

  it('joinMatch sans équipe : comportement d’avant la règle (aucune équipe enregistrée)', () => {
    const res = joinMatch(match, [created.organizerEntry], 'nouveau', [], NOW);
    expect(res.result.ok).toBe(true);
    expect('team' in res.players!.find((p) => p.userId === 'nouveau')!).toBe(false);
  });

  it('les règles existantes passent avant le choix d’équipe (déjà inscrit, retiré, complet…)', () => {
    const joined = joinMatch(match, [created.organizerEntry], 'x', [], NOW, 'B').players!;
    const again = joinMatch(match, joined, 'x', [], NOW, 'B');
    expect(!again.result.ok && again.result.code).toBe('ALREADY_JOINED');
    const removed: MatchPlayer[] = [{ matchId: 'm1', userId: 'r', status: 'REMOVED', joinedAt: NOW, team: 'B' }];
    const refused = joinMatch(match, removed, 'r', [], NOW, 'B');
    expect(!refused.result.ok && refused.result.code).toBe('FORBIDDEN');
  });

  it('changeTeam : passe dans l’autre équipe s’il y reste une place', () => {
    const players = [created.organizerEntry, ...withTeam(2, 'B')];
    const res = changeTeam(match, players, 'B0', 'A', NOW);
    expect(res.result.ok).toBe(true);
    expect(teamCounts(res.players!)).toEqual({ A: 2, B: 1 });
  });

  it('changeTeam refusé : même équipe, équipe complète, pas inscrit, inscriptions fermées, match annulé', () => {
    const full = [...withTeam(5, 'A'), ...withTeam(2, 'B')];
    const same = canChangeTeam(match, full, 'B0', 'B', NOW);
    expect(!same.ok && same.code).toBe('SAME_TEAM');
    const teamFull = canChangeTeam(match, full, 'B0', 'A', NOW);
    expect(!teamFull.ok && teamFull.code).toBe('MATCH_TEAM_FULL');
    const stranger = canChangeTeam(match, full, 'inconnu', 'A', NOW);
    expect(!stranger.ok && stranger.code).toBe('NOT_JOINED');
    const locked = canChangeTeam(match, [created.organizerEntry, ...withTeam(1, 'B')], 'B0', 'A', match.range.start - 0.5 * H);   // règle 3 : jusqu'à H-1 (trois temps, règle 4 modifiée)
    expect(!locked.ok && locked.code).toBe('MATCH_LOCKED');
    const cancelled = canChangeTeam({ ...match, status: 'CANCELLED' }, [created.organizerEntry, ...withTeam(1, 'B')], 'B0', 'A', NOW);
    expect(!cancelled.ok && cancelled.code).toBe('MATCH_CANCELLED');
  });

  it('canJoinTeam seul : une équipe pleine refuse, une équipe avec de la place accepte', () => {
    expect(canJoinTeam(match, withTeam(5, 'B'), 'B').ok).toBe(false);
    expect(canJoinTeam(match, withTeam(4, 'B'), 'B').ok).toBe(true);
  });

  it('quitter libère la place de son équipe', () => {
    const players = [created.organizerEntry, ...withTeam(1, 'B')];
    const left = leaveMatch(match, players, 'B0', NOW);
    expect(left.result.ok).toBe(true);
    expect(teamCounts(left.players!)).toEqual({ A: 1, B: 0 });
  });
});
