import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Lot 9 — garde-fous (26/10/2026, règles 23, 24, 32 de la refonte de l'app joueur) :
   - règle 23 : au plus 2 réservations par jour et 4 à venir pour un JOUEUR (le comptoir n'est pas limité), jamais deux qui se chevauchent ;
   - règle 24 : un refus porte son code et, pour un chevauchement, le détail (centre, début, fin) de ce que le joueur a déjà ;
   - règle 8  : un joueur retiré d'un match le sait par un code à part (REMOVED_FROM_MATCH) ;
   - règle 32 : sans l'accord « numéro visible », ni rejoindre ni réserver (PHONE_VISIBLE_OFF) — ce qui est déjà pris reste. Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', walid = '', amine = '', nadia = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  // Les valeurs de PRODUCTION de la règle 23, posées explicitement : LOOSE_LIMITS les desserre pour les autres suites.
  stack = await setupTestStack({ envOverrides: { bookingMaxPerDay: 2, bookingMaxUpcoming: 4, bookingForbidOverlap: true } });
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  walid = await loginAs(stack, seed.phones.walid);
  amine = await loginAs(stack, seed.phones.amine);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION
});
afterAll(async () => { await stack.teardown(); });

async function book(token: string, payload: Record<string, unknown>) {
  return stack.app.inject({ method: 'POST', url: '/bookings', headers: bearer(token), payload: { fieldId: seed.fields.t1, durationMin: 60, ...payload } });
}
/** Un joueur NEUF (aucune réservation de la démo derrière lui) : les plafonds se comptent sur toutes ses réservations. */
async function fresh(phone: string, name: string): Promise<{ token: string; id: string }> {
  const token = await loginAs(stack, phone, name);
  const u = await stack.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow();
  return { token, id: u.id };
}
const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

describe('règle 23 — plafonds de réservation', () => {
  it('une 3e réservation le même jour → 409 BOOKING_LIMIT_DAY ; une annulation libère la place', async () => {
    const D = nextNonFriday(4);
    const a = await book(sofiane, { date: D, startMin: 600 });
    const b = await book(sofiane, { date: D, startMin: 720 });
    expect(a.statusCode, a.body).toBe(201);
    expect(b.statusCode, b.body).toBe(201);
    const c = await book(sofiane, { date: D, startMin: 840 });
    expect(c.statusCode).toBe(409);
    expect(errorOf(c)).toBe('BOOKING_LIMIT_DAY');
    expect((c.json() as { message: string }).message).toContain('2 réservations ce jour-là');

    const cancel = await stack.app.inject({ method: 'POST', url: `/bookings/${(a.json() as { booking: { id: string } }).booking.id}/cancel`, headers: bearer(sofiane) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((await book(sofiane, { date: D, startMin: 840 })).statusCode).toBe(201);
  });

  it('une 5e réservation à venir → 409 BOOKING_LIMIT_UPCOMING, même un jour libre', async () => {
    const karim = (await fresh('+213661299001', 'plafond_4')).token;
    const days = [nextNonFriday(6), nextNonFriday(8), nextNonFriday(10), nextNonFriday(12)];
    for (const D of days) {
      const ok = await book(karim, { date: D, startMin: 600 });
      expect(ok.statusCode, ok.body).toBe(201);
    }
    const fifth = await book(karim, { date: nextNonFriday(14), startMin: 600 });
    expect(fifth.statusCode).toBe(409);
    expect(errorOf(fifth)).toBe('BOOKING_LIMIT_UPCOMING');
    expect((fifth.json() as { message: string }).message).toContain('4 réservations à venir');
  });

  it('le comptoir n’est pas limité : la réception pose 3 réservations le même jour', async () => {
    const D = nextNonFriday(16);
    for (const startMin of [600, 720, 840]) {
      const res = await book(nadia, { date: D, startMin, source: 'WALK_IN', reservationName: 'Client comptoir' });
      expect(res.statusCode, res.body).toBe(201);
    }
  });

  it('un chevauchement avec une réservation du joueur → 409 SCHEDULE_CONFLICT et le détail du centre et de l’heure', async () => {
    const D = nextNonFriday(18);
    const first = await book(walid, { date: D, startMin: 600, durationMin: 90 });
    expect(first.statusCode, first.body).toBe(201);
    const clash = await book(walid, { fieldId: seed.fields.t2, date: D, startMin: 660 });
    expect(clash.statusCode).toBe(409);
    expect(errorOf(clash)).toBe('SCHEDULE_CONFLICT');
    const details = (clash.json() as { details: { venueName: string; start: number; end: number } }).details;
    expect(typeof details.venueName).toBe('string');
    expect(details.venueName.length).toBeGreaterThan(0);
    expect(details.end - details.start).toBe(90 * 60_000);
    // Un créneau qui commence à l'heure de fin ne chevauche pas.
    expect((await book(walid, { date: D, startMin: 690 })).statusCode).toBe(201);
  });

  it('rejoindre un match qui chevauche une réservation : SCHEDULE_CONFLICT avec le même détail', async () => {
    const D = nextNonFriday(20);
    const mine = await book(sofiane, { date: D, startMin: 600, durationMin: 60 });
    expect(mine.statusCode, mine.body).toBe(201);
    const theirs = await book(amine, { fieldId: seed.fields.t2, date: D, startMin: 600 });
    expect(theirs.statusCode, theirs.body).toBe(201);
    const verify = await stack.app.inject({ method: 'POST', url: `/bookings/${(theirs.json() as { booking: { id: string } }).booking.id}/verify`, headers: bearer(nadia) });
    void verify;   // une réservation App est déjà confirmée ; la vérification n'est utile que pour une déclaration téléphonique
    const match = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(amine),
      payload: { bookingId: (theirs.json() as { booking: { id: string } }).booking.id, title: 'Chevauche' },
    });
    expect(match.statusCode, match.body).toBe(201);
    const matchId = (match.json() as { match: { id: string } }).match.id;
    const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(sofiane) });
    expect(join.statusCode).toBe(400);
    expect(errorOf(join)).toBe('SCHEDULE_CONFLICT');
    expect((join.json() as { details: { venueName: string } }).details.venueName.length).toBeGreaterThan(0);
  });
});

