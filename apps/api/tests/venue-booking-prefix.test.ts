import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { createPlatformAccount } from '../src/platform/auth/routes.js';

/* Audit multi-centre 22/09/2026 (finding F1, décision Aymen) — le préfixe des références de réservation
   (« COM » → « COM-000482 ») est un code FIXE attribué à la création (`venues.booking_prefix`), jamais
   retouché ensuite. Ce fichier couvre la création : dérivation automatique, collision absorbée
   automatiquement (fenêtre glissante), code explicite, immutabilité après coup. */

let stack: TestStack;
let superToken = '';

beforeAll(async () => {
  stack = await setupTestStack();
  await createPlatformAccount(stack.db, {
    email: 'admin.prefix@moubarat.test', password: 'CorrectHorseBattery9!', name: 'SUPERADMIN', isSuperadmin: true,
  });
  superToken = await loginAsPlatform(stack, 'admin.prefix@moubarat.test', 'CorrectHorseBattery9!');
});
afterAll(() => stack.teardown());

async function createVenue(body: Record<string, unknown>) {
  return stack.app.inject({
    method: 'POST', url: '/platform/venues', headers: bearer(superToken),
    payload: { wilaya: 'Alger', address: 'Adresse test', lat: 36.7, lng: 3.0, ...body },
  });
}

describe('création d’un centre — préfixe des références (F1, 22/09/2026)', () => {
  it('dérivé automatiquement du nom (3 premières lettres), exposé dans la réponse et sur la fiche', async () => {
    const res = await createVenue({ name: 'Terrain Prefix Auto' });
    expect(res.statusCode, res.body).toBe(201);
    const venue = (res.json() as { venue: { id: string; bookingPrefix: string } }).venue;
    expect(venue.bookingPrefix).toBe('TER');

    const detail = await stack.app.inject({ method: 'GET', url: `/platform/venues/${venue.id}`, headers: bearer(superToken) });
    expect((detail.json() as { venue: { bookingPrefix: string } }).venue.bookingPrefix).toBe('TER');
  });

  it('deux centres au même nom : le second reçoit AUTOMATIQUEMENT le candidat suivant (fenêtre glissante), sans erreur ni saisie', async () => {
    const first = await createVenue({ name: 'Prefix Collision Auto' });
    expect((first.json() as { venue: { bookingPrefix: string } }).venue.bookingPrefix).toBe('PRE');

    const second = await createVenue({ name: 'Prefix Collision Auto' }); // même nom exact
    expect(second.statusCode, second.body).toBe(201);
    const secondPrefix = (second.json() as { venue: { bookingPrefix: string } }).venue.bookingPrefix;
    expect(secondPrefix).not.toBe('PRE');
    expect(secondPrefix).toBe('REF'); // fenêtre suivante de « PREFIXCOLLISIONAUTO »
  });

  it('code explicite valide (3 lettres, minuscules acceptées puis normalisées) : utilisé tel quel', async () => {
    const res = await createVenue({ name: 'Un Nom Sans Rapport', bookingPrefix: 'xyz' });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { venue: { bookingPrefix: string } }).venue.bookingPrefix).toBe('XYZ');
  });

  it('code explicite déjà pris : 409 BOOKING_PREFIX_TAKEN, aucun centre créé', async () => {
    await createVenue({ name: 'Premier ABC', bookingPrefix: 'ABC' });
    const before = await stack.db.selectFrom('venues').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();

    const res = await createVenue({ name: 'Second qui veut ABC', bookingPrefix: 'ABC' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('BOOKING_PREFIX_TAKEN');

    const after = await stack.db.selectFrom('venues').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it.each([
    ['2 lettres', 'AB'], ['4 lettres', 'ABCD'], ['avec un chiffre', 'A1C'], ['avec un tiret', 'A-C'], ['vide', ''],
  ])('code explicite invalide (%s) → 400, jamais une dérivation silencieuse à la place', async (_label, bookingPrefix) => {
    const res = await createVenue({ name: 'Nom Quelconque', bookingPrefix });
    expect(res.statusCode).toBe(400);
  });

  it('nom sans assez de lettres (ex. « K2 ») : complété par des X, jamais un crash', async () => {
    const res = await createVenue({ name: 'K2' });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { venue: { bookingPrefix: string } }).venue.bookingPrefix).toBe('KXX');
  });

  it('immuable : PATCH /platform/venues/:id ignore silencieusement un bookingPrefix envoyé dans le corps', async () => {
    const created = await createVenue({ name: 'Centre Immuable' });
    const venueId = (created.json() as { venue: { id: string } }).venue.id;

    const patch = await stack.app.inject({
      method: 'PATCH', url: `/platform/venues/${venueId}`, headers: bearer(superToken),
      payload: { name: 'Centre Immuable Renommé', bookingPrefix: 'ZZZ' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const row = await stack.db.selectFrom('venues').select(['name', 'booking_prefix']).where('id', '=', venueId).executeTakeFirstOrThrow();
    expect(row.name).toBe('Centre Immuable Renommé');
    expect(row.booking_prefix).toBe('CEN'); // inchangé malgré le renommage et malgré bookingPrefix dans le corps
  });
});
