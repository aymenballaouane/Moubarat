/* Lot P1 (03/09/2026), point 6 — rappel de match H-2, mécanisme paresseux
   (apps/api/src/modules/notifications/reminders.ts) : produit à la lecture
   de GET /me/notifications, dans la fenêtre [H-2, coup d'envoi), une seule
   fois par (joueur, match). Vrai Postgres 16 éphémère.

   Le temps réel n'est pas déplaçable dans ces tests : l'horaire du MATCH
   l'est (UPDATE matches.time_range, même technique que results.test.ts).
   La fenêtre elle-même est de l'arithmétique sur des epochs absolus, sans
   aucune lecture de jour calendaire ni d'horaire d'ouverture — le cas
   « à cheval sur minuit » est couvert au niveau core (reminderDueAt,
   notify-rating.test.ts), pas ici. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { weekdayOfDayStart, reminderDueAt } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '';
const H = 3_600_000;

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

/** Match à 2 (sofiane organise, karim rejoint), puis horaire déplacé en base
    à `startsInMs` millisecondes d'ici (négatif = déjà commencé). */
async function createMatchStartingIn(startsInMs: number): Promise<string> {
  const { date, startMin } = nextSlot();
  const bk = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(sofiane),
    payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
  });
  expect(bk.statusCode, bk.body).toBe(201);
  const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
  const created = await stack.app.inject({
    method: 'POST', url: '/matches', headers: bearer(sofiane),
    payload: { bookingId, title: 'Match test rappel' },
  });
  const matchId = (created.json() as { match: { id: string } }).match.id;
  const join = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
  expect(join.statusCode).toBe(200);
  const start = Date.now() + startsInMs;
  await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end: start + H }) })
    .where('id', '=', matchId).execute();
  // Règle 12 : pas de rappel pour qui s'inscrit APRÈS H-3 — les inscrits de ce match se sont inscrits la veille.
  await stack.db.updateTable('match_players').set({ joined_at: new Date(Date.now() - 24 * H) }).where('match_id', '=', matchId).execute();
  return matchId;
}

async function reminders(userId: string, matchId: string) {
  return stack.db.selectFrom('notifications').select('id')
    .where('user_id', '=', userId).where('type', '=', 'MATCH_REMINDER').where('ref_id', '=', matchId).execute();
}

async function readMine(token: string) {
  const res = await stack.app.inject({ method: 'GET', url: '/me/notifications', headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { notifications: { type: string; refId?: string; createdAt: number }[] }).notifications;
}

async function matchStart(matchId: string): Promise<number> {
  const row = await stack.db.selectFrom('matches').select(sql<Date>`lower(time_range)`.as('start'))
    .where('id', '=', matchId).executeTakeFirstOrThrow();
  return new Date(row.start).getTime();
}

describe('rappel de match H-3 (paresseux, à la lecture des notifications)', () => {
  it('dans la fenêtre (match dans 90 min) : créé à la première lecture, présent dans la réponse, jamais doublé ensuite', async () => {
    const matchId = await createMatchStartingIn(90 * 60_000);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(0);

    const first = await readMine(sofiane);
    const reminder = first.find((n) => n.type === 'MATCH_REMINDER' && n.refId === matchId);
    expect(reminder).toBeDefined();
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(1);
    /* Revue adverse du lot : daté de l'instant où il était DÛ (H-2), pas de
       l'instant de la découverte — sinon « commence dans 2 h · à l'instant »
       pour un joueur qui ouvre l'app à H-0:10. */
    expect(reminder!.createdAt).toBe(reminderDueAt(await matchStart(matchId)));
    expect(reminder!.createdAt).toBeLessThan(Date.now() - 20 * 60_000);

    await readMine(sofiane);
    await readMine(sofiane);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(1);
  });

  it('chaque inscrit reçoit le sien ; un non-inscrit rien', async () => {
    const matchId = await createMatchStartingIn(30 * 60_000);
    await readMine(sofiane);
    await readMine(karim);
    await readMine(walid);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(1);
    expect(await reminders(seed.users.karim, matchId)).toHaveLength(1);
    expect(await reminders(seed.users.walid, matchId)).toHaveLength(0);
  });

  it('hors fenêtre : match dans 4 h → rien ; match déjà commencé → rien', async () => {
    const tooEarly = await createMatchStartingIn(4 * H);   // règle 12 : le rappel part à H-3
    const started = await createMatchStartingIn(-10 * 60_000);
    await readMine(sofiane);
    expect(await reminders(seed.users.sofiane, tooEarly)).toHaveLength(0);
    expect(await reminders(seed.users.sofiane, started)).toHaveLength(0);
  });

  it('bord de fenêtre : exactement H-3 → rappel ; H-3 moins une seconde → pas encore', async () => {
    const atEdge = await createMatchStartingIn(3 * H - 1_000);      // début dans 2h59m59s : déjà dans la fenêtre
    const justBefore = await createMatchStartingIn(3 * H + 5_000);  // début dans 3h00m05s : pas encore
    await readMine(karim);
    expect(await reminders(seed.users.karim, atEdge)).toHaveLength(1);
    expect(await reminders(seed.users.karim, justBefore)).toHaveLength(0);
  });

  it('match annulé dans la fenêtre → aucun rappel', async () => {
    const matchId = await createMatchStartingIn(60 * 60_000);
    await stack.db.updateTable('matches').set({ status: 'CANCELLED' }).where('id', '=', matchId).execute();
    await readMine(sofiane);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(0);
  });

  it('l’ouverture d’une fiche de match (GET /matches/:id) balaie aussi le rappel ; un visiteur anonyme ne produit rien', async () => {
    const matchId = await createMatchStartingIn(70 * 60_000);
    const anon = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect(anon.statusCode).toBe(200);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(0);
    expect(await reminders(seed.users.karim, matchId)).toHaveLength(0);

    const asKarim = await stack.app.inject({ method: 'GET', url: `/matches/${matchId}`, headers: bearer(karim) });
    expect(asKarim.statusCode).toBe(200);
    expect(await reminders(seed.users.karim, matchId)).toHaveLength(1);
    expect(await reminders(seed.users.sofiane, matchId)).toHaveLength(0); // seulement le lecteur, pas tout le roster
  });

  it('deux lectures strictement simultanées ne doublent jamais le rappel (verrou par joueur)', async () => {
    const matchId = await createMatchStartingIn(45 * 60_000);
    await Promise.all([readMine(karim), readMine(karim), readMine(karim)]);
    expect(await reminders(seed.users.karim, matchId)).toHaveLength(1);
  });
});
