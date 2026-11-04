import { describe, expect, it } from 'vitest';
import {
  validateFieldFormats, validateOpeningHours, rateAt, quoteRange,
  recurringOccurrence, fieldAvailability, perHour,
  SLOT_STEP_MIN, SPORT_FORMATS, MIN,
  type OpeningHours, type PricingRule, type RecurringBooking,
} from '../src/index.js';

// Vendredi 21 août 2026, minuit local (valeur arbitraire mais cohérente)
const FRI = 5;
const DAY0 = Date.parse('2026-08-21T00:00:00Z');

const base = perHour(2500);
const peak: PricingRule = {
  fieldId: 'f1', label: 'Heures pleines',
  weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 18 * 60, endMin: 24 * 60,
  format: '5v5', rate: perHour(3000),
};
const hours: OpeningHours[] = [
  { venueId: 'v1', weekday: FRI, startMin: 8 * 60, endMin: 25 * 60 }, // 08:00 → 01:00
];

describe('formats par sport', () => {
  it('un terrain de padel ne propose pas de 11v11', () => {
    expect(validateFieldFormats('PADEL', ['SIMPLE', 'DOUBLE']).ok).toBe(true);
    expect(validateFieldFormats('PADEL', ['11v11']).ok).toBe(false);
    expect(validateFieldFormats('FOOTBALL', []).ok).toBe(false);
    expect(SPORT_FORMATS.BASKET).toContain('3v3');
  });
});

describe('horaires d’ouverture', () => {
  it('accepte 08:00 → 01:00, refuse l’incohérent', () => {
    expect(validateOpeningHours({ startMin: 480, endMin: 1500 }).ok).toBe(true);
    expect(validateOpeningHours({ startMin: 480, endMin: 480 }).ok).toBe(false);
    expect(validateOpeningHours({ startMin: 1500, endMin: 1600 }).ok).toBe(false);
    expect(validateOpeningHours({ startMin: 480, endMin: 3000 }).ok).toBe(false);
  });
});

describe('tarification pleine / creuse', () => {
  it('la bonne bande à la bonne minute — minuit repasse en creuse', () => {
    expect(rateAt([peak], base, FRI, 17 * 60, '5v5').amount).toBe(2500);
    expect(rateAt([peak], base, FRI, 18 * 60, '5v5').amount).toBe(3000);
    expect(rateAt([peak], base, FRI, 23 * 60 + 59, '5v5').amount).toBe(3000);
    expect(rateAt([peak], base, FRI, 24 * 60, '5v5').amount).toBe(2500); // 00:00 = samedi, hors bande
  });
  it('devis au prorata : 17:30 → 19:00 = 30 min creuse + 60 min pleine', () => {
    const q = quoteRange([peak], base, FRI, 17 * 60 + 30, 19 * 60, '5v5');
    expect(q.total.amount).toBe(1250 + 3000);         // 4 250 DA
    expect(q.bands.length).toBe(2);
    expect(q.bands[0]!.amount).toBe(1250);
    expect(q.bands[1]!.rate.amount).toBe(3000);
  });
  it('un créneau entièrement en bande unique ne produit qu’une bande', () => {
    const q = quoteRange([peak], base, FRI, 20 * 60, 21 * 60 + 30, '5v5');
    expect(q.bands.length).toBe(1);
    expect(q.total.amount).toBe(4500);
  });
  /* 16/09/2026, demande d'Aymen : le prix dépend du format à tout moment, y
     compris aux heures pleines — une règle d'un AUTRE format ne doit jamais
     s'appliquer, même si sa plage horaire correspond exactement. */
  it('prix par format : une bande définie pour 5v5 ne s’applique jamais à 6v6, même jour/heure identiques', () => {
    const base6v6 = perHour(3200); // tarif de base propre au 6v6, différent du 5v5 (2500)
    expect(rateAt([peak], base6v6, FRI, 18 * 60, '6v6').amount).toBe(3200); // pas 3000 (règle 5v5 ignorée)
    const q = quoteRange([peak], base6v6, FRI, 18 * 60, 19 * 60, '6v6');
    expect(q.total.amount).toBe(3200); // tarif de base 6v6, la bande "5v5" n'a pas compté
    expect(q.bands.length).toBe(1);
  });
  it('deux règles, une par format, sur la même plage : chacune son propre tarif', () => {
    const peak6v6: PricingRule = { ...peak, format: '6v6', rate: perHour(3800) };
    const rules = [peak, peak6v6];
    expect(rateAt(rules, base, FRI, 18 * 60, '5v5').amount).toBe(3000);
    expect(rateAt(rules, perHour(3200), FRI, 18 * 60, '6v6').amount).toBe(3800);
  });
});

