import { describe, expect, it } from 'vitest';
import { availabilityStartsFromApi, type ApiAvailabilityResponse } from '../src/lib/mappers.js';

/* 16/09/2026 (demande d'Aymen) — un devis PAR FORMAT pour un même créneau ;
   « pleines » se juge contre le tarif de base DU FORMAT, jamais d'un autre. */

const band = (rate: number, amount: number, fromMin = 1080, toMin = 1140) => ({ fromMin, toMin, rateDaPerHour: rate, amountDa: amount });

const res: ApiAvailabilityResponse = {
  date: '2026-09-25', weekday: 5, durationMin: 60, stepMin: 30,
  field: {
    id: 'f', name: 'T3', sport: 'FOOTBALL', hourlyRateDa: 3000,
    formats: [{ format: '5v5', hourlyRateDa: 3000 }, { format: '6v6', hourlyRateDa: 3600 }],
  },
  venue: { id: 'v', name: 'Centre' },
  starts: [
    // 10:00 : chaque format à son tarif de base -> aucun n'est « plein ».
    { startMin: 600, label: '10:00', start: 0, end: 1, byFormat: [
      { format: '5v5', totalDa: 3000, bands: [band(3000, 3000, 600, 660)] },
      { format: '6v6', totalDa: 3600, bands: [band(3600, 3600, 600, 660)] },
    ] },
    // 19:00 : le 5v5 est en heures pleines (3500 > 3000), le 6v6 reste à sa base (3600).
    { startMin: 1140, label: '19:00', start: 0, end: 1, byFormat: [
      { format: '5v5', totalDa: 3500, bands: [band(3500, 3500)] },
      { format: '6v6', totalDa: 3600, bands: [band(3600, 3600)] },
    ] },
  ],
};

describe('availabilityStartsFromApi — devis par format', () => {
  const starts = availabilityStartsFromApi(res);

  it('un devis par format pour chaque départ, prix et bandes du format', () => {
    expect(starts.map((s) => s.byFormat.map((f) => [f.format, f.totalDa]))).toEqual([
      [['5v5', 3000], ['6v6', 3600]],
      [['5v5', 3500], ['6v6', 3600]],
    ]);
    expect(starts[1]!.byFormat[0]!.quote.total.amount).toBe(3500);
  });

  it('« pleine » est jugé contre le tarif de base DU FORMAT (3600 n’est pas « plein » pour le 6v6)', () => {
    expect(starts[0]!.byFormat.map((f) => f.peak)).toEqual([false, false]);
    expect(starts[1]!.byFormat.map((f) => f.peak)).toEqual([true, false]);
  });
});
