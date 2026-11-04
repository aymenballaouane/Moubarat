import { describe, expect, it } from 'vitest';
import {
  ABSENCE_RESTRICTION_THRESHOLD, RESTRICTION_DAYS, absencePoints, activeRestriction, canDeclareAbsence, canPlayUnderRestriction, nextRestriction,
  pointsSinceLastRestriction, type AbsenceEvent, type RestrictionRecord,
} from '../src/index.js';

/* Règle 25 (MODIFIÉE, précisions d'Aymen du 26/10/2026) : absences, demi-absences, restrictions 7 j / 30 j / blocage, compteur remis à zéro. */

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-10T12:00:00Z');
const full = (at: number): AbsenceEvent => ({ kind: 'FULL', at });
const half = (at: number): AbsenceEvent => ({ kind: 'HALF', at });

describe('points et seuil', () => {
  it('une absence vaut 1, une demi-absence 0,5 : deux demi-absences valent une absence', () => {
    expect(absencePoints([full(1)])).toBe(1);
    expect(absencePoints([half(1), half(2)])).toBe(1);
    expect(absencePoints([full(1), half(2), half(3), full(4)])).toBe(3);
    expect(ABSENCE_RESTRICTION_THRESHOLD).toBe(2);
    expect(RESTRICTION_DAYS).toEqual([7, 30]);
  });

  it('2 absences déclenchent la 1re restriction (7 jours) ; 1 absence + 1 demi, non ; 1 absence + 2 demi-absences, oui', () => {
    expect(nextRestriction([full(1)], [], NOW)).toBeNull();
    expect(nextRestriction([full(1), half(2)], [], NOW)).toBeNull();
    const r = nextRestriction([full(1), full(2)], [], NOW)!;
    expect(r).toEqual({ level: 1, startedAt: NOW, endsAt: NOW + 7 * DAY });
    expect(nextRestriction([full(1), half(2), half(3)], [], NOW)).toMatchObject({ level: 1 });
    expect(nextRestriction([half(1), half(2), half(3), half(4)], [], NOW)).toMatchObject({ level: 1 });
  });
});

describe('le compteur repart à zéro après chaque restriction', () => {
  const first: RestrictionRecord = { level: 1, startedAt: NOW - 20 * DAY, endsAt: NOW - 13 * DAY };

  it('les absences d’AVANT la dernière restriction ne comptent plus', () => {
    const events = [full(NOW - 30 * DAY), full(NOW - 25 * DAY), full(NOW - 5 * DAY)];
    expect(pointsSinceLastRestriction(events, [first])).toBe(1);
    expect(nextRestriction(events, [first], NOW)).toBeNull();           // une seule absence nouvelle : il en faut 2
    expect(nextRestriction([...events, full(NOW - DAY)], [first], NOW)).toMatchObject({ level: 2, endsAt: NOW + 30 * DAY });
  });

  it('la 2e restriction dure 30 jours, la 3e est un blocage sans fin, et les suivantes aussi', () => {
    const second: RestrictionRecord = { level: 2, startedAt: NOW - 100 * DAY, endsAt: NOW - 70 * DAY };
    const events = [full(NOW - 2 * DAY), full(NOW - DAY)];
    expect(nextRestriction(events, [first, second], NOW)).toEqual({ level: 3, startedAt: NOW, endsAt: null });
    const third: RestrictionRecord = { level: 3, startedAt: NOW - 50 * DAY, endsAt: null, liftedAt: NOW - 40 * DAY };
    expect(nextRestriction(events, [first, second, third], NOW)).toMatchObject({ level: 4, endsAt: null });   // levée à la main, mais comptée
  });
});

describe('restriction en cours', () => {
  it('7 et 30 jours se lèvent d’eux-mêmes ; le blocage reste jusqu’à la main', () => {
    const r7: RestrictionRecord = { level: 1, startedAt: NOW - 3 * DAY, endsAt: NOW + 4 * DAY };
    expect(activeRestriction([r7], NOW)).toEqual(r7);
    expect(activeRestriction([r7], NOW + 4 * DAY)).toBeNull();
    const block: RestrictionRecord = { level: 3, startedAt: NOW - 400 * DAY, endsAt: null };
    expect(activeRestriction([block], NOW)).toEqual(block);
    expect(activeRestriction([{ ...block, liftedAt: NOW - DAY }], NOW)).toBeNull();
  });

  it('rejoindre ou réserver : refusé sous restriction (PLAYER_RESTRICTED), le blocage renvoie au support', () => {
    expect(canPlayUnderRestriction([], NOW).ok).toBe(true);
    const timed = canPlayUnderRestriction([{ level: 1, startedAt: NOW, endsAt: NOW + 7 * DAY }], NOW);
    expect(!timed.ok && timed.code).toBe('PLAYER_RESTRICTED');
    const blocked = canPlayUnderRestriction([{ level: 3, startedAt: NOW, endsAt: null }], NOW);
    expect(!blocked.ok && blocked.message).toContain('support');
  });
});

describe('qui peut déclarer une absence', () => {
  const match = { organizerId: 'orga', status: 'PLAYED' as const, range: { start: NOW - 3 * 3_600_000, end: NOW - 1.5 * 3_600_000 } };
  const players = [
    { userId: 'orga', status: 'JOINED' as const }, { userId: 'karim', status: 'JOINED' as const },
    { userId: 'walid', status: 'REMOVED' as const }, { userId: 'sami', status: 'LEFT' as const },
  ];
  const base = { match, players, declarerId: 'orga', byCenter: false, now: NOW };

  it('l’organisateur déclare un inscrit absent, après la fin du match', () => {
    expect(canDeclareAbsence({ ...base, targetId: 'karim' }).ok).toBe(true);
  });
  it('l’organisateur ne se déclare pas lui-même', () => {
    const r = canDeclareAbsence({ ...base, targetId: 'orga' });
    expect(!r.ok && r.code).toBe('FORBIDDEN');
  });
  it('un joueur qui n’est pas l’organisateur ne déclare rien', () => {
    const r = canDeclareAbsence({ ...base, declarerId: 'karim', targetId: 'orga' });
    expect(!r.ok && r.code).toBe('NOT_ORGANIZER');
  });
  it('un joueur retiré (règle 8) ou parti n’a jamais d’absence ; un inconnu non plus', () => {
    for (const targetId of ['walid', 'sami', 'inconnu']) {
      const r = canDeclareAbsence({ ...base, targetId });
      expect(!r.ok && r.code).toBe('ABSENCE_NOT_ELIGIBLE');
    }
  });
  it('trop tôt : l’organisateur attend la FIN du match, le centre peut dès le coup d’envoi', () => {
    const during = { ...base, now: match.range.start + 30 * 60_000, targetId: 'karim' };
    const r = canDeclareAbsence(during);
    expect(!r.ok && r.code).toBe('ABSENCE_TOO_EARLY');
    expect(canDeclareAbsence({ ...during, byCenter: true, declarerId: 'centre' }).ok).toBe(true);
    const before = canDeclareAbsence({ ...during, byCenter: true, declarerId: 'centre', now: match.range.start - 60_000 });
    expect(!before.ok && before.code).toBe('ABSENCE_TOO_EARLY');
  });
  it('un match annulé : personne n’y est absent', () => {
    const r = canDeclareAbsence({ ...base, match: { ...match, status: 'CANCELLED' }, targetId: 'karim' });
    expect(!r.ok && r.code).toBe('MATCH_CANCELLED');
  });
});
