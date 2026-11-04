import { describe, expect, it } from 'vitest';
import {
  createMatch, joinMatch, leaveMatch, removePlayer, matchShareText, whatsappShareUrl,
  canJoinMatch, perHour, bookingTotal, MIN,
  type Booking, type Field, type Match, type MatchPlayer,
} from '../src/index.js';

const NOW = Date.parse('2026-08-21T12:00:00Z');
const H = 3_600_000;

const field: Pick<Field, 'id' | 'sport' | 'formats'> = { id: 'f1', sport: 'FOOTBALL', formats: ['5v5', '7v7'] };
const booking: Booking = {
  id: 'b1', fieldId: 'f1', range: { start: NOW + 8 * H, end: NOW + 9.5 * H },
  status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true, byUserId: 'aymen',
  priceTotal: bookingTotal(perHour(3000), 90), createdAt: NOW,   // 4 500 DA
};
const base = {
  id: 'm1', booking, field, venueId: 'v1', title: 'Match du vendredi',
  format: '5v5' as const, level: 'LOISIR' as const, organizerId: 'aymen', now: NOW,
};

describe('createMatch', () => {
  it('chemin B : match sur la réservation, prix dérivé (4 500 ÷ 10 = 450 DA/joueur), organisateur inscrit', () => {
    const r = createMatch(base);
    expect(r.result.ok).toBe(true);
    expect(r.match!.pricePerPlayer.amount).toBe(450);
    expect(r.match!.pricePerPlayer.unit).toBe('PER_PLAYER');
    expect(r.match!.range).toEqual(booking.range);
    expect(r.match!.bookingId).toBe('b1');
    expect(r.match!.coordination.kind).toBe('WHATSAPP');
    expect(r.organizerEntry!.userId).toBe('aymen');
    expect(r.organizerEntry!.status).toBe('JOINED');
  });
  it('refuse : format hors terrain, réservation déjà matchée ou annulée, titre invalide', () => {
    expect(createMatch({ ...base, format: '11v11' }).result.ok).toBe(false);
    expect(createMatch({ ...base, booking: { ...booking, matchId: 'x' } }).result.ok).toBe(false);
    expect(createMatch({ ...base, booking: { ...booking, status: 'CANCELLED' } }).result.ok).toBe(false);
    expect(createMatch({ ...base, title: 'ab' }).result.ok).toBe(false);
    const cap = createMatch({ ...base, capacity: 14 });
    expect(!cap.result.ok && cap.result.code).toBe('OVER_FIELD_CAPACITY');
  });
  it('BUG-4 (27/09/2026) : refuse une réservation téléphonique non confirmée, un créneau passé, un créneau à moins de 2 h — accepte la même téléphonique une fois confirmée', () => {
    const phone = createMatch({ ...base, booking: { ...booking, source: 'PHONE', verifiedByCenter: false } });
    expect(!phone.result.ok && phone.result.code).toBe('BOOKING_NOT_VERIFIED');
    expect(createMatch({ ...base, booking: { ...booking, source: 'PHONE', verifiedByCenter: true } }).result.ok).toBe(true);
    // Créneau passé : le début est derrière `now`.
    const past = createMatch({ ...base, booking: { ...booking, range: { start: NOW - 3 * H, end: NOW - 1.5 * H } } });
    expect(!past.result.ok && past.result.code).toBe('SLOT_IN_PAST');
    // Sous le verrou des inscriptions (H-2) : à 1 h 59 du coup d'envoi, plus de match ; à 2 h 01, encore possible.
    const soon = createMatch({ ...base, booking: { ...booking, range: { start: NOW + 119 * 60_000, end: NOW + 3 * H } } });
    expect(!soon.result.ok && soon.result.code).toBe('MATCH_LOCKED');
    expect(createMatch({ ...base, booking: { ...booking, range: { start: NOW + 121 * 60_000, end: NOW + 3 * H } } }).result.ok).toBe(true);
  });
});

describe('join / leave / remove — les états dérivent', () => {
  const { match, organizerEntry } = createMatch(base) as { match: Match; organizerEntry: MatchPlayer };
  const seed = (n: number): MatchPlayer[] => [organizerEntry,
    ...Array.from({ length: n }, (_, i) => ({ matchId: 'm1', userId: `u${i}`, status: 'JOINED' as const, joinedAt: NOW }))];

  it('le 10e joueur fait passer le match à COMPLET, un départ le rouvre', () => {
    const j = joinMatch(match, seed(8), 'nassim', [], NOW);
    expect(j.result.ok).toBe(true);
    expect(j.status).toBe('FULL');
    const l = leaveMatch({ ...match, status: 'FULL' }, j.players!, 'u3', NOW);
    expect(l.result.ok).toBe(true);
    expect(l.status).toBe('OPEN');
  });
  it('un joueur retiré par l’organisateur ne revient pas', () => {
    const r = removePlayer(match, seed(3), 'aymen', 'u1', NOW);
    expect(r.result.ok).toBe(true);
    expect(r.players!.find((p) => p.userId === 'u1')!.status).toBe('REMOVED');
    const back = canJoinMatch(match, r.players!, 'u1', [], NOW);
    expect(!back.ok && back.code).toBe('FORBIDDEN');
  });
  it('seul l’organisateur retire, et jamais lui-même', () => {
    expect(removePlayer(match, seed(3), 'u0', 'u1', NOW).result.ok).toBe(false);
    expect(removePlayer(match, seed(3), 'aymen', 'aymen', NOW).result.ok).toBe(false);
  });
});

describe('coordination WhatsApp', () => {
  it('le message porte le prix AVEC unité et le lien encode le texte', () => {
    const t = matchShareText({ title: 'Friday Night', venueName: 'Complexe Ryad',
      dayLabel: 'Ven.', timeLabel: '20:00', pricePerPlayerDa: 450, spotsLeft: 3 });
    expect(t).toContain('450 DA / joueur');
    expect(t).toContain('3 places restantes');
    expect(whatsappShareUrl(t)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(whatsappShareUrl(t)).not.toContain(' ');
  });
});