describe('abonnements récurrents', () => {
  const rec: RecurringBooking = {
    id: 'r1', fieldId: 'f1', weekday: FRI, startMin: 20 * 60, durationMin: 90,
    holderName: 'FC Kahwa', activeFrom: DAY0 - 30 * 86400_000, status: 'ACTIVE',
  };
  it('tombe le bon jour, pas les autres, et respecte sa période', () => {
    expect(recurringOccurrence(rec, FRI, DAY0)).not.toBeNull();
    expect(recurringOccurrence(rec, (FRI + 1) % 7, DAY0)).toBeNull();
    expect(recurringOccurrence({ ...rec, status: 'ENDED' }, FRI, DAY0)).toBeNull();
    expect(recurringOccurrence({ ...rec, activeUntil: DAY0 - 1 }, FRI, DAY0)).toBeNull();
  });
  it('bloque la disponibilité comme une réservation', () => {
    const av = fieldAvailability({
      field: { id: 'f1', hourlyRate: base }, hours, rules: [peak],
      weekday: FRI, dayStartMs: DAY0, durationMin: 90, format: '5v5', blockers: [], recurring: [rec],
    });
    const starts = av.map((s) => s.startMin);
    expect(starts).not.toContain(20 * 60);       // pris par l'abonnement
    expect(starts).not.toContain(19 * 60);       // 19:00+90 chevauche 20:00
    expect(starts).toContain(18 * 60 + 30);      // 18:30 → 20:00, contigu : libre
    expect(starts).toContain(21 * 60 + 30);      // reprend juste après
  });
});

describe('moteur de disponibilité', () => {
  it('respecte ouverture, durée, pas, blocages — et chiffre chaque départ', () => {
    const bookings = [{ start: DAY0 + 21 * 60 * MIN, end: DAY0 + (22 * 60 + 30) * MIN }];
    const av = fieldAvailability({
      field: { id: 'f1', hourlyRate: base }, hours, rules: [peak],
      weekday: FRI, dayStartMs: DAY0, durationMin: 60, format: '5v5', blockers: bookings,
    });
    const starts = av.map((s) => s.startMin);
    expect(Math.min(...starts)).toBe(8 * 60);                    // premier départ à l'ouverture
    expect(Math.max(...starts)).toBe(24 * 60);                   // minuit → 01:00, dernier possible
    expect(starts).not.toContain(21 * 60);                       // réservé
    expect(starts).not.toContain(20 * 60 + 30);                  // chevauche 21:00
    expect(starts.every((s, i, a) => i === 0 || s - a[i - 1]! >= SLOT_STEP_MIN)).toBe(true);
    const midnight = av.find((s) => s.startMin === 24 * 60)!;
    expect(midnight.quote.total.amount).toBe(2500);              // minuit = tarif creuse
    const nine = av.find((s) => s.startMin === 20 * 60)!;
    expect(nine.quote.total.amount).toBe(3000);                  // 20:00 = pleine
  });
  it('une durée plus longue offre moins de départs', () => {
    const p = { field: { id: 'f1', hourlyRate: base }, hours, rules: [peak], weekday: FRI, dayStartMs: DAY0, format: '5v5' as const, blockers: [] as { start: number; end: number }[] };
    const n60 = fieldAvailability({ ...p, durationMin: 60 }).length;
    const n120 = fieldAvailability({ ...p, durationMin: 120 }).length;
    expect(n120).toBeLessThan(n60);
  });
});
