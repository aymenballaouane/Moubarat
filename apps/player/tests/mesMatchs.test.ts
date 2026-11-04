import { describe, expect, it } from 'vitest';
import { perPlayer, total, type Booking, type Match, type MatchPlayer } from '@moubarat/core';
import { buildPast, buildUpcoming, pastDateParts, type MatchEntry, type MesMatchsContext, type ResaEntry } from '../src/lib/mesMatchs.js';

const H = 3_600_000;
const NOW = new Date(2026, 9, 26, 12, 0).getTime();

const FIELDS: Record<string, { venueName: string; field: { name: string; sport: string; formats: string[] } }> = {
  f1: { venueName: 'Green Arena Sport', field: { name: 'T1', sport: 'FOOTBALL', formats: ['5v5', '7v7'] } },
  f3: { venueName: 'Green Arena Sport', field: { name: 'T3', sport: 'PADEL', formats: ['DOUBLE'] } },
};

const ctx: MesMatchsContext = {
  meId: 'me', now: NOW,
  venueName: (id) => ({ v1: 'Green Arena Sport', v2: 'Complexe Ryad' } as Record<string, string>)[id] ?? 'Centre',
  fieldInfo: (id) => FIELDS[id],
  nameOf: (id) => ({ yanis: 'Yanis' } as Record<string, string>)[id],
};

function match(id: string, over: Partial<Match> = {}): Match {
  return {
    id, sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'x', venueId: 'v1', fieldId: 'f1',
    range: { start: NOW + 24 * H, end: NOW + 25.5 * H }, capacity: 10, pricePerPlayer: perPlayer(500), visibility: 'OPEN', status: 'OPEN',
    organizerId: 'me', coordination: { kind: 'WHATSAPP' }, createdAt: NOW, ...over,
  } as Match;
}
const pl = (userId: string, team?: 'A' | 'B'): MatchPlayer => ({ matchId: 'm', userId, status: 'JOINED', joinedAt: 1, ...(team ? { team } : {}) });
const entry = (m: Match, players: MatchPlayer[]): MatchEntry => ({ match: m, players });
function booking(id: string, over: Partial<Booking> = {}): Booking {
  return {
    id, fieldId: 'f1', range: { start: NOW + 48 * H, end: NOW + 49.5 * H }, source: 'MOUBARAT', status: 'RESERVED', verifiedByCenter: true,
    priceTotal: total(5000), byUserId: 'me', createdAt: NOW - H, ...over,
  } as Booking;
}

describe('buildUpcoming', () => {
  it('mes matchs (organisé / joué) et mes réservations sans match, la plus proche d’abord ; jamais de prix sur une réservation', () => {
    const orga = entry(match('m1', { range: { start: NOW + 30 * H, end: NOW + 31 * H } }), [pl('me', 'A'), pl('a', 'A')]);
    const joue = entry(match('m2', { organizerId: 'x', pricePerPlayer: perPlayer(500), range: { start: NOW + 10 * H, end: NOW + 11 * H } }), [pl('x', 'A'), pl('me', 'B')]);
    const resa: ResaEntry = { booking: booking('b1'), format: '5v5' };
    const cards = buildUpcoming([orga, joue], [resa], ctx);
    expect(cards.map((c) => `${c.kind}:${c.id}`)).toEqual(['joue:m:m2', 'orga:m:m1', 'resa:b:b1']);
    const j = cards[0]!;
    expect(j.team).toBe('B');
    expect(j.priceDa).toBe(500);
    expect(j.venueName).toBe('Green Arena Sport');
    const o = cards[1]!;
    expect(o.left).toBe(8);
    expect(o.mine).toBe(true);
    const r = cards[2]!;
    expect(r.priceDa).toBe(0);                                       // jamais de prix sur une réservation
    expect(r.canCreate).toBe(true);
    expect(r.fieldName).toBe('T1');
  });

  it('une réservation dont le match est vivant n’a pas sa propre carte ; annulée, passée, ou à moins de 2 h : non plus / sans « créer »', () => {
    const live = entry(match('m1'), [pl('me', 'A')]);
    const withMatch = booking('b1', { matchId: 'm1' });
    const cancelled = booking('b2', { status: 'CANCELLED' });
    const past = booking('b3', { range: { start: NOW - 5 * H, end: NOW - 3 * H } });
    const soon = booking('b4', { range: { start: NOW + 1 * H, end: NOW + 2.5 * H } });
    const cards = buildUpcoming([live], [{ booking: withMatch }, { booking: cancelled }, { booking: past }, { booking: soon }], ctx);
    expect(cards.map((c) => c.id)).toEqual(['b:b4', 'm:m1']);
    expect(cards[0]!.canCreate).toBe(false);                         // à moins de 2 h : « Voir ta réservation »
  });

  it('une réservation téléphonique non confirmée : « à confirmer », jamais « créer un match »', () => {
    const [c] = buildUpcoming([], [{ booking: booking('b1', { source: 'PHONE', verifiedByCenter: false }) }], ctx);
    expect(c!.pending).toBe(true);
    expect(c!.canCreate).toBe(false);
  });

  it('le format d’une réservation sans format connu : celui du terrain ; padel DOUBLE', () => {
    const [a] = buildUpcoming([], [{ booking: booking('b1') }], ctx);
    expect(a!.format).toBe('5v5');
    const [p] = buildUpcoming([], [{ booking: booking('b2', { fieldId: 'f3' }) }], ctx);
    expect(p!.sport).toBe('PADEL');
    expect(p!.format).toBe('DOUBLE');
  });
});

