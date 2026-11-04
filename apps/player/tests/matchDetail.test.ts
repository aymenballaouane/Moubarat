import { describe, expect, it } from 'vitest';
import { perPlayer, type Match, type MatchPlayer, type MatchTeam } from '@moubarat/core';
import {
  freeCount, freeLeaveLimit, freeLeaveLimitLabel, initialOf, matchPhase, momentPhrase, myTeam, registrationLimit, registrationLimitLabel, registrationsOpen, teamViews,
} from '../src/lib/matchDetail.js';

const H = 3_600_000;
const NOW = new Date(2026, 9, 26, 12, 0).getTime();

function match(over: Partial<Match> = {}): Match {
  return {
    id: 'm1', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'Green Arena', venueId: 'v', fieldId: 'f',
    range: { start: NOW + 6 * H, end: NOW + 7.5 * H }, capacity: 10, pricePerPlayer: perPlayer(500), visibility: 'OPEN',
    status: 'OPEN', organizerId: 'org', coordination: { kind: 'WHATSAPP' }, createdAt: NOW, ...over,
  } as Match;
}
const p = (userId: string, team: MatchTeam | undefined, joinedAt = 1): MatchPlayer => ({
  matchId: 'm1', userId, status: 'JOINED', joinedAt, ...(team ? { team } : {}),
});
const nameOf = (id: string) => ({ org: 'Yanis', me: 'Aymen', a1: 'Farid', b1: 'Riad' } as Record<string, string>)[id] ?? 'Joueur';

describe('matchPhase', () => {
  it('normal avant H-2, figé à partir de H-2 (verrou du core), annulé, joué', () => {
    expect(matchPhase(match(), NOW)).toBe('normal');
    expect(matchPhase(match({ range: { start: NOW + 3 * H, end: NOW + 4 * H } }), NOW)).toBe('normal');
    expect(matchPhase(match({ range: { start: NOW + 1.5 * H, end: NOW + 3 * H } }), NOW)).toBe('remplacement');   // règle 4 : de H-2 à H-1
    expect(matchPhase(match({ range: { start: NOW + 0.5 * H, end: NOW + 2 * H } }), NOW)).toBe('fige');           // à partir de H-1
    expect(matchPhase(match({ status: 'LOCKED' }), NOW)).toBe('fige');
    expect(matchPhase(match({ status: 'CANCELLED' }), NOW)).toBe('cancelled');
    expect(matchPhase(match({ status: 'PLAYED' }), NOW)).toBe('played');
  });
});

describe('les trois temps (règle 4 modifiée) — états « Remplacement »', () => {
  const at = (hoursBefore: number) => match({ range: { start: NOW + hoursBefore * H, end: NOW + (hoursBefore + 1.5) * H } });
  it('normal > 2 h, remplacement entre 2 h et 1 h, figé ensuite — aux bornes', () => {
    expect(matchPhase(at(2.01), NOW)).toBe('normal');
    expect(matchPhase(at(2), NOW)).toBe('remplacement');
    expect(matchPhase(at(1.01), NOW)).toBe('remplacement');
    expect(matchPhase(at(1), NOW)).toBe('fige');
  });
  it('un match annulé ou joué garde sa phase, même dans la fenêtre de remplacement', () => {
    expect(matchPhase({ ...at(1.5), status: 'CANCELLED' }, NOW)).toBe('cancelled');
    expect(matchPhase({ ...at(1.5), status: 'PLAYED' }, NOW)).toBe('played');
    expect(matchPhase({ ...at(1.5), status: 'LOCKED' }, NOW)).toBe('fige');
  });
  it('les inscriptions sont ouvertes en normal et en remplacement, pas figé', () => {
    expect(registrationsOpen('normal')).toBe(true);
    expect(registrationsOpen('remplacement')).toBe(true);
    expect(registrationsOpen('fige')).toBe(false);
    expect(registrationsOpen('cancelled')).toBe(false);
    expect(registrationsOpen('played')).toBe(false);
  });
  it('limite des inscriptions : début − 1 h (H-1), distincte du désistement libre (H-2)', () => {
    const m = at(3);
    expect(registrationLimit(m)).toBe(m.range.start - H);
    expect(freeLeaveLimit(m)).toBe(m.range.start - 2 * H);
    expect(registrationLimitLabel(m, 'fr')).toMatch(/^\d\d:\d\d$/);
    expect(registrationLimitLabel(m, 'fr')).not.toBe(freeLeaveLimitLabel(m, 'fr'));
  });
});

