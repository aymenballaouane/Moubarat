/* Chantier CRM — écran Journal (06/09/2026). GET /venues/:venueId/audit-log
   lit la MÊME table `audit_log` que le journal plateforme
   (platform-audit.test.ts), filtrée par venue — aucune nouvelle écriture
   testée ici, seulement la lecture (permission, isolation, contenu réel déjà
   écrit par d'autres modules — WALK_IN, voir bookings/routes.ts). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { writeAudit } from '../src/audit/log.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '', sofiane = '';

/** Jamais un vendredi (horaires T1/T3 différents ce jour-là) — même garde
    que venue-bookings.test.ts. */
const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION — pas VIEW_AUDIT_LOG
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas VIEW_AUDIT_LOG
  sofiane = await loginAs(stack, seed.phones.sofiane); // joueur, pas staff du centre
});
afterAll(() => stack.teardown());

describe('permissions', () => {
  it('RECEPTION et STAFF refusés (VIEW_AUDIT_LOG = Manager+), non-membre et joueur refusés aussi', async () => {
    const asReception = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(nadia),
    });
    expect(asReception.statusCode).toBe(403);
    const asStaff = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(amine),
    });
    expect(asStaff.statusCode).toBe(403);
    // sofiane est un jeton Player, pas un compte plateforme — 401, pas 403.
    const asPlayer = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(sofiane),
    });
    expect(asPlayer.statusCode).toBe(401);
    const asManager = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(yacine),
    });
    expect(asManager.statusCode).toBe(200);
    const asOwner = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(hamid),
    });
    expect(asOwner.statusCode).toBe(200);
  });

  it('isolation entre centres : un compte du centre A interrogeant le centre B reçoit 403, jamais une liste vide silencieuse', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test audit)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    // hamid n'a AUCUNE ligne center_staff pour ce nouveau centre.
    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${otherVenue.id}/audit-log`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('contenu', () => {
  it('une action réelle (WALK_IN) apparaît, avec le nom réel de l’acteur résolu', async () => {
    const walkIn = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(nadia),
      payload: {
        fieldId: seed.fields.t3, format: 'DOUBLE', date: nextNonFriday(20), startMin: 540, durationMin: 60,
        source: 'WALK_IN', reservationName: 'Client Journal Test',
      },
    });
    expect(walkIn.statusCode, walkIn.body).toBe(201);
    const bookingRef = (walkIn.json() as { booking: { reference: string } }).booking.reference;

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(hamid),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { actorName: string; actorRole: string; summary: string }[] };
    const entry = body.entries.find((e) => e.summary.includes(bookingRef));
    expect(entry).toBeDefined();
    expect(entry?.actorName).toBe('Nadia Cherif');
    expect(entry?.actorRole).toBe('RECEPTION');
  });

  it('venue-scopé : une entrée écrite pour un AUTRE centre n’apparaît jamais ici', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test audit contenu)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    await writeAudit(stack.db, {
      venueId: otherVenue.id, actorId: seed.crmStaff.hamid, actorRole: 'OWNER',
      action: 'FIELD_CHANGED', objectType: 'field', objectId: 'field-test-isolation',
      summary: 'Ne doit JAMAIS apparaître dans le journal du centre pilote',
    });

    const res = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/audit-log`, headers: bearer(hamid),
    });
    const body = res.json() as { entries: { summary: string }[] };
    expect(body.entries.some((e) => e.summary.includes('Ne doit JAMAIS apparaître'))).toBe(false);
  });
});
