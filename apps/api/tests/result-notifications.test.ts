/* Lot P1 (03/09/2026), point 4 — notifications de résultat, jamais câblées
   jusqu'ici : RESULT_TO_CONFIRM à la saisie (pour ceux qui peuvent
   confirmer, jamais le rapporteur), RESULT_CONFIRMED à la confirmation
   (pour celui qui a saisi, jamais le confirmateur). Même discipline que
   MATCH_CANCELLED (teams-matches-challenges.test.ts) : les destinataires
   sont vérifiés en base, un par un. Vrai Postgres 16 éphémère. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';

const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane);
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);
});
afterAll(async () => { await stack.teardown(); });

let slotCounter = 0;
function nextSlot(): { date: string; startMin: number } {
  const slot = slotCounter++;
  return { date: nextNonFriday(3 + Math.floor(slot / 10) * 8), startMin: 540 + (slot % 10) * 90 };
}

/** Match SIMPLE (2 places) : sofiane organise, karim rejoint ; horaire reculé
    en base pour qu'il soit « déjà joué » — même technique que results.test.ts. */
async function createPlayedMatch(): Promise<{ matchId: string; sofianeId: string; karimId: string }> {
  const { date, startMin } = nextSlot();
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
  });
  expect(bk.statusCode, bk.body).toBe(201);
  const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId, title: 'Match test notifications' },
  });
  const matchId = (created.json() as { match: { id: string } }).match.id;
  const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
  expect(join.statusCode).toBe(200);
  const end = Date.now() - 2 * 3_600_000;
  await stack.db.updateTable('matches').set({ time_range: toPgRange({ start: end - 60 * 60_000, end }) })
    .where('id', '=', matchId).execute();
  return { matchId, sofianeId: seed.users.sofiane, karimId: seed.users.karim };
}

async function notifs(type: string, matchId: string) {
  return stack.db.selectFrom('notifications').select(['user_id'])
    .where('type', '=', type).where('ref_id', '=', matchId).execute();
}

describe('notifications de résultat', () => {
  it('saisie → RESULT_TO_CONFIRM à l’adversaire inscrit, jamais au rapporteur ni à un non-inscrit', async () => {
    const { matchId, sofianeId, karimId } = await createPlayedMatch();
    const submit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 2, awayScore: 1 },
    });
    expect(submit.statusCode, submit.body).toBe(201);

    const rows = await notifs('RESULT_TO_CONFIRM', matchId);
    expect(rows.map((r) => r.user_id)).toEqual([karimId]);
    expect(rows.map((r) => r.user_id)).not.toContain(sofianeId);
    expect(rows.map((r) => r.user_id)).not.toContain(seed.users.walid);
    // et rien de confirmé pour l'instant
    expect(await notifs('RESULT_CONFIRMED', matchId)).toHaveLength(0);
  });

  it('confirmation → RESULT_CONFIRMED à celui qui a saisi, jamais au confirmateur', async () => {
    const { matchId, sofianeId, karimId } = await createPlayedMatch();
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 1, awayScore: 1 },
    });
    const confirm = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(karim),
    });
    expect(confirm.statusCode, confirm.body).toBe(200);

    const rows = await notifs('RESULT_CONFIRMED', matchId);
    expect(rows.map((r) => r.user_id)).toEqual([sofianeId]);
    expect(rows.map((r) => r.user_id)).not.toContain(karimId);
  });

  it('un refus (non-inscrit, ou rapporteur qui se confirme) ne produit AUCUNE notification', async () => {
    const { matchId } = await createPlayedMatch();
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 0, awayScore: 3 },
    });
    const before = (await notifs('RESULT_CONFIRMED', matchId)).length;
    const outsider = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(walid) });
    expect(outsider.statusCode).toBe(403);
    const self = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/result/confirm`, headers: bearer(sofiane) });
    expect(self.statusCode).toBe(400);
    expect((await notifs('RESULT_CONFIRMED', matchId)).length).toBe(before);
  });

  it('auto-confirmation à 24 h (silence de l’adversaire) → RESULT_CONFIRMED au rapporteur, une seule fois (décision Aymen 04/09)', async () => {
    const { matchId, sofianeId, karimId } = await createPlayedMatch();
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 3, awayScore: 0 },
    });
    expect(await notifs('RESULT_CONFIRMED', matchId)).toHaveLength(0);
    // Saisie vieillie de 25 h en base : le prochain contact la confirme paresseusement.
    await stack.db.updateTable('match_results').set({ reported_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('match_id', '=', matchId).execute();
    const read = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/result`, headers: bearer(karim) });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { result: { status: string } }).result.status).toBe('CONFIRMED');

    const rows = await notifs('RESULT_CONFIRMED', matchId);
    expect(rows.map((r) => r.user_id)).toEqual([sofianeId]);
    expect(rows.map((r) => r.user_id)).not.toContain(karimId);
    // Relectures : jamais un second RESULT_CONFIRMED.
    await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/result`, headers: bearer(sofiane) });
    await stack.app.inject({ method: 'GET', url: `/matches/${matchId}/result`, headers: bearer(karim) });
    expect(await notifs('RESULT_CONFIRMED', matchId)).toHaveLength(1);
  });

  it('le joueur lit bien sa notification via GET /me/notifications (refId = le match)', async () => {
    const { matchId } = await createPlayedMatch();
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane),
      payload: { homeScore: 4, awayScore: 2 },
    });
    const me = await stack.app.inject({ method: 'GET', url: '/me/notifications', headers: bearer(karim) });
    const list = (me.json() as { notifications: { type: string; refId?: string }[] }).notifications;
    expect(list.some((n) => n.type === 'RESULT_TO_CONFIRM' && n.refId === matchId)).toBe(true);
  });
});
