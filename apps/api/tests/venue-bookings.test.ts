import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Chantier CRM — Planning + Réservations (05/09/2026) : GET /venues/:venueId/bookings,
   seule route qui manquait aux deux écrans. Même garde que le reste du CRM
   (requireCenterAction), jamais le superadmin de /platform/bookings. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', amine = '', sofiane = '';

/** Même garde que teams-matches-challenges.test.ts : jamais un vendredi
    (horaires T1 différents ce jour-là). */
const nextNonFriday = makeSafeDayPicker();
const day1 = () => nextNonFriday(3);
const day2 = () => nextNonFriday(10);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER, centre pilote
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF, centre pilote
  sofiane = await loginAs(stack, seed.phones.sofiane);                                       // joueur, pas staff
  await stack.db.updateTable('venues').set({ status: 'ACTIVE' }).where('id', '=', seed.venueId).execute();
});
afterAll(() => stack.teardown());

async function createWalkIn(token: string, fieldId: string, startMin: number, date: string, name: string) {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(token),
    payload: { fieldId, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: name, ...(fieldId === seed.fields.t3 ? { format: 'DOUBLE' } : {}) },
  });
  if (res.statusCode !== 201) throw new Error(`Réservation comptoir refusée (${res.statusCode}) : ${res.body}`);
  return (res.json() as { booking: { id: string } }).booking;
}

