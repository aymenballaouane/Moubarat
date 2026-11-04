import { describe, expect, it } from 'vitest';
import { total, type Booking } from '@moubarat/core';
import {
  CREATE_STEPS, NOTE_MAX, dayParts, durationText, eligibleReservations, formatBadge, slotStartEpoch, stepStates, weekdayOfDate,
} from '../src/lib/createMatch.js';
import { ceilToTen, perPlayerShown } from '../src/lib/price.js';
import { matchFromApi, type ApiPublicMatch } from '../src/lib/mappers.js';

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 26, 12, 0).getTime();

function booking(over: Partial<Booking> & { id: string }): Booking {
  return {
    fieldId: 'f1', range: { start: NOW + 24 * HOUR, end: NOW + 25.5 * HOUR }, source: 'MOUBARAT', status: 'RESERVED',
    verifiedByCenter: true, priceTotal: total(6000), byUserId: 'me', createdAt: NOW - HOUR, ...over,
  } as Booking;
}

describe('règle 13 — prix par joueur arrondi à la dizaine supérieure', () => {
  it('ceilToTen', () => {
    expect(ceilToTen(642.86)).toBe(650);
    expect(ceilToTen(650)).toBe(650);
    expect(ceilToTen(651)).toBe(660);
    expect(ceilToTen(0)).toBe(0);
  });
  it('perPlayerShown : l’exemple de la règle et les tarifs qui tombent juste', () => {
    expect(perPlayerShown(9000, 14)).toBe(650);
    expect(perPlayerShown(6000, 10)).toBe(600);
    expect(perPlayerShown(5000, 10)).toBe(500);
    expect(perPlayerShown(3600, 4)).toBe(900);
    expect(perPlayerShown(5250, 10)).toBe(530);
    expect(perPlayerShown(1000, 0)).toBe(0);
  });
  it('le mapper de match arrondit ce que le serveur sert (525 → 530) et laisse 600 tel quel', () => {
    const wire = (p: number): ApiPublicMatch => ({
      id: 'm', sport: 'FOOTBALL', format: '5v5', level: 'LOISIR', title: 'T', venueId: 'v', fieldId: 'f', start: NOW, end: NOW + HOUR,
      capacity: 10, pricePerPlayerDa: p, visibility: 'OPEN', status: 'OPEN', organizerId: 'o', coordination: 'WHATSAPP', whatsappUrl: null,
      createdAt: NOW,
    });
    expect(matchFromApi(wire(525)).pricePerPlayer.amount).toBe(530);
    expect(matchFromApi(wire(600)).pricePerPlayer.amount).toBe(600);
  });
});

describe('suivi en trois étapes', () => {
  it('libellés de la maquette', () => {
    expect([...CREATE_STEPS]).toEqual(['Créneau', 'Détails', 'Publié']);
  });
  it('étape 1 et 2 : une étape courante ; étape 3 (Publié) : tout est coché', () => {
    expect(stepStates(1)).toEqual([{ done: false, current: true }, { done: false, current: false }, { done: false, current: false }]);
    expect(stepStates(2)).toEqual([{ done: true, current: false }, { done: false, current: true }, { done: false, current: false }]);
    expect(stepStates(3)).toEqual([{ done: true, current: false }, { done: true, current: false }, { done: true, current: false }]);
  });
});

describe('eligibleReservations', () => {
  it('ne garde que les réservations où un match peut s’ouvrir, la plus proche d’abord', () => {
    const rs = [
      { booking: booking({ id: 'late', range: { start: NOW + 48 * HOUR, end: NOW + 49.5 * HOUR } }) },
      { booking: booking({ id: 'soon', range: { start: NOW + 5 * HOUR, end: NOW + 6.5 * HOUR } }) },
      { booking: booking({ id: 'withMatch', matchId: 'm1' }) },
      { booking: booking({ id: 'past', range: { start: NOW - 3 * HOUR, end: NOW - 1.5 * HOUR } }) },
      { booking: booking({ id: 'cancelled', status: 'CANCELLED' }) },
      { booking: booking({ id: 'phoneUnconfirmed', source: 'PHONE', verifiedByCenter: false }) },
      { booking: booking({ id: 'phoneConfirmed', source: 'PHONE', verifiedByCenter: true, range: { start: NOW + 30 * HOUR, end: NOW + 31.5 * HOUR } }) },
    ];
    expect(eligibleReservations(rs, NOW).map((r) => r.booking.id)).toEqual(['soon', 'phoneConfirmed', 'late']);
  });
  it('aucune réservation éligible → liste vide', () => {
    expect(eligibleReservations([], NOW)).toEqual([]);
  });
});

describe('libellés', () => {
  it('durationText', () => {
    expect(durationText(60)).toBe('1 h');
    expect(durationText(90)).toBe('1 h 30');
    expect(durationText(120)).toBe('2 h');
    expect(durationText(45)).toBe('45 min');
  });
  it('formatBadge : 5V5 et 2V2 comme les maquettes', () => {
    expect(formatBadge('5v5')).toBe('5V5');
    expect(formatBadge('7v7')).toBe('7V7');
    expect(formatBadge('DOUBLE')).toBe('2V2');
    expect(formatBadge('SIMPLE')).toBe('1V1');
  });
  it('dayParts : « MER. 21 »', () => {
    expect(dayParts(new Date(2026, 9, 21, 18, 30).getTime())).toEqual({ weekdayKey: 'MER.', date: 21 });
  });
  it('slotStartEpoch et weekdayOfDate : la date du jour interrogé + les minutes de départ', () => {
    expect(slotStartEpoch('2026-10-21', 18 * 60 + 30)).toBe(new Date(2026, 9, 21, 18, 30).getTime());
    expect(slotStartEpoch('2026-10-21', 1440 + 30)).toBe(new Date(2026, 9, 22, 0, 30).getTime());
    expect(weekdayOfDate('2026-10-21')).toBe(3);
  });
  it('le mot aux joueurs est plafonné à 280 signes', () => {
    expect(NOTE_MAX).toBe(280);
  });
});
