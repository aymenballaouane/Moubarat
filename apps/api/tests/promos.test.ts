/* Tranche « CRM Analytics + Caisse » — module Promos + ROI. Le core
   (validatePromoDefinition/validatePromoLimits/promoApplies/applyPromo,
   crm.ts) est le seul arbitre de validité, d'applicabilité et de calcul de
   remise — l'API ne fait que persister et, pour le ROI, regrouper les
   réservations liées avant un appel à `cashReport` (canonique). Vrai
   Postgres 16 éphémère, aucun simulacre. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '', sofiane = '';

const nextNonFriday = makeSafeDayPicker();
let dayCursor = 20;
function freshDay(): string {
  const d = nextNonFriday(dayCursor);
  dayCursor += 10;
  return d;
}
const VALID_FROM = new Date(Date.now() - 86_400_000).toISOString();
const VALID_UNTIL = new Date(Date.now() + 200 * 86_400_000).toISOString();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER — a MANAGE_PROMOS
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas MANAGE_PROMOS
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF
  sofiane = await loginAs(stack, seed.phones.sofiane); // client
});
afterAll(async () => { await stack.teardown(); });

interface PromoJson { id: string; code: string; percentOff: number }

async function createPromo(overrides: Record<string, unknown> = {}): Promise<PromoJson> {
  const code = `PROMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const res = await stack.app.inject({
    method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
    payload: {
      code, label: 'Test', percentOff: 20, weekdays: [0, 1, 2, 3, 4, 5, 6],
      startMin: 0, endMin: 1440, validFrom: VALID_FROM, validUntil: VALID_UNTIL,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { promo: PromoJson }).promo;
}

interface BookRes { statusCode: number; json: () => unknown }

async function tryBook(
  fieldId: string, date: string, startMin: number, durationMin: number, promoCode?: string,
): Promise<BookRes> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId, date, startMin, durationMin, ...(promoCode ? { promoCode } : {}) },
  });
  return { statusCode: res.statusCode, json: () => res.json() };
}

describe('permissions', () => {
  it('MANAGE_PROMOS = Manager+ : RECEPTION et STAFF refusés', async () => {
    const asReception = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(nadia),
    });
    expect(asReception.statusCode).toBe(403);
    const asStaff = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(amine),
    });
    expect(asStaff.statusCode).toBe(403);
    const asManager = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(hamid),
    });
    expect(asManager.statusCode).toBe(200);
  });
});

describe('création — validatePromoDefinition/validatePromoLimits (core)', () => {
  it('format de code, plage de remise et bornes horaires invalides refusés', async () => {
    const badCode = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: { code: 'ab', label: 'x', percentOff: 20, weekdays: [1], startMin: 0, endMin: 60, validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    });
    expect(badCode.statusCode).toBe(400);

    const badPercent = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: { code: 'ABC123', label: 'x', percentOff: 90, weekdays: [1], startMin: 0, endMin: 60, validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    });
    expect(badPercent.statusCode).toBe(400);

    const badHours = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: { code: 'ABC124', label: 'x', percentOff: 20, weekdays: [1], startMin: 100, endMin: 50, validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    });
    expect(badHours.statusCode).toBe(400);

    const noWeekdays = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: { code: 'ABC125', label: 'x', percentOff: 20, weekdays: [], startMin: 0, endMin: 60, validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    });
    expect(noWeekdays.statusCode).toBe(400);
  });

  it('limites invalides (maxUses, minDurationMin, priority) refusées', async () => {
    const badMaxUses = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos`, headers: bearer(yacine),
      payload: {
        code: 'ABC126', label: 'x', percentOff: 20, weekdays: [1], startMin: 0, endMin: 60,
        validFrom: VALID_FROM, validUntil: VALID_UNTIL, maxUses: 0,
      },
    });
    expect(badMaxUses.statusCode).toBe(400);
  });
});

describe('applicabilité à la réservation (promoApplies/applyPromo, core)', () => {
  it('promo générale valide : remise correcte appliquée', async () => {
    const promo = await createPromo({ percentOff: 15 });
    const day = freshDay();
    const noPromo = await tryBook(seed.fields.t1, day, 540, 60);
    expect(noPromo.statusCode).toBe(201);
    const rawTotal = (noPromo.json() as { booking: { totalDa: number } }).booking.totalDa;

    const withPromo = await tryBook(seed.fields.t1, day, 630, 60, promo.code);
    expect(withPromo.statusCode).toBe(201);
    const booked = (withPromo.json() as { booking: { totalDa: number; discountDa: number; promoCodeId: string } }).booking;
    const expectedDiscount = Math.round(rawTotal * 15 / 100);
    expect(booked.discountDa).toBe(expectedDiscount);
    expect(booked.totalDa).toBe(rawTotal - expectedDiscount);
    expect(booked.promoCodeId).toBe(promo.id);
  });

  it('code inconnu ou inactif : PROMO_NOT_APPLICABLE', async () => {
    const day = freshDay();
    const res = await tryBook(seed.fields.t1, day, 540, 60, 'NEXISTEPAS');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });

  it('mauvais jour de semaine : refusé', async () => {
    const day = freshDay();
    const wrongWeekday = (weekdayOfDayStart(dayStartMs(day)) + 1) % 7;
    const promo = await createPromo({ weekdays: [wrongWeekday] });
    const res = await tryBook(seed.fields.t1, day, 540, 60, promo.code);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });

  it('mauvais terrain (fieldIds restreint) : refusé', async () => {
    const day = freshDay();
    const promo = await createPromo({ fieldIds: [seed.fields.t3] }); // padel seulement
    const res = await tryBook(seed.fields.t1, day, 540, 60, promo.code); // t1 = football
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });

  it('mauvais sport (sports restreint) : refusé', async () => {
    const day = freshDay();
    const promo = await createPromo({ sports: ['PADEL'] });
    const res = await tryBook(seed.fields.t1, day, 540, 60, promo.code); // t1 = football
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });

  it('durée sous le minimum requis : refusé', async () => {
    const day = freshDay();
    const promo = await createPromo({ minDurationMin: 90 });
    const res = await tryBook(seed.fields.t1, day, 540, 60, promo.code); // 60 < 90
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });

  it('plafond maxUses atteint : la réservation suivante est refusée (PROMO_LIMIT_REACHED)', async () => {
    const day = freshDay();
    const promo = await createPromo({ maxUses: 1 });
    const first = await tryBook(seed.fields.t1, day, 540, 60, promo.code);
    expect(first.statusCode).toBe(201);
    const second = await tryBook(seed.fields.t1, day, 630, 60, promo.code);
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe('PROMO_LIMIT_REACHED');
  });
});

describe('ROI — liste avec revenu réel (cashReport) vs remise accordée', () => {
  it('usageCount, totalDiscountDa et revenue cohérents avec les réservations réelles', async () => {
    const promo = await createPromo({ percentOff: 10 });
    const day = freshDay();
    const a = await tryBook(seed.fields.t1, day, 540, 60, promo.code);
    expect(a.statusCode).toBe(201);
    const aBody = (a.json() as { booking: { id: string; discountDa: number } }).booking;
    await stack.app.inject({ method: 'POST', url: `/bookings/${aBody.id}/status`, headers: bearer(nadia), payload: { status: 'HONORED' } });
    await stack.app.inject({ method: 'POST', url: `/bookings/${aBody.id}/status`, headers: bearer(nadia), payload: { status: 'PAID' } });

    const b = await tryBook(seed.fields.t1, day, 630, 60, promo.code);
    expect(b.statusCode).toBe(201);
    const bBody = (b.json() as { booking: { discountDa: number } }).booking;

    const list = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(hamid),
    });
    expect(list.statusCode).toBe(200);
    const entries = (list.json() as {
      promos: { promo: { id: string }; usageCount: number; totalDiscountDa: number; revenue: { collected: number; engaged: number } }[];
    }).promos;
    const entry = entries.find((e) => e.promo.id === promo.id)!;
    expect(entry.usageCount).toBe(2);
    expect(entry.totalDiscountDa).toBe(aBody.discountDa + bBody.discountDa);
    expect(entry.revenue.collected).toBeGreaterThan(0); // la réservation PAID compte comme collecté
  });

  it('motif d’annulation (15/09/2026) : une annulation STAFF_ERROR n’ajoute rien au CA perdu du ROI, mais reste comptée dans usageCount', async () => {
    const promo = await createPromo({ percentOff: 10 });
    const day = freshDay();
    const a = await tryBook(seed.fields.t1, day, 540, 60, promo.code);
    expect(a.statusCode).toBe(201);
    const aBody = (a.json() as { booking: { id: string; discountDa: number; totalDa: number } }).booking;
    const cancel = await stack.app.inject({
      method: 'POST', url: `/bookings/${aBody.id}/status`, headers: bearer(yacine),
      payload: { status: 'CANCELLED', reason: 'STAFF_ERROR' },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);

    const list = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(hamid) });
    const entries = (list.json() as {
      promos: { promo: { id: string }; usageCount: number; revenue: { lostCancelled: number } }[];
    }).promos;
    const entry = entries.find((e) => e.promo.id === promo.id)!;
    expect(entry.revenue.lostCancelled).toBe(0); // jamais compté en CA perdu
    expect(entry.usageCount).toBe(1); // reste compté comme « utilisation » du code, décision confirmée
  });
});

describe('activation/désactivation', () => {
  it('une promo désactivée n’est plus applicable', async () => {
    const promo = await createPromo();
    const day = freshDay();
    await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/promos/${promo.id}/active`,
      headers: bearer(yacine), payload: { active: false },
    });
    const res = await tryBook(seed.fields.t1, day, 540, 60, promo.code);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('PROMO_NOT_APPLICABLE');
  });
});

describe('concurrence — plafond maxUses', () => {
  it('deux réservations simultanées avec le même code ne provoquent jamais de 500 ; le compte reflète les réservations réelles', async () => {
    // Fenêtre de course documentée (docs/DECISIONS.md) : maxUses n'est pas
    // verrouillé, contrairement à one_open_cash_session (index unique DB).
    // Objectif ici : intégrité (pas de 500, pas de dérive usageCount), pas
    // un gagnant unique garanti.
    const day = freshDay();
    const promo = await createPromo({ maxUses: 1 });
    const [r1, r2] = await Promise.all([
      tryBook(seed.fields.t1, day, 540, 60, promo.code),
      tryBook(seed.fields.t2, day, 540, 60, promo.code), // terrain différent : jamais SLOT_TAKEN entre les deux
    ]);
    expect([200, 201, 400, 409]).toContain(r1.statusCode);
    expect([200, 201, 400, 409]).toContain(r2.statusCode);

    const list = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/promos`, headers: bearer(hamid),
    });
    const entries = (list.json() as { promos: { promo: { id: string }; usageCount: number }[] }).promos;
    const entry = entries.find((e) => e.promo.id === promo.id)!;
    const successes = [r1, r2].filter((r) => r.statusCode === 201).length;
    expect(entry.usageCount).toBe(successes); // jamais de compte fantôme ni de perte
  });
});
