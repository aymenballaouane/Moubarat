import { describe, expect, it } from 'vitest';
import {
  prepareBooking, bookingReference, deriveBookingPrefixCandidates, bookingStats, perHour, total, MIN,
  type Booking, type PricingRule, type RecurringBooking, type OpeningHours, type MatchFormat,
} from '../src/index.js';

const FRI = 5;
const DAY0 = Date.parse('2026-08-21T00:00:00Z');
const field = { id: 'f1', hourlyRate: perHour(2500), formats: ['5v5'] as MatchFormat[] };
const peak: PricingRule = { fieldId: 'f1', label: 'Pleines', weekdays: [0,1,2,3,4,5,6], startMin: 1080, endMin: 1440, format: '5v5', rate: perHour(3000) };
const hours: OpeningHours[] = [{ venueId: 'v1', weekday: FRI, startMin: 480, endMin: 1500 }];

const base = {
  id: 'b-new', field, rules: [peak], hours, weekday: FRI, dayStartMs: DAY0,
  durationMin: 90, format: '5v5' as const, existing: [] as Booking[], byUserId: 'aymen', now: DAY0,
};

function existingAt(startMin: number, durMin: number, over: Partial<Booking> = {}): Booking {
  return {
    id: 'b0', fieldId: 'f1',
    range: { start: DAY0 + startMin * MIN, end: DAY0 + (startMin + durMin) * MIN },
    status: 'RESERVED', source: 'MOUBARAT', verifiedByCenter: true,
    byUserId: 'karim', priceTotal: total(0), createdAt: DAY0, ...over,
  };
}

describe('prepareBooking', () => {
  it('crée une réservation chiffrée au prorata (17:30 + 90 min = 4 250 DA)', () => {
    const r = prepareBooking({ ...base, startMin: 1050 });
    expect(r.result.ok).toBe(true);
    expect(r.booking!.priceTotal.amount).toBe(4250);
    expect(r.quote!.bands.length).toBe(2);
    expect(r.booking!.verifiedByCenter).toBe(true);
    expect(r.notifyCenter).toBe(false);
  });
  it('refuse un créneau pris, un abonnement, ou hors horaires', () => {
    const taken = prepareBooking({ ...base, startMin: 1260, existing: [existingAt(1260, 90)] });
    expect(!taken.result.ok && taken.result.code).toBe('SLOT_TAKEN');

    const rec: RecurringBooking = { id: 'r1', fieldId: 'f1', weekday: FRI, startMin: 1200, durationMin: 90, holderName: 'FC Kahwa', activeFrom: 0, status: 'ACTIVE' };
    const sub = prepareBooking({ ...base, startMin: 1230, recurring: [rec] });
    expect(!sub.result.ok && sub.result.code).toBe('SLOT_TAKEN');

    const early = prepareBooking({ ...base, startMin: 420 });
    expect(!early.result.ok && early.result.code).toBe('HOURS_INVALID');
    const long = prepareBooking({ ...base, startMin: 600, durationMin: 400 });
    expect(!long.result.ok && long.result.code).toBe('HOURS_INVALID');
  });
  /* Lot P1 (03/09/2026), point 1 — garde « créneau déjà passé ». Cas testés
     exprès autour de minuit (créneau après minuit = startMin > 1440, jour
     calendaire ≠ jour interrogé) et sur un vendredi (ouverture décalée). */
  describe('garde « créneau déjà passé » (SLOT_IN_PAST)', () => {
    const FRIDAY_HOURS: OpeningHours[] = [{ venueId: 'v1', weekday: FRI, startMin: 840, endMin: 1500 }];

    it('refuse un créneau dont le début est passé, avec son propre code (jamais SLOT_TAKEN ni HOURS_INVALID)', () => {
      const r = prepareBooking({ ...base, startMin: 600, now: DAY0 + 601 * MIN });
      expect(!r.result.ok && r.result.code).toBe('SLOT_IN_PAST');
      expect(r.notifyCenter).toBe(false);
    });
    it('un début exactement « maintenant » est déjà passé ; une minute plus tard est encore libre', () => {
      const atNow = prepareBooking({ ...base, startMin: 600, now: DAY0 + 600 * MIN });
      expect(!atNow.result.ok && atNow.result.code).toBe('SLOT_IN_PAST');
      const soon = prepareBooking({ ...base, startMin: 601, now: DAY0 + 600 * MIN });
      expect(soon.result.ok).toBe(true);
    });
    it('autour de minuit : 00:30 (startMin 1470) demandé à 23:50 la veille → libre ; demandé à 00:45 → passé', () => {
      // 30 min : 00:30 → 01:00, dernier créneau qui tient dans l'ouverture
      // 08:00 → 01:00 (endMin 1500) — 90 min déborderait et dirait HOURS_INVALID.
      const before = prepareBooking({ ...base, startMin: 1470, durationMin: 30, now: DAY0 + 1430 * MIN });
      expect(before.result.ok).toBe(true);
      const after = prepareBooking({ ...base, startMin: 1470, durationMin: 30, now: DAY0 + 1485 * MIN });
      expect(!after.result.ok && after.result.code).toBe('SLOT_IN_PAST');
    });
    it('vendredi (ouverture 14:00) : 14:00 demandé à 13:59 → libre ; à 14:01 → passé ; 10:00 → hors horaires, pas « passé »', () => {
      const okFri = prepareBooking({ ...base, hours: FRIDAY_HOURS, startMin: 840, now: DAY0 + 839 * MIN });
      expect(okFri.result.ok).toBe(true);
      const lateFri = prepareBooking({ ...base, hours: FRIDAY_HOURS, startMin: 840, now: DAY0 + 841 * MIN });
      expect(!lateFri.result.ok && lateFri.result.code).toBe('SLOT_IN_PAST');
      // Créneau futur mais avant l'ouverture du vendredi : c'est le motif
      // « horaires », pas « passé » — l'ordre des gardes compte.
      const early = prepareBooking({ ...base, hours: FRIDAY_HOURS, startMin: 600, now: DAY0 + 480 * MIN });
      expect(!early.result.ok && early.result.code).toBe('HOURS_INVALID');
    });
    it('sources centre (WALK_IN / PHONE) : un créneau EN COURS reste enregistrable, un créneau terminé non', () => {
      // 18:00 → 19:30, déclaré à 18:05 : client en retard, l'accueil doit pouvoir le saisir.
      const walkIn = prepareBooking({ ...base, startMin: 1080, source: 'WALK_IN', reservationName: 'Client', now: DAY0 + 1085 * MIN });
      expect(walkIn.result.ok).toBe(true);
      const phone = prepareBooking({ ...base, startMin: 1080, source: 'PHONE', reservationName: 'Client', now: DAY0 + 1085 * MIN });
      expect(phone.result.ok).toBe(true);
      // Le joueur, lui, ne réserve jamais un départ déjà passé.
      const player = prepareBooking({ ...base, startMin: 1080, source: 'MOUBARAT', now: DAY0 + 1085 * MIN });
      expect(!player.result.ok && player.result.code).toBe('SLOT_IN_PAST');
      // Créneau terminé (19:30 atteint) : refusé même pour l'accueil.
      const over = prepareBooking({ ...base, startMin: 1080, source: 'WALK_IN', reservationName: 'Client', now: DAY0 + 1170 * MIN });
      expect(!over.result.ok && over.result.code).toBe('SLOT_IN_PAST');
      const almost = prepareBooking({ ...base, startMin: 1080, source: 'WALK_IN', reservationName: 'Client', now: DAY0 + 1169 * MIN });
      expect(almost.result.ok).toBe(true);
    });
  });

  it('refuse un format que le terrain ne propose pas (FORMAT_NOT_AVAILABLE), avant toute autre garde', () => {
    const r = prepareBooking({ ...base, startMin: 600, format: '6v6' });
    expect(!r.result.ok && r.result.code).toBe('FORMAT_NOT_AVAILABLE');
  });
  it('une réservation annulée ne bloque pas', () => {
    const r = prepareBooking({ ...base, startMin: 1260, existing: [existingAt(1260, 90, { status: 'CANCELLED' })] });
    expect(r.result.ok).toBe(true);
  });
  it('chemin B : EXTERNAL non vérifiée + alerte gérant', () => {
    const r = prepareBooking({ ...base, startMin: 600, source: 'PHONE', reservationName: 'Aymen' });
    expect(r.result.ok).toBe(true);
    expect(r.booking!.source).toBe('PHONE');
    expect(r.booking!.verifiedByCenter).toBe(false);
    expect(r.notifyCenter).toBe(true);
  });
});

