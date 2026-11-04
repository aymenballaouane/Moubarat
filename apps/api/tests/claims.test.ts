import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { makeSafeDayPicker } from './helpers/dates.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { runPeriodicSweep } from '../src/jobs/periodic-sweep.js';

/* Règle 21 — réservation prise par téléphone, « C'est bien toi ? » (décisions d'Aymen du 26/10/2026). Vrai Postgres. */

let stack: TestStack;
let seed: SeedResult;
let nadia = '';        // RECEPTION du centre de démo
let sofiane = '';      // joueur dont le numéro est connu
let karim = '';        // un autre joueur
const H = 3_600_000;
const nextNonFriday = makeSafeDayPicker();
let dayCursor = 30;
const freshDay = () => { const d = nextNonFriday(dayCursor); dayCursor += 10; return d; };
const call = (method: 'GET' | 'POST', token: string, url: string, payload?: unknown) =>
  stack.app.inject({ method, url, headers: bearer(token), ...(payload !== undefined ? { payload: payload as never } : {}) });

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
});
afterAll(async () => { await stack.teardown(); });

/** Le centre saisit une réservation téléphonique (nom + numéro). `phone` : le texte tel qu'il le tape. */
async function centerBooking(phone: string | undefined, startMin = 600) {
  const res = await call('POST', nadia, '/bookings', {
    fieldId: seed.fields.t1, date: freshDay(), startMin, durationMin: 60, source: 'PHONE', reservationName: 'Monsieur Saidi',
    ...(phone !== undefined ? { customerPhone: phone } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string; claimStatus: string | null } }).booking;
}
const userIdOf = async (phoneE164: string) => (await stack.db.selectFrom('users').select('id').where('phone', '=', phoneE164).executeTakeFirstOrThrow()).id;
const claimsOf = async (token: string) => ((await call('GET', token, '/me/claims')).json() as { claims: { bookingId: string }[] }).claims;
const myBookingIds = async (token: string) => ((await call('GET', token, '/me/bookings')).json() as { bookings: { id: string }[] }).bookings.map((b) => b.id);
const claimNotifs = (userId: string, bookingId: string) => stack.db.selectFrom('notifications').selectAll()
  .where('user_id', '=', userId).where('type', '=', 'BOOKING_CLAIM').where('ref_id', '=', bookingId).execute();

describe('le centre saisit un numéro', () => {
  it('numéro d’un compte joueur (écrit comme au comptoir) : rattachée EN ATTENTE, le joueur est prévenu, elle n’est pas encore à son nom', async () => {
    const sofianeId = await userIdOf(seed.phones.sofiane);
    const national = '0' + seed.phones.sofiane.slice(4);   // +213555… → 0555…
    const written = `${national.slice(0, 4)} ${national.slice(4, 6)} ${national.slice(6, 8)} ${national.slice(8)}`;
    const b = await centerBooking(written);
    expect(b.claimStatus).toBe('PENDING');
    expect(await claimNotifs(sofianeId, b.id)).toHaveLength(1);
    expect((await claimsOf(sofiane)).map((c) => c.bookingId)).toContain(b.id);
    expect(await myBookingIds(sofiane)).not.toContain(b.id);          // « ne compte pour lui qu'une fois confirmée »
    expect((await claimsOf(karim)).map((c) => c.bookingId)).not.toContain(b.id);                // un autre joueur ne la voit pas
  });

  it('numéro sans compte, numéro illisible, ou pas de numéro : rien n’est rattaché, aucune notification', async () => {
    for (const phone of ['0550 00 00 00', 'pas un numéro', undefined]) {
      const b = await centerBooking(phone, 660);
      expect(b.claimStatus, String(phone)).toBeNull();
    }
  });
});

describe('le joueur répond', () => {
  it('« C’est moi » : la réservation passe à son nom (Mes réservations), la demande disparaît, le Journal du centre le dit ; une seule réponse', async () => {
    const b = await centerBooking(seed.phones.sofiane);
    const res = await call('POST', sofiane, `/me/claims/${b.id}/confirm`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await myBookingIds(sofiane)).toContain(b.id);
    expect((await claimsOf(sofiane)).map((c) => c.bookingId)).not.toContain(b.id);
    const row = await stack.db.selectFrom('bookings').select(['by_user_id', 'claim_status']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ by_user_id: await userIdOf(seed.phones.sofiane), claim_status: 'CONFIRMED' });
    const audit = await stack.db.selectFrom('audit_log').select(['action', 'actor_role']).where('object_id', '=', b.id).where('action', '=', 'BOOKING_CLAIM_CONFIRMED').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_role).toBe('SUPERADMIN');
    const again = await call('POST', sofiane, `/me/claims/${b.id}/decline`);
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect((again.json() as { error: string }).error).toBe('CLAIM_ALREADY_ANSWERED');
  });

  it('« Ce n’est pas moi » : elle disparaît de ses demandes, reste au nom du centre, et le CRM voit « refusée »', async () => {
    const b = await centerBooking(seed.phones.sofiane, 720);
    expect((await call('POST', sofiane, `/me/claims/${b.id}/decline`)).statusCode).toBe(200);
    expect((await claimsOf(sofiane)).map((c) => c.bookingId)).not.toContain(b.id);
    expect(await myBookingIds(sofiane)).not.toContain(b.id);
    const row = await stack.db.selectFrom('bookings').select(['by_user_id', 'claim_status', 'status']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row.claim_status).toBe('DECLINED');
    expect(row.status).toBe('RESERVED');                              // le centre garde sa réservation
    expect(row.by_user_id).not.toBe(await userIdOf(seed.phones.sofiane));
    const audit = await stack.db.selectFrom('audit_log').select('summary').where('object_id', '=', b.id).where('action', '=', 'BOOKING_CLAIM_DECLINED').execute();
    expect(audit).toHaveLength(1);
  });

  it('un autre joueur ne peut ni confirmer ni refuser la réservation d’un autre', async () => {
    const b = await centerBooking(seed.phones.sofiane, 780);
    for (const answer of ['confirm', 'decline']) {
      const res = await call('POST', karim, `/me/claims/${b.id}/${answer}`);
      expect(res.statusCode, answer).toBe(403);
    }
  });

  it('une réservation annulée par le centre n’est plus une demande, et on ne peut plus y répondre', async () => {
    const b = await centerBooking(seed.phones.sofiane, 840);
    const cancel = await call('POST', nadia, `/bookings/${b.id}/status`, { status: 'CANCELLED', reason: 'STAFF_ERROR' });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((await claimsOf(sofiane)).map((c) => c.bookingId)).not.toContain(b.id);
    const res = await call('POST', sofiane, `/me/claims/${b.id}/confirm`);
    expect((res.json() as { error: string }).error).toBe('CLAIM_CLOSED');
  });
});