describe('GET /venues/:venueId/bookings — Planning + Réservations', () => {
  it('liste les réservations du jour demandé, triées par heure, avec le terrain', async () => {
    const b1 = await createWalkIn(hamid, seed.fields.t2, 720, day1(), 'Test Planning A');
    const b2 = await createWalkIn(hamid, seed.fields.t2, 600, day1(), 'Test Planning B');

    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(hamid) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { bookings: { id: string; fieldId: string; fieldName: string; reservationName: string; start: number }[] };
    const ids = body.bookings.map((b) => b.id);
    expect(ids.indexOf(b2.id)).toBeLessThan(ids.indexOf(b1.id)); // 10:00 avant 12:00
    const row = body.bookings.find((b) => b.id === b1.id)!;
    expect(row.fieldId).toBe(seed.fields.t2);
    expect(row.fieldName).toBe('T2');
    expect(row.reservationName).toBe('Test Planning A');
  });

  it('filtre par date : une réservation d’un autre jour n’apparaît pas', async () => {
    const other = await createWalkIn(hamid, seed.fields.t1, 540, day2(), 'Autre jour');
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(hamid) });
    const ids = (res.json() as { bookings: { id: string }[] }).bookings.map((b) => b.id);
    expect(ids).not.toContain(other.id);
  });

  it('filtre par fieldId', async () => {
    const t1Booking = await createWalkIn(hamid, seed.fields.t1, 900, day1(), 'Sur Terrain Un');
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}&fieldId=${seed.fields.t1}`, headers: bearer(hamid) });
    const rows = (res.json() as { bookings: { id: string; fieldId: string }[] }).bookings;
    expect(rows.every((r) => r.fieldId === seed.fields.t1)).toBe(true);
    expect(rows.map((r) => r.id)).toContain(t1Booking.id);
  });

  it('date manquante ou invalide : 400', async () => {
    const noDate = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings`, headers: bearer(hamid) });
    expect(noDate.statusCode).toBe(400);
    const badDate = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=pas-une-date`, headers: bearer(hamid) });
    expect(badDate.statusCode).toBe(400);
  });

  it('permission : STAFF voit (VIEW_PLANNING accordée aux 4 rôles), un joueur ou une session absente sont refusés', async () => {
    const asStaff = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(amine) });
    expect(asStaff.statusCode).toBe(200);

    const asPlayer = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(sofiane) });
    expect(asPlayer.statusCode).toBe(401);

    const noAuth = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}` });
    expect(noAuth.statusCode).toBe(401);
  });

  it('isolation entre centres : un compte du centre A interrogeant le centre B reçoit 403, jamais une liste vide silencieuse', async () => {
    const otherVenue = await stack.db.insertInto('venues').values({
      name: 'Autre centre (test)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow();
    const otherField = await insertTestField(stack.db, {
      venue_id: otherVenue.id, name: 'TX', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
    });
    await stack.db.insertInto('opening_hours').values(
      Array.from({ length: 7 }, (_, weekday) => ({ venue_id: otherVenue.id, weekday, start_min: 0, end_min: 1440 })),
    ).execute();

    // hamid n'a AUCUNE ligne center_staff pour ce nouveau centre.
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${otherVenue.id}/bookings?date=${day1()}`, headers: bearer(hamid) });
    expect(res.statusCode).toBe(403);
    void otherField; // posé uniquement pour que le centre ait un terrain cohérent, non utilisé directement
  });

  it('une réservation issue d’un match porte son roster (capacity/joinedCount/players/organizerId), jamais via GET /matches/:id', async () => {
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day1(), startMin: 480, durationMin: 60 },
    });
    expect(bk.statusCode, bk.body).toBe(201);
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId, title: 'Match roster test', format: '5v5' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const matchId = (created.json() as { match: { id: string; capacity: number } }).match;

    const karim = await loginAs(stack, seed.phones.karim);
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId.id}/join`, headers: bearer(karim) });
    expect(join.statusCode, join.body).toBe(200);

    const sofianeUserId = await stack.db.selectFrom('users').select('id')
      .where('phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow();

    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(hamid) });
    const row = (res.json() as {
      bookings: {
        id: string; matchId: string | null;
        match?: { title: string; capacity: number; organizerId: string; joinedCount: number; players: { userId: string; name: string }[] };
      }[];
    }).bookings.find((b) => b.id === bookingId);
    expect(row?.matchId).toBe(matchId.id);
    expect(row?.match?.title).toBe('Match roster test');
    expect(row?.match?.capacity).toBe(matchId.capacity);
    expect(row?.match?.organizerId).toBe(sofianeUserId.id); // chantier Dashboard (06/09/2026) : substitut réel du « capitaine »
    expect(row?.match?.joinedCount).toBe(2); // organisateur (sofiane) + karim
    expect(row?.match?.players.map((p) => p.name).sort()).toEqual(['Karim Z.', 'Sofiane B.'].sort());
  });

  it('deux matchs le même jour : rosters batchés en une seule requête chacun, jamais mélangés entre matchs (correctif 06/09/2026)', async () => {
    const bk1 = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t1, date: day1(), startMin: 540, durationMin: 60 },
    });
    const match1 = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane),
      payload: { bookingId: (bk1.json() as { booking: { id: string } }).booking.id, title: 'Match A', format: '5v5' },
    });
    const matchAId = (match1.json() as { match: { id: string } }).match.id;
    // Numéros jetables jamais utilisés ailleurs dans ce fichier — les comptes
    // du seed (karim, walid…) ont déjà consommé leur fenêtre de renvoi OTP
    // (60 s) dans les tests précédents du même stack partagé.
    const joinerA = await loginAs(stack, '+213550900101', 'Joueur A');
    await stack.app.inject({ method: 'POST', url: `/matches/${matchAId}/join`, headers: bearer(joinerA) });

    const organizerB = await loginAs(stack, '+213550900102', 'Organisateur B');
    const bk2 = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(organizerB),
      payload: { fieldId: seed.fields.t2, date: day1(), startMin: 660, durationMin: 60 },
    });
    const match2 = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(organizerB),
      payload: { bookingId: (bk2.json() as { booking: { id: string } }).booking.id, title: 'Match B', format: '7v7' },
    });
    const matchBId = (match2.json() as { match: { id: string } }).match.id;
    const joinerB = await loginAs(stack, '+213550900103', 'Joueur B');
    await stack.app.inject({ method: 'POST', url: `/matches/${matchBId}/join`, headers: bearer(joinerB) });

    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(hamid) });
    const bookings = (res.json() as {
      bookings: { matchId: string | null; match?: { title: string; players: { name: string }[] } }[];
    }).bookings;
    const rowA = bookings.find((b) => b.matchId === matchAId);
    const rowB = bookings.find((b) => b.matchId === matchBId);
    expect(rowA?.match?.title).toBe('Match A');
    expect(rowA?.match?.players.map((p) => p.name).sort()).toEqual(['Joueur A', 'Sofiane B.'].sort());
    expect(rowB?.match?.title).toBe('Match B');
    expect(rowB?.match?.players.map((p) => p.name).sort()).toEqual(['Joueur B', 'Organisateur B'].sort());
  });

  it('une réservation sans match n’a pas de champ match', async () => {
    const b = await createWalkIn(hamid, seed.fields.t3, 780, day1(), 'Sans match');
    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day1()}`, headers: bearer(hamid) });
    const row = (res.json() as { bookings: { id: string; match?: unknown }[] }).bookings.find((r) => r.id === b.id);
    expect(row?.match).toBeUndefined();
  });
});

describe('abonnements — projection calculée, chantier CRM Abonnements (06/09/2026)', () => {
  it('une occurrence d’abonnement actif apparaît dans `subscriptions`, jamais dans `bookings`', async () => {
    // T3, 22:00 (1320 min) : créneau tardif, loin de toutes les résas déjà
    // créées ailleurs dans ce fichier sur day1()/day2() (même jour de semaine,
    // décalés d'exactement 7 jours) — jamais de faux conflit entre tests.
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: {
        fieldId: seed.fields.t3, weekday: weekdayOfDayStart(dayStartMs(day2())), startMin: 1320, durationMin: 90,
        holderName: 'Club Planning Test', activeFrom: algiersDateOf(Date.now() - 86_400_000),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const recId = (created.json() as { subscription: { id: string } }).subscription.id;

    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day2()}`, headers: bearer(hamid) });
    const body = res.json() as {
      bookings: { id: string }[];
      subscriptions: { id: string; recurringBookingId: string; holderName: string; fieldName: string; start: number; end: number }[];
    };
    const occ = body.subscriptions.find((s) => s.recurringBookingId === recId);
    expect(occ).toBeDefined();
    expect(occ?.holderName).toBe('Club Planning Test');
    expect(occ?.fieldName).toBe('T3');
    expect(occ!.end - occ!.start).toBe(90 * 60_000);
    // Jamais matérialisée dans `bookings` (décision d'Aymen : sans créer de
    // vraie ligne, le core lui-même n'a jamais voulu ça).
    expect(body.bookings.some((b) => b.id === occ!.id)).toBe(false);
  });

  it('un abonnement résilié disparaît de `subscriptions` dès le lendemain de la requête', async () => {
    const created = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings`, headers: bearer(hamid),
      payload: {
        fieldId: seed.fields.t3, weekday: weekdayOfDayStart(dayStartMs(day2())), startMin: 660, durationMin: 60,
        holderName: 'À résilier avant lecture', activeFrom: algiersDateOf(Date.now() - 86_400_000),
      },
    });
    const recId = (created.json() as { subscription: { id: string } }).subscription.id;
    await stack.app.inject({ method: 'POST', url: `/venues/${seed.venueId}/recurring-bookings/${recId}/end`, headers: bearer(hamid) });

    const res = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/bookings?date=${day2()}`, headers: bearer(hamid) });
    const body = res.json() as { subscriptions: { recurringBookingId: string }[] };
    expect(body.subscriptions.some((s) => s.recurringBookingId === recId)).toBe(false);
  });
});