describe('règle 8 / 24 — un joueur retiré le sait', () => {
  it('rejoindre un match dont l’organisateur t’a retiré → 403 REMOVED_FROM_MATCH', async () => {
    const D = nextNonFriday(22);
    const created = await book(amine, { date: D, startMin: 900 });
    const bookingId = (created.json() as { booking: { id: string } }).booking.id;
    const match = await stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(amine), payload: { bookingId, title: 'Retrait' } });
    expect(match.statusCode, match.body).toBe(201);
    const matchId = (match.json() as { match: { id: string } }).match.id;
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(walid) })).statusCode).toBe(200);
    const removed = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/players/${seed.users.walid}/remove`, headers: bearer(amine) });
    expect(removed.statusCode, removed.body).toBe(200);
    const back = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(walid) });
    expect(back.statusCode).toBe(403);
    expect(errorOf(back)).toBe('REMOVED_FROM_MATCH');
  });
});

describe('règle 32 — accord « numéro visible » retiré', () => {
  it('ni réserver ni rejoindre (403 PHONE_VISIBLE_OFF) ; ce qui est déjà pris reste ; l’accord rétabli, tout repasse', async () => {
    const D = nextNonFriday(24);
    const k = await fresh('+213661299002', 'accord_off');
    const karim = k.token;
    const existing = await book(karim, { date: D, startMin: 600 });
    expect(existing.statusCode, existing.body).toBe(201);
    const orga = await book(amine, { date: D, startMin: 900 });
    const orgaBooking = (orga.json() as { booking: { id: string } }).booking.id;
    const match = await stack.app.inject({ method: 'POST', url: '/matches', headers: bearer(amine), payload: { bookingId: orgaBooking, title: 'Accord' } });
    const matchId = (match.json() as { match: { id: string } }).match.id;

    const setVisible = (v: boolean) => stack.db.insertInto('profiles').values({ user_id: k.id, phone_visible: v })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ phone_visible: v })).execute();
    await setVisible(false);

    const refusedBooking = await book(karim, { date: D, startMin: 720 });
    expect(refusedBooking.statusCode).toBe(403);
    expect(errorOf(refusedBooking)).toBe('PHONE_VISIBLE_OFF');
    const refusedJoin = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(refusedJoin.statusCode).toBe(403);
    expect(errorOf(refusedJoin)).toBe('PHONE_VISIBLE_OFF');

    const stillThere = await stack.app.inject({ method: 'GET', url: '/me/bookings', headers: bearer(karim) });
    expect((stillThere.json() as { bookings: { id: string }[] }).bookings.map((b) => b.id)).toContain((existing.json() as { booking: { id: string } }).booking.id);

    await setVisible(true);
    expect((await book(karim, { date: D, startMin: 720 })).statusCode).toBe(201);
    expect((await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) })).statusCode).toBe(200);
  });
});