describe('limite du désistement libre', () => {
  it('début − 2 h ; l’heure seule le même jour', () => {
    const m = match();
    expect(freeLeaveLimit(m)).toBe(m.range.start - 2 * H);
    expect(freeLeaveLimitLabel(m, 'fr')).toMatch(/^\d\d:\d\d$/);
  });
});

describe('teamViews', () => {
  it('toi d’abord, puis l’organisateur, puis les autres ; places libres = moitié de la capacité', () => {
    const players = [p('org', 'A', 1), p('a1', 'A', 2), p('me', 'A', 3), p('b1', 'B', 4)];
    const v = teamViews(match(), players, 'me', nameOf);
    expect(v.A.slots.map((s) => s.kind)).toEqual(['me', 'player', 'player', 'free', 'free']);
    expect(v.A.slots[1]).toMatchObject({ name: 'Yanis', organizer: true, initial: 'Y' });
    expect(v.A.taken).toBe(3);
    expect(v.B.slots.map((s) => s.kind)).toEqual(['player', 'free', 'free', 'free', 'free']);
    expect(freeCount(v.A)).toBe(2);
    expect(freeCount(v.B)).toBe(4);
    expect(myTeam(v)).toBe('A');
  });

  it('match complet : aucune place libre ; jamais plus de places libres que le match n’en a', () => {
    const full = [...Array.from({ length: 5 }, (_, i) => p(`a${i}`, 'A')), ...Array.from({ length: 5 }, (_, i) => p(`b${i}`, 'B'))];
    const v = teamViews(match(), full, 'zz', nameOf);
    expect(freeCount(v.A) + freeCount(v.B)).toBe(0);
    const oneLeft = full.slice(0, 9);
    const w = teamViews(match(), oneLeft, 'zz', nameOf);
    expect(freeCount(w.A) + freeCount(w.B)).toBe(1);
  });

  it('un inscrit sans équipe est rangé dans l’équipe la moins fournie (affichage seulement)', () => {
    const v = teamViews(match(), [p('org', 'A'), p('x', undefined, 2), p('y', undefined, 3)], 'zz', nameOf);
    expect(v.A.taken).toBe(2);
    expect(v.B.taken).toBe(1);
  });

  it('padel : deux paires de deux', () => {
    const v = teamViews(match({ sport: 'PADEL', format: 'DOUBLE', capacity: 4 }), [p('org', 'A')], 'zz', nameOf);
    expect(v.A.capacity).toBe(2);
    expect(freeCount(v.A)).toBe(1);
    expect(freeCount(v.B)).toBe(2);
  });

  it('un joueur sans équipe parmi les siens : toi n’est pas dans une équipe → myTeam null', () => {
    expect(myTeam(teamViews(match(), [p('org', 'A')], 'me', nameOf))).toBeNull();
  });
});

describe('libellés', () => {
  it('initialOf', () => {
    expect(initialOf('farid')).toBe('F');
    expect(initialOf('  ')).toBe('?');
  });
  it('momentPhrase : ce soir / aujourd’hui / demain / jour', () => {
    const t = (k: string) => k;
    expect(momentPhrase(new Date(2026, 9, 26, 21, 30).getTime(), NOW, 'fr', t)).toBe('ce soir');
    expect(momentPhrase(new Date(2026, 9, 26, 15, 0).getTime(), NOW, 'fr', t)).toBe('aujourd’hui');
    expect(momentPhrase(new Date(2026, 9, 27, 21, 0).getTime(), NOW, 'fr', t)).toBe('demain');
    expect(momentPhrase(new Date(2026, 9, 29, 21, 0).getTime(), NOW, 'fr', t)).toMatch(/jeudi 29/);
  });
});

describe('quandText', () => {
  const t = (k: string) => k;
  it('relatif : le jour de la semaine abrégé suit ; sinon seulement le quantième et le mois', async () => {
    const { quandText } = await import('../src/lib/matchDetail.js');
    expect(quandText(new Date(2026, 9, 26, 21, 30).getTime(), NOW, 'fr', t)).toMatch(/^Ce soir · lun\. 26 oct/);
    expect(quandText(new Date(2026, 9, 27, 21, 0).getTime(), NOW, 'fr', t)).toMatch(/^Demain · mar\. 27 oct/);
    expect(quandText(new Date(2026, 9, 30, 20, 0).getTime(), NOW, 'fr', t)).toMatch(/^Vendredi · 30 oct/);
  });
});
