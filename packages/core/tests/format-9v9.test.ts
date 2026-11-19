/* Lot « Match libre », phase 9v9 (GO d'Aymen du 16/11/2026 : « 9v9 dans une phase à part — règles, base, CRM, aucun prix par défaut »).
   Tests ADDITIFS : aucun test des 128 d'origine n'est modifié. */
import { describe, expect, it } from 'vitest';
import {
  FORMAT_CAPACITY, SPORT_FORMATS, validateFieldFormats, validateCapacity, createFreeMatch, createMatch, perHour, bookingTotal,
  type Booking, type Field,
} from '../src/index.js';

const H = 3_600_000;
const NOW = Date.parse('2026-11-17T10:00:00Z');

describe('format 9v9', () => {
  it('18 joueurs (9 par équipe), entre le 8v8 et le 11v11 dans les formats du foot', () => {
    expect(FORMAT_CAPACITY['9v9']).toBe(18);
    expect(SPORT_FORMATS.FOOTBALL).toEqual(['5v5', '6v6', '7v7', '8v8', '9v9', '11v11']);
  });

  it('un terrain de foot peut le proposer, jamais un terrain de padel ni de basket', () => {
    expect(validateFieldFormats('FOOTBALL', ['7v7', '9v9']).ok).toBe(true);
    expect(validateFieldFormats('PADEL', ['9v9']).ok).toBe(false);
    expect(validateFieldFormats('BASKET', ['9v9']).ok).toBe(false);
  });

  it('match de centre : capacité 18 sur un terrain qui propose le 9v9, refusé ailleurs ; le prix se partage entre 18', () => {
    const field = { id: 'f1', sport: 'FOOTBALL', formats: ['9v9', '11v11'] } as unknown as Field;
    expect(validateCapacity({ format: '9v9', capacity: 18, fieldId: 'f1' }, field).ok).toBe(true);
    expect(validateCapacity({ format: '9v9', capacity: 18, fieldId: 'f1' }, { ...field, formats: ['5v5'] } as Field).ok).toBe(false);
    const booking: Booking = {
      id: 'b1', fieldId: 'f1', range: { start: NOW + 8 * H, end: NOW + 9.5 * H }, status: 'RESERVED', source: 'MOUBARAT',
      verifiedByCenter: true, byUserId: 'aymen', priceTotal: bookingTotal(perHour(9000), 90), createdAt: NOW,   // 13 500 DA
    };
    const r = createMatch({ id: 'm1', booking, field, venueId: 'v1', title: 'Grand match', format: '9v9', level: 'LOISIR', organizerId: 'aymen', now: NOW });
    expect(r.result.ok).toBe(true);
    expect(r.match!.capacity).toBe(18);
    expect(r.match!.pricePerPlayer.amount).toBe(750);
  });

  it('match libre en 9v9 (planche W4)', () => {
    const r = createFreeMatch({
      id: 'fm', place: { name: 'Stade communal', wilaya: 'Alger' }, sport: 'FOOTBALL', format: '9v9', level: 'LOISIR',
      start: NOW + 8 * H, durationMin: 90, title: 'Stade communal', organizerId: 'aymen', now: NOW,
    });
    expect(r.result.ok).toBe(true);
    expect(r.match!.capacity).toBe(18);
  });
});