describe('buildPast', () => {
  it('matchs joués / annulés et réservations passées, la plus récente d’abord ; mon rôle', () => {
    const played = entry(match('m1', { status: 'PLAYED', organizerId: 'x', range: { start: NOW - 48 * H, end: NOW - 46 * H } }), [pl('x', 'A'), pl('me', 'B')]);
    const organized = entry(match('m2', { status: 'PLAYED', range: { start: NOW - 72 * H, end: NOW - 70 * H } }), [pl('me', 'A')]);
    const cancelledByOther = entry(match('m3', { status: 'CANCELLED', organizerId: 'yanis', range: { start: NOW - 24 * H, end: NOW - 22 * H } }), [pl('yanis', 'A'), pl('me', 'B')]);
    const upcoming = entry(match('m4'), [pl('me', 'A')]);
    const honored: ResaEntry = { booking: booking('b1', { status: 'HONORED', range: { start: NOW - 96 * H, end: NOW - 94 * H } }) };
    const cancelledResa: ResaEntry = { booking: booking('b2', { status: 'CANCELLED', range: { start: NOW - 10 * H, end: NOW - 8 * H } }) };
    const noShow: ResaEntry = { booking: booking('b3', { status: 'NO_SHOW', range: { start: NOW - 120 * H, end: NOW - 118 * H } }) };
    const rows = buildPast([played, organized, cancelledByOther, upcoming], [honored, cancelledResa, noShow], ctx);
    expect(rows.map((r) => r.id)).toEqual(['b:b2', 'm:m3', 'm:m1', 'm:m2', 'b:b1']);
    expect(rows.find((r) => r.id === 'm:m1')!.role).toEqual({ kind: 'team', team: 'B' });
    expect(rows.find((r) => r.id === 'm:m2')!.role).toEqual({ kind: 'organized' });
    expect(rows.find((r) => r.id === 'm:m3')).toMatchObject({ state: 'cancelled', role: { kind: 'cancelledBy', name: 'Yanis' } });
    expect(rows.find((r) => r.id === 'b:b1')).toMatchObject({ state: 'played', role: { kind: 'none' } });
    expect(rows.find((r) => r.id === 'b:b2')!.state).toBe('cancelled');
  });

  it('la réservation d’un match annulé n’ajoute pas une deuxième ligne', () => {
    const cancelled = entry(match('m1', { status: 'CANCELLED', range: { start: NOW - 24 * H, end: NOW - 22 * H } }), [pl('me', 'A')]);
    const resa: ResaEntry = { booking: booking('b1', { status: 'CANCELLED', matchId: 'm1', range: { start: NOW - 24 * H, end: NOW - 22 * H } }) };
    expect(buildPast([cancelled], [resa], ctx).map((r) => r.id)).toEqual(['m:m1']);
  });
});

describe('pastDateParts', () => {
  it('« OCT. » et « 09 » ; chiffres occidentaux en arabe', () => {
    const t = new Date(2026, 9, 9, 20, 0).getTime();
    expect(pastDateParts(t, 'fr')).toEqual({ month: 'OCT.', day: '09' });
    expect(pastDateParts(t, 'ar').day).toBe('09');
    expect(pastDateParts(t, 'ar').month).toContain('أكتوبر');
  });
});