describe('aucune absence tant que le joueur n’a pas confirmé', () => {
  it('no-show sur une réservation en attente : aucune absence au joueur ; après « C’est moi », oui', async () => {
    const sofianeId = await userIdOf(seed.phones.sofiane);
    const before = await stack.db.selectFrom('absences').select('id').where('user_id', '=', sofianeId).execute();
    const pending = await centerBooking(seed.phones.sofiane, 900);
    // le no-show n'est possible qu'une fois le créneau honoré : on avance la ligne dans le passé sans toucher aux règles
    await stack.db.updateTable('bookings').set({ time_range: toPgRange({ start: Date.now() - 3 * H, end: Date.now() - 2 * H }) }).where('id', '=', pending.id).execute();
    expect((await call('POST', nadia, `/bookings/${pending.id}/status`, { status: 'NO_SHOW' })).statusCode).toBe(200);
    expect(await stack.db.selectFrom('absences').select('id').where('user_id', '=', sofianeId).execute()).toHaveLength(before.length);

    const confirmed = await centerBooking(seed.phones.sofiane, 960);
    expect((await call('POST', sofiane, `/me/claims/${confirmed.id}/confirm`)).statusCode).toBe(200);
    await stack.db.updateTable('bookings').set({ time_range: toPgRange({ start: Date.now() - 5 * H, end: Date.now() - 4 * H }) }).where('id', '=', confirmed.id).execute();
    expect((await call('POST', nadia, `/bookings/${confirmed.id}/status`, { status: 'NO_SHOW' })).statusCode).toBe(200);
    expect(await stack.db.selectFrom('absences').select('id').where('user_id', '=', sofianeId).execute()).toHaveLength(before.length + 1);
    await stack.db.deleteFrom('player_restrictions').where('user_id', '=', sofianeId).execute();
    await stack.db.deleteFrom('absences').where('user_id', '=', sofianeId).execute();
  });
});

describe('rappel la veille', () => {
  it('sans réponse, à moins de 24 h du début : UN rappel, jamais deux ; pas pour une réservation déjà confirmée ou trop lointaine', async () => {
    const sofianeId = await userIdOf(seed.phones.sofiane);
    const soon = await centerBooking(seed.phones.sofiane, 1020);
    const far = await centerBooking(seed.phones.sofiane, 1080);
    const answered = await centerBooking(seed.phones.sofiane, 1140);
    await call('POST', sofiane, `/me/claims/${answered.id}/confirm`);
    /* Indépendant de l'heure (27/10/2026) : « maintenant + 20 h » tombait certains soirs sur une autre réservation du terrain T1 créée plus haut dans ce fichier
       (contrainte d'exclusion `no_double_booking`). Les trois lignes sont déplacées sur T3 (même centre — un trigger interdit de changer de centre), qui ne porte aucune autre réservation dans ce fichier ni dans le seed. */
    const at = (id: string, hoursFromNow: number) => stack.db.updateTable('bookings')
      .set({ field_id: seed.fields.t3, time_range: toPgRange({ start: Date.now() + hoursFromNow * H, end: Date.now() + (hoursFromNow + 1) * H }) }).where('id', '=', id).execute();
    await at(soon.id, 20); await at(far.id, 40); await at(answered.id, 22);
    const first = await runPeriodicSweep(stack.db, Date.now());
    expect(first.claimReminders).toBeGreaterThanOrEqual(1);
    expect(await claimNotifs(sofianeId, soon.id)).toHaveLength(2);        // la saisie + le rappel
    expect(await claimNotifs(sofianeId, far.id)).toHaveLength(1);
    expect(await claimNotifs(sofianeId, answered.id)).toHaveLength(1);
    await runPeriodicSweep(stack.db, Date.now());
    expect(await claimNotifs(sofianeId, soon.id)).toHaveLength(2);        // une seule fois
  });
});

describe('la liste du CRM', () => {
  it('porte le statut du rattachement pour chaque réservation', async () => {
    const b = await centerBooking(seed.phones.sofiane, 1200);
    const day = (await stack.db.selectFrom('bookings').select('time_range').where('id', '=', b.id).executeTakeFirstOrThrow()).time_range;
    expect(day).toBeTruthy();
    const search = await call('GET', nadia, `/venues/${seed.venueId}/bookings/search?q=${encodeURIComponent('Saidi')}`);
    expect(search.statusCode, search.body).toBe(200);
    const found = (search.json() as { bookings: { id: string; claimStatus: string | null }[] }).bookings.find((x) => x.id === b.id);
    expect(found?.claimStatus).toBe('PENDING');
  });
});