describe('référence & stats cash', () => {
  it('référence lisible : préfixe FIXE (déjà attribué) + 6 chiffres, jamais retouché', () => {
    expect(bookingReference('COM', 482)).toBe('COM-000482');
    expect(bookingReference('AIN', 1012048)).toBe('AIN-012048'); // 1 012 048 % 1 000 000
    expect(bookingReference('KXX', 7)).toBe('KXX-000007');
  });

  it('deriveBookingPrefixCandidates : fenêtre glissante de 3 lettres, complétée par X si le nom en a moins de 3', () => {
    expect(deriveBookingPrefixCandidates('Complexe Ryad')).toEqual([
      'COM', 'OMP', 'MPL', 'PLE', 'LEX', 'EXE', 'XER', 'ERY', 'RYA', 'YAD',
    ]);
    expect(deriveBookingPrefixCandidates('Aïn Benian Arena')[0]).toBe('AIN');
    expect(deriveBookingPrefixCandidates('K2')).toEqual(['KXX']);
    expect(deriveBookingPrefixCandidates('99')).toEqual(['XXX']);
  });
  it('no-show et revenu réel sortent des statuts, pas du déclaratif', () => {
    const mk = (status: Booking['status'], amount: number) => existingAt(600, 60, { status, priceTotal: total(amount) });
    const s = bookingStats([mk('PAID', 4000), mk('PAID', 3000), mk('HONORED', 2500), mk('NO_SHOW', 2500), mk('RESERVED', 4500), mk('CANCELLED', 9999)]);
    expect(s.cashCollected).toBe(7000);
    expect(s.cashExpected).toBe(7000);         // 2 500 honoré + 4 500 réservé
    expect(s.noShowRate).toBeCloseTo(1 / 4);   // 1 no-show sur 4 issues connues
    expect(s.cancelled).toBe(1);
  });
  it('pas d’issue connue → pas de taux inventé', () => {
    expect(bookingStats([existingAt(600, 60)]).noShowRate).toBeNull();
  });
});
