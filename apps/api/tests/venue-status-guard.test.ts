/* Audit 07-09/09/2026 (I1) — le garde-fou « centre suspendu ne vend plus »
   lisait `venues.active`, colonne morte depuis la migration 0007 : un centre
   PENDING jamais validé, SUSPENDED ou REJECTED continuait de vendre des
   créneaux à qui connaissait un identifiant de terrain (cache de l'app, lien
   partagé). Ici : les trois statuts, sur la route publique de disponibilité ET
   sur la création de réservation, avec un fieldId déjà connu et déjà utilisé
   avec succès avant la suspension. Le comptoir du centre (WALK_IN, compte
   rattaché) reste servi : décision produit I5 du 08/09/2026, l'accès CRM est
   séparé du statut public. Vrai Postgres 16 éphémère. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';
import { algiersDateOf } from '../src/lib/algiers.js';

let stack: TestStack;
let seed: SeedResult;
let admin = '';   // superadmin de test
let sofiane = ''; // joueur
let hamid = '';   // compte plateforme de démo, rattaché aux centres de test comme OWNER
const day = algiersDateOf(Date.now() + 10 * 86_400_000);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  await createPlatformAccount(stack.db, { email: 'admin-i1@moubarat.local', password: 'AdminI1Pass2026!', name: 'Admin I1', isSuperadmin: true });
  admin = await loginAsPlatform(stack, 'admin-i1@moubarat.local', 'AdminI1Pass2026!');
  sofiane = await loginAs(stack, seed.phones.sofiane);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
});
afterAll(() => stack.teardown());

/** Un centre créé par le vrai chemin superadmin (donc PENDING), avec un terrain,
    des horaires, et Hamid rattaché en OWNER pour pouvoir tester le comptoir. */
async function createVenueWithField(name: string): Promise<{ venueId: string; fieldId: string }> {
  const created = await stack.app.inject({
    method: 'POST', url: '/platform/venues', headers: bearer(admin),
    payload: { name, wilaya: 'Alger', address: 'Rue de test', lat: 36.75, lng: 3.06 },
  });
  expect(created.statusCode, created.body).toBe(201);
  const venueId = (created.json() as { venue: { id: string; status: string } }).venue.id;
  const field = await insertTestField(stack.db, {
    venue_id: venueId, name: 'TX', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
  });
  await stack.db.insertInto('opening_hours').values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: venueId, weekday, start_min: 480, end_min: 1380 })),
  ).execute();
  await stack.db.insertInto('center_staff').values({ venue_id: venueId, user_id: seed.crmStaff.hamid, role: 'OWNER' }).execute();
  return { venueId, fieldId: field.id };
}

const availability = (fieldId: string) => stack.app.inject({ method: 'GET', url: `/fields/${fieldId}/availability?date=${day}&duration=60` });
const bookAsPlayer = (fieldId: string, startMin: number) => stack.app.inject({
  method: 'POST', url: '/bookings', headers: bearer(sofiane),
  payload: { fieldId, date: day, startMin, durationMin: 60 },
});
const bookAtCounter = (fieldId: string, startMin: number) => stack.app.inject({
  method: 'POST', url: '/bookings', headers: bearer(hamid),
  payload: { fieldId, date: day, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Client comptoir' },
});
const transition = (venueId: string, action: 'approve' | 'suspend' | 'reject') => stack.app.inject({
  method: 'POST', url: `/platform/venues/${venueId}/${action}`, headers: bearer(admin),
});

describe('statut du centre et vente publique (audit I1)', () => {
  it('centre PENDING (jamais validé) : disponibilité et réservation joueur refusées (409), le comptoir du centre reste servi', async () => {
    const { fieldId } = await createVenueWithField('Centre en attente');

    const avail = await availability(fieldId);
    expect(avail.statusCode, avail.body).toBe(409);
    expect((avail.json() as { error: string }).error).toBe('INVALID_TARGET');

    const player = await bookAsPlayer(fieldId, 720);
    expect(player.statusCode, player.body).toBe(409);
    expect((player.json() as { error: string }).error).toBe('INVALID_TARGET');

    const counter = await bookAtCounter(fieldId, 600);
    expect(counter.statusCode, counter.body).toBe(201); // décision I5 : le CRM ne dépend pas du statut public
  });

  it('centre validé puis SUSPENDU : un fieldId déjà connu et déjà réservé avec succès ne vend plus rien après la suspension', async () => {
    const { venueId, fieldId } = await createVenueWithField('Centre suspendu ensuite');
    expect((await transition(venueId, 'approve')).statusCode).toBe(200);

    // Contrôle positif : ACTIVE, tout fonctionne — c'est ainsi que l'app a « appris » ce fieldId.
    const availOk = await availability(fieldId);
    expect(availOk.statusCode, availOk.body).toBe(200);
    expect((availOk.json() as { starts: unknown[] }).starts.length).toBeGreaterThan(0);
    const bookedBefore = await bookAsPlayer(fieldId, 720);
    expect(bookedBefore.statusCode, bookedBefore.body).toBe(201);

    expect((await transition(venueId, 'suspend')).statusCode).toBe(200);

    const availAfter = await availability(fieldId);
    expect(availAfter.statusCode, availAfter.body).toBe(409);
    const bookedAfter = await bookAsPlayer(fieldId, 840); // même fieldId, créneau libre
    expect(bookedAfter.statusCode, bookedAfter.body).toBe(409);
    expect((bookedAfter.json() as { error: string }).error).toBe('INVALID_TARGET');

    // La réservation prise avant la suspension n'est pas touchée par le refus.
    const before = (bookedBefore.json() as { booking: { id: string } }).booking.id;
    const still = await stack.db.selectFrom('bookings').select('status').where('id', '=', before).executeTakeFirstOrThrow();
    expect(still.status).toBe('RESERVED');
  });

  it('centre REJETÉ : disponibilité et réservation joueur refusées (409)', async () => {
    const { venueId, fieldId } = await createVenueWithField('Centre refusé');
    expect((await transition(venueId, 'reject')).statusCode).toBe(200);

    const avail = await availability(fieldId);
    expect(avail.statusCode, avail.body).toBe(409);
    const player = await bookAsPlayer(fieldId, 720);
    expect(player.statusCode, player.body).toBe(409);
    expect((player.json() as { error: string }).error).toBe('INVALID_TARGET');
  });

  it('non-régression : le centre du seed (ACTIVE) expose toujours ses créneaux', async () => {
    const avail = await availability(seed.fields.t3);
    expect(avail.statusCode, avail.body).toBe(200);
    expect((avail.json() as { venue: { id: string; name: string } }).venue).toEqual({ id: seed.venueId, name: 'Complexe Ryad' });
  });
});
