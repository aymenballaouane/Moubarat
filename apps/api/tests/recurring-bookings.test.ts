/* Chantier CRM Abonnements (06/09/2026). `recurring_bookings` existait déjà
   (schéma gelé, moteur de blocage core) — ce module ajoute les seules routes
   qui manquaient : lister/créer/résilier. Portée strictement égale à l'écran
   (créneau hebdomadaire daté + résiliation), jamais séances/paiement. Vrai
   Postgres 16 éphémère. Le seed pose déjà 2 abonnements (FC Kahwa, mardi
   20:00, T1 ; Ooredoo, dimanche 17:00, T2) — utilisés ici pour le test de
   conflit entre abonnements, jamais recréés par erreur ailleurs (weekdays
   Lun/Mer/Jeu réservés aux tests neutres). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '', sofiane = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER — a MANAGE_SUBSCRIPTIONS
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas MANAGE_SUBSCRIPTIONS
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF
  sofiane = await loginAs(stack, seed.phones.sofiane); // joueur, pas staff du centre
});
afterAll(() => stack.teardown());

/** Prochaine date (à partir de `minDaysOut`) qui tombe un jour de semaine
    donné (0=dimanche…6=samedi) — pour construire un conflit ponctuel réel
    sur un motif hebdomadaire précis. */
function nextWeekday(target: number, minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 8; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
  }
  throw new Error('unreachable');
}

function freshBody(overrides: Partial<{
  fieldId: string; weekday: number; startMin: number; durationMin: number; holderName: string;
  activeFrom: string; activeUntil: string;
}> = {}) {
  return {
    fieldId: seed.fields.t3, weekday: 1, startMin: 600, durationMin: 90,
    holderName: 'Club Test', activeFrom: algiersDateOf(Date.now() - 86_400_000),
    ...overrides,
  };
}

