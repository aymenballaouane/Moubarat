import { describe, expect, it } from 'vitest';
import { MAX_BOOKINGS_PER_DAY, MAX_UPCOMING_BOOKINGS, checkBookingLimits, type Booking } from '../src/index.js';

/* Règle 23 (refonte app joueur, 26/10/2026 — règle NOUVELLE) : au plus 2 réservations par jour et 4 à venir, par joueur. Additif. */

const H = 3_600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const dayOf = (ms: number) => new Date(ms + H).toISOString().slice(0, 10);   // « Alger » : UTC+1
const at = (daysOut: number, hour: number) => NOW + daysOut * 24 * H + (hour - 12) * H;
const b = (daysOut: number, hour: number, status: Booking['status'] = 'RESERVED'): Pick<Booking, 'range' | 'status'> => ({
  range: { start: at(daysOut, hour), end: at(daysOut, hour) + 1.5 * H }, status,
});

describe('règle 23 — plafonds de réservation', () => {
  it('les valeurs de la règle', () => {
    expect(MAX_BOOKINGS_PER_DAY).toBe(2);
    expect(MAX_UPCOMING_BOOKINGS).toBe(4);
  });

  it('une première et une deuxième réservation le même jour passent, la troisième non', () => {
    const cand = { start: at(3, 21), end: at(3, 21) + 1.5 * H };
    expect(checkBookingLimits({ candidate: cand, mine: [], now: NOW, dayOf }).ok).toBe(true);
    expect(checkBookingLimits({ candidate: cand, mine: [b(3, 9)], now: NOW, dayOf }).ok).toBe(true);
    const third = checkBookingLimits({ candidate: cand, mine: [b(3, 9), b(3, 15)], now: NOW, dayOf });
    expect(third.ok).toBe(false);
    expect(!third.ok && third.code).toBe('BOOKING_LIMIT_DAY');
    expect(!third.ok && third.message).toContain('2 réservations ce jour-là');
  });

  it('un autre jour n’est pas concerné par le plafond du jour', () => {
    const cand = { start: at(4, 21), end: at(4, 21) + 1.5 * H };
    expect(checkBookingLimits({ candidate: cand, mine: [b(3, 9), b(3, 15)], now: NOW, dayOf }).ok).toBe(true);
  });

  it('la cinquième réservation à venir est refusée, même un jour libre', () => {
    const mine = [b(1, 20), b(2, 20), b(3, 20), b(4, 20)];
    const res = checkBookingLimits({ candidate: { start: at(9, 20), end: at(9, 21.5) }, mine, now: NOW, dayOf });
    expect(!res.ok && res.code).toBe('BOOKING_LIMIT_UPCOMING');
    expect(!res.ok && res.message).toContain('4 réservations à venir');
  });

  it('seules les réservations qui occupent encore un terrain comptent (annulées, honorées ou passées : non)', () => {
    const mine = [b(1, 20, 'CANCELLED'), b(2, 20, 'HONORED'), b(-2, 20), b(3, 20, 'NO_SHOW'), b(4, 20)];
    expect(checkBookingLimits({ candidate: { start: at(8, 20), end: at(8, 21.5) }, mine, now: NOW, dayOf }).ok).toBe(true);
  });

  it('plafonds réglables (tests, déploiement) : les valeurs passées l’emportent', () => {
    const mine = [b(1, 20)];
    const res = checkBookingLimits({ candidate: { start: at(5, 20), end: at(5, 21.5) }, mine, now: NOW, dayOf, maxUpcoming: 1 });
    expect(!res.ok && res.code).toBe('BOOKING_LIMIT_UPCOMING');
  });

  it('le jour de la limite vient de dayOf (fuseau de l’appelant) : 23 h 30 et 00 h 30 ne sont pas le même jour', () => {
    const lateNight = { start: at(3, 22.75), end: at(3, 24) };   // 23:45 Alger (UTC+1)
    const justAfter = { start: at(3, 23.75), end: at(3, 25) };   // 00:45 le lendemain
    const mine = [{ range: lateNight, status: 'RESERVED' as const }, { range: { start: at(3, 20), end: at(3, 21.5) }, status: 'RESERVED' as const }];
    expect(dayOf(lateNight.start)).not.toBe(dayOf(justAfter.start));
    expect(checkBookingLimits({ candidate: justAfter, mine, now: NOW, dayOf }).ok).toBe(true);
  });
});
