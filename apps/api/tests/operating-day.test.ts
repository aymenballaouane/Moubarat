import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { dayStartMs, operatingDateOf, operatingMinutesOfDay, operatingDayWindow } from '../src/lib/algiers.js';
import { makeSafeDayPicker, nextSafeDay, WEEKDAY } from './helpers/dates.js';

/* BUG-9 (audit pré-lancement, 27/09/2026) — la frontière de minuit. Un centre ferme à 01:00 : une réservation qui commence à
   00:00 (+1) appartient à la soirée de J, pas à J+1 ; une réservation 23:30 → 01:00 appartient à J seulement. Avant ce lot,
   le planning du CRM, Analytics et l'export découpaient par jour CIVIL et par recouvrement : invisible sur J, doublée sur J+1,
   comptée deux fois dans le CA de deux périodes, exportée datée du mauvais mois. Une seule définition (lib/algiers.ts,
   « jour d'exploitation » de 06:00 à 06:00), vérifiée ici sur les trois routes. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '';

/** Jamais un vendredi (T1 ouvre à 14:00), ni mardi/dimanche (abonnements du seed sur T1/T2). */
const cleanDay = makeSafeDayPicker([WEEKDAY.TUESDAY, WEEKDAY.SUNDAY]);
/* Chantier arabe RTL, lot 3 (20/10/2026) : nextDay() ajoutait un jour civil SANS revérifier le
   jour de semaine — cause du flake du 19/10/2026 (cleanDay(24) tombait un jeudi, nextDay()
   avançait sur le vendredi suivant où T1 ouvre à 14:00, pas 08:00 ; la réservation du test à
   10:00 sortait des horaires). nextSafeDay (outil partagé) évite le vendredi par défaut. */
const nextDay = (day: string) => nextSafeDay(day);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
});
afterAll(async () => { await stack.teardown(); });

async function walkIn(date: string, startMin: number, durationMin: number, fieldId = seed.fields.t1) {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(hamid),
    payload: { fieldId, date, startMin, durationMin, source: 'WALK_IN', reservationName: 'Client de nuit' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string; totalDa: number } }).booking;
}
async function dayBookings(date: string) {
  const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${date}`, headers: bearer(hamid) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { bookings: { id: string; start: number; end: number }[] }).bookings;
}
async function revenue(from: string, to: string) {
  const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/analytics/revenue?from=${from}&to=${to}`, headers: bearer(hamid) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { overall: { engaged: number } }).overall;
}

describe('lib/algiers — jour d’exploitation, une seule définition', () => {
  it('06:00 → 06:00 : 00:30 (+1) appartient à la veille, 05:59 aussi, 06:00 au jour même', () => {
    const J = dayStartMs('2026-10-05');
    expect(operatingDayWindow(J)).toEqual({ start: J + 6 * 3_600_000, end: J + 30 * 3_600_000 });
    expect(operatingDateOf(J + 24.5 * 3_600_000)).toBe('2026-10-05'); // 00:30 le 6 → soirée du 5
    expect(operatingDateOf(J + 29.99 * 3_600_000)).toBe('2026-10-05');
    expect(operatingDateOf(J + 30 * 3_600_000)).toBe('2026-10-06');
    expect(operatingMinutesOfDay(J + 24.5 * 3_600_000)).toBe(1470); // affiché « 00:30 (+1) »
    expect(operatingMinutesOfDay(J + 20 * 3_600_000)).toBe(1200);
  });
});

describe('GET /venues/:id/bookings — planning du jour d’exploitation', () => {
  it('00:00 (+1) apparaît sur SON jour (à 1 440 min), jamais sur le lendemain ; 23:30 → 01:00 sur un seul jour', async () => {
    const J = cleanDay(12);
    const midnight = await walkIn(J, 1440, 60);       // 00:00 → 01:00 (+1)
    const straddle = await walkIn(J, 1410, 90, seed.fields.t2); // 23:30 → 01:00 (+1), sur T2
    const onJ = await dayBookings(J);
    const onNext = await dayBookings(nextDay(J));
    const idsJ = onJ.map((b) => b.id);
    const idsNext = onNext.map((b) => b.id);
    expect(idsJ).toContain(midnight.id);
    expect(idsJ).toContain(straddle.id);
    expect(idsNext).not.toContain(midnight.id);
    expect(idsNext).not.toContain(straddle.id);
    // Le CRM projette startMin depuis le minuit civil de J : 1 440 et 1 410 (jamais 0 ni −30 sur le lendemain).
    const m = onJ.find((b) => b.id === midnight.id)!;
    expect(Math.round((m.start - dayStartMs(J)) / 60_000)).toBe(1440);
  });
});

describe('Analytics et export — une réservation de nuit compte une fois, dans la bonne période', () => {
  it('CA engagé : la nuit de J compte dans [J..J], pas dans [J+1..J+1] ; l’export la date de J avec « 00:00 (+1) »', async () => {
    const J = cleanDay(24);
    const K = nextDay(J);
    const night = await walkIn(J, 1440, 60);          // 00:00 → 01:00 (+1), 60 min
    const late = await walkIn(J, 1380, 90, seed.fields.t2);  // 23:00 → 00:30 (+1)
    const morningNext = await walkIn(K, 600, 60);     // 10:00 le lendemain — appartient à K

    const onlyJ = await revenue(J, J);
    const onlyK = await revenue(K, K);
    expect(onlyJ.engaged).toBe(night.totalDa + late.totalDa);
    expect(onlyK.engaged).toBe(morningNext.totalDa);
    // Et jamais deux fois sur une période qui couvre les deux jours.
    const both = await revenue(J, K);
    expect(both.engaged).toBe(night.totalDa + late.totalDa + morningNext.totalDa);

    const xlsx = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/analytics/export?from=${J}&to=${J}`, headers: bearer(hamid) });
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload);
    const sheet = wb.getWorksheet('Réservations')!;
    const rows: Record<string, string>[] = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const v = row.values as (string | number | undefined)[];
      rows.push({ reference: String(v[1] ?? ''), date: String(v[2] ?? ''), debut: String(v[3] ?? ''), fin: String(v[4] ?? '') });
    });
    const nightRow = rows.find((r) => r.debut === '00:00 (+1)');
    expect(nightRow).toBeDefined();
    expect(nightRow!.date).toBe(J);
    expect(nightRow!.fin).toBe('01:00 (+1)');
    const lateRow = rows.find((r) => r.debut === '23:00');
    expect(lateRow?.date).toBe(J);
    expect(lateRow?.fin).toBe('00:30 (+1)');
    // Le lendemain matin n'est PAS dans l'export de J.
    expect(rows.some((r) => r.date === K)).toBe(false);
  });
});