describe('permissions', () => {
  it('RECEPTION et STAFF refusés (MANAGE_SUBSCRIPTIONS = Manager+), non-membre et joueur refusés aussi', async () => {
    const asReception = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(nadia) });
    expect(asReception.statusCode).toBe(403);
    const asStaff = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(amine) });
    expect(asStaff.statusCode).toBe(403);
    const asPlayer = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(sofiane) });
    expect(asPlayer.statusCode).toBe(401);
    const asManager = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(yacine) });
    expect(asManager.statusCode).toBe(200);
  });

  it('isolation entre centres : terrain d’un autre centre refusé à la création (404, jamais un centre A qui écrit chez B)', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test abonnements)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: otherVenue.id, name: 'TX', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    });

    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ fieldId: otherField.id }),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('création', () => {
  it('validations : champs manquants/hors bornes rejetés (400), jamais une règle de format recodée en silence', async () => {
    const missingField = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: { ...freshBody(), fieldId: undefined },
    });
    expect(missingField.statusCode).toBe(400);

    const badWeekday = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ weekday: 9 }),
    });
    expect(badWeekday.statusCode).toBe(400);

    const badDuration = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ durationMin: 10 }),
    });
    expect(badDuration.statusCode).toBe(400);

    const endBeforeStart = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ activeUntil: algiersDateOf(Date.now() - 200 * 86_400_000) }),
    });
    expect(endBeforeStart.statusCode).toBe(400);
  });

  it('création réussie (201), audit SUBSCRIPTION_CHANGED écrit', async () => {
    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ weekday: 3, holderName: 'Créneau Mercredi' }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const sub = (res.json() as { subscription: { id: string; holderName: string; fieldName: string; status: string } }).subscription;
    expect(sub.holderName).toBe('Créneau Mercredi');
    expect(sub.fieldName).toBe('T3');
    expect(sub.status).toBe('ACTIVE');

    const audit = await stack.db.selectFrom('audit_log')
      .selectAll().where('object_id', '=', sub.id).where('action', '=', 'SUBSCRIPTION_CHANGED').executeTakeFirst();
    expect(audit).toBeDefined();
    expect(audit?.summary).toContain('Créneau Mercredi');
  });

  it('conflit avec un abonnement déjà actif (même terrain/jour, chevauchement) — 409, jamais une résolution automatique', async () => {
    // Le seed pose FC Kahwa : mardi (2), T1, 20:00 (1200 min), 90 min.
    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ fieldId: seed.fields.t1, weekday: 2, startMin: 1230, durationMin: 60 }), // chevauche 1200-1290
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('conflit avec une réservation ponctuelle réelle déjà existante sur une occurrence future du motif — 409', async () => {
    const day = nextWeekday(4, 30); // un jeudi, loin de tout autre test de ce fichier
    const weekday = weekdayOfDayStart(dayStartMs(day));
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t2, date: day, startMin: 900, durationMin: 60 },
    });
    expect(bk.statusCode, bk.body).toBe(201);

    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ fieldId: seed.fields.t2, weekday, startMin: 900, durationMin: 60 }),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SLOT_TAKEN');
  });

  it('conflit ponctuel : la durée comparée est celle de la résa EXISTANTE (audit 07/09, T5) — inclusion refusée, motif long après la résa accepté', async () => {
    const day = nextWeekday(5, 30); // un vendredi, T3 : aucun autre test de ce fichier n'y pose de motif
    const weekday = weekdayOfDayStart(dayStartMs(day));

    // (a) Résa de 120 min (15:00–17:00) ; un motif de 60 min posé à 16:30, en
    // plein dedans, mais qui commence APRÈS 15:00 + 60 min : avant le correctif,
    // la résa était comparée comme si elle durait 60 min → aucun conflit détecté.
    const longBooking = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date: day, startMin: 900, durationMin: 120 },
    });
    expect(longBooking.statusCode, longBooking.body).toBe(201);
    const inside = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ fieldId: seed.fields.t3, weekday, startMin: 990, durationMin: 60 }),
    });
    expect(inside.statusCode, inside.body).toBe(409);
    expect((inside.json() as { error: string }).error).toBe('SLOT_TAKEN');

    // (b) Résa de 60 min (18:00–19:00) ; un motif de 120 min qui commence à
    // 19:00 pile : aucun chevauchement réel. Avant le correctif, la résa était
    // comparée comme si elle durait 120 min (jusqu'à 20:00) → faux refus.
    const shortBooking = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date: day, startMin: 1080, durationMin: 60 },
    });
    expect(shortBooking.statusCode, shortBooking.body).toBe(201);
    const after = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ fieldId: seed.fields.t3, weekday, startMin: 1140, durationMin: 120, holderName: 'Après la résa' }),
    });
    expect(after.statusCode, after.body).toBe(201);
  });
});

describe('résiliation', () => {
  it('résilie (status ENDED, jamais une suppression), audit écrit, second appel refusé (409)', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: freshBody({ weekday: 4, holderName: 'À résilier' }),
    });
    const subId = (created.json() as { subscription: { id: string } }).subscription.id;

    const ended = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings/${subId}/end`, headers: bearer(yacine),
    });
    expect(ended.statusCode, ended.body).toBe(200);
    expect((ended.json() as { subscription: { status: string } }).subscription.status).toBe('ENDED');

    const stillThere = await stack.db.selectFrom('recurring_bookings').selectAll().where('id', '=', subId).executeTakeFirst();
    expect(stillThere).toBeDefined(); // jamais supprimé

    const audit = await stack.db.selectFrom('audit_log')
      .selectAll().where('object_id', '=', subId).where('action', '=', 'SUBSCRIPTION_CHANGED')
      .orderBy('at', 'desc').executeTakeFirst();
    expect(audit?.summary).toContain('résilié');

    const again = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings/${subId}/end`, headers: bearer(yacine),
    });
    expect(again.statusCode).toBe(409);
  });

  it('isolation entre centres : résilier l’abonnement d’un autre centre refusé (404)', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test résiliation)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: otherVenue.id, name: 'TX', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    });
    const otherSub = await stack.db.insertInto('recurring_bookings').values({
      field_id: otherField.id, weekday: 1, start_min: 600, duration_min: 90,
      holder_name: 'Autre centre', active_from: new Date(Date.now() - 86_400_000),
    }).returning('id').executeTakeFirstOrThrow();

    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings/${otherSub.id}/end`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(404);
  });
});
