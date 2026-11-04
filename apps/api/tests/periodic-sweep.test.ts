/* P1-A (audit pré-lancement, lot 9, 27/09/2026, MAT-6) — le premier balayage périodique du projet : rappel de
   match H-2 pour TOUS les inscrits dus (pas seulement le lecteur), expiration des défis (avec notification enfin
   posée à l'émetteur), auto-confirmation des résultats à 24 h — les trois regroupées dans un seul passage, sous
   un même verrou consultatif Postgres (sécurité multi-instance : un passage à la fois, où qu'il tombe). Vrai
   Postgres 16 éphémère ; le temps réel n'est jamais avancé, seules les colonnes horaires le sont directement en
   base (même technique que match-reminder.test.ts / results.test.ts / teams-matches-challenges.test.ts). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { toPgRange } from '../src/lib/pgrange.js';
import { runPeriodicSweep } from '../src/jobs/periodic-sweep.js';
import { makeSafeDayPicker } from './helpers/dates.js';

let stack: TestStack;
let seed: SeedResult;
let sofiane = '', karim = '', walid = '', fouad = '';
const H = 3_600_000;

const nextNonFriday = makeSafeDayPicker();
let slotCounter = 0;
function nextSlot(): { date: string; startMin: number } {
  const slot = slotCounter++;
  return { date: nextNonFriday(3 + Math.floor(slot / 10) * 8), startMin: 540 + (slot % 10) * 90 };
}

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  sofiane = await loginAs(stack, seed.phones.sofiane); // capitaine FC Kahwa
  karim = await loginAs(stack, seed.phones.karim);
  walid = await loginAs(stack, seed.phones.walid);     // capitaine Panthers
  fouad = await loginAs(stack, seed.phones.fouad);
});
afterAll(async () => { await stack.teardown(); });

async function notificationsOf(userId: string, type: string, refId: string) {
  return stack.db.selectFrom('notifications').select('id')
    .where('user_id', '=', userId).where('type', '=', type).where('ref_id', '=', refId).execute();
}

describe('rappel de match H-3 — TOUS les inscrits dus, pas seulement le lecteur', () => {
  it('un match à 3 joueurs, personne n’a ouvert quoi que ce soit : le balayage rappelle les trois d’un coup', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date, startMin, durationMin: 60 },
    });
    expect(bk.statusCode, bk.body).toBe(201);
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Match balayage' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;
    const joinKarim = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    expect(joinKarim.statusCode, joinKarim.body).toBe(200);
    const joinWalid = await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(walid) });
    expect(joinWalid.statusCode, joinWalid.body).toBe(200);
    const start = Date.now() + 90 * 60_000; // dans la fenêtre du rappel (H-3)
    await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end: start + H }) }).where('id', '=', matchId).execute();
    // Règle 12 : pas de rappel pour qui s'inscrit APRÈS H-3 — les trois se sont inscrits la veille.
    await stack.db.updateTable('match_players').set({ joined_at: new Date(Date.now() - 24 * H) }).where('match_id', '=', matchId).execute();

    for (const u of [seed.users.sofiane, seed.users.karim, seed.users.walid]) {
      expect(await notificationsOf(u, 'MATCH_REMINDER', matchId)).toHaveLength(0);
    }
    const result = await runPeriodicSweep(stack.db, Date.now());
    expect(result.locked).toBe(true);
    expect(result.reminders).toBe(3);
    for (const u of [seed.users.sofiane, seed.users.karim, seed.users.walid]) {
      expect(await notificationsOf(u, 'MATCH_REMINDER', matchId)).toHaveLength(1);
    }
    // rejoué : idempotent, jamais un second rappel pour le même (joueur, match).
    const again = await runPeriodicSweep(stack.db, Date.now());
    expect(again.reminders).toBe(0);
    expect(await notificationsOf(seed.users.sofiane, 'MATCH_REMINDER', matchId)).toHaveLength(1);
  });

  it('hors fenêtre (match dans 4 h) ou match annulé : rien', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(fouad),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(fouad), payload: { bookingId, title: 'Match trop tôt' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;
    const start = Date.now() + 4 * H;   // règle 12 : le rappel part à H-3
    await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end: start + H }) }).where('id', '=', matchId).execute();
    await runPeriodicSweep(stack.db, Date.now());
    expect(await notificationsOf(seed.users.fouad, 'MATCH_REMINDER', matchId)).toHaveLength(0);
  });
});

describe('expiration des défis — l’émetteur enfin prévenu', () => {
  const proposedDay = () => nextNonFriday(6);

  it('un défi PENDING dont l’échéance est dépassée passe EXPIRED, le capitaine ÉMETTEUR est notifié', async () => {
    const send = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 900, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    expect(send.statusCode, send.body).toBe(201);
    const challengeId = (send.json() as { challenge: { id: string } }).challenge.id;
    await stack.db.updateTable('challenges').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', challengeId).execute();

    const result = await runPeriodicSweep(stack.db, Date.now());
    expect(result.challengesExpired).toBe(1);

    const row = await stack.db.selectFrom('challenges').select('status').where('id', '=', challengeId).executeTakeFirstOrThrow();
    expect(row.status).toBe('EXPIRED');
    expect(await notificationsOf(seed.users.sofiane, 'CHALLENGE_EXPIRED', challengeId)).toHaveLength(1);
    // Jamais le destinataire (Panthers) — seul l'émetteur attend une réponse.
    expect(await notificationsOf(seed.users.walid, 'CHALLENGE_EXPIRED', challengeId)).toHaveLength(0);

    const again = await runPeriodicSweep(stack.db, Date.now());
    expect(again.challengesExpired).toBe(0); // déjà EXPIRED, plus PENDING — jamais renotifié
  });

  it('un défi encore dans les temps, ou déjà répondu, n’est jamais touché', async () => {
    const send = await stack.app.inject({
      method: 'POST', url: '/challenges', headers: bearer(sofiane),
      payload: {
        fromTeamId: seed.teams.fcKahwa, toTeamId: seed.teams.panthers, sport: 'FOOTBALL', format: '5v5',
        date: proposedDay(), startMin: 1080, durationMin: 90, venueId: seed.venueId, fieldId: seed.fields.t1,
      },
    });
    const challengeId = (send.json() as { challenge: { id: string } }).challenge.id;
    await runPeriodicSweep(stack.db, Date.now());
    const row = await stack.db.selectFrom('challenges').select('status').where('id', '=', challengeId).executeTakeFirstOrThrow();
    expect(row.status).toBe('PENDING');
    expect(await notificationsOf(seed.users.sofiane, 'CHALLENGE_EXPIRED', challengeId)).toHaveLength(0);
  });
});

describe('auto-confirmation des résultats à 24 h — un résultat jamais rouvert est confirmé quand même', () => {
  async function createPlayedMatch(hoursAgo: number): Promise<string> {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Match balayage résultat' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;
    await stack.app.inject({ method: 'POST', url: `/matches/${matchId}/join`, headers: bearer(karim) });
    const end = Date.now() - hoursAgo * H;
    await stack.db.updateTable('matches').set({ time_range: toPgRange({ start: end - H, end }) }).where('id', '=', matchId).execute();
    return matchId;
  }

  it('résultat saisi puis jamais rouvert par personne : confirmé et notifié au rapporteur par le balayage', async () => {
    const matchId = await createPlayedMatch(2);
    const submit = await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane), payload: { homeScore: 3, awayScore: 1 },
    });
    expect(submit.statusCode, submit.body).toBe(201);
    await stack.db.updateTable('match_results').set({ reported_at: new Date(Date.now() - 25 * H) }).where('match_id', '=', matchId).execute();

    expect(await notificationsOf(seed.users.sofiane, 'RESULT_CONFIRMED', matchId)).toHaveLength(0);
    const result = await runPeriodicSweep(stack.db, Date.now());
    expect(result.resultsConfirmed).toBe(1);

    const row = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(row.status).toBe('CONFIRMED');
    expect(await notificationsOf(seed.users.sofiane, 'RESULT_CONFIRMED', matchId)).toHaveLength(1);
  });

  it('résultat de moins de 24 h : jamais touché', async () => {
    const matchId = await createPlayedMatch(2);
    await stack.app.inject({
      method: 'POST', url: `/matches/${matchId}/result`, headers: bearer(sofiane), payload: { homeScore: 1, awayScore: 1 },
    });
    await runPeriodicSweep(stack.db, Date.now());
    const row = await stack.db.selectFrom('match_results').select('status').where('match_id', '=', matchId).executeTakeFirstOrThrow();
    expect(row.status).toBe('PENDING_CONFIRMATION');
  });
});

describe('verrou multi-instance — un seul passage à la fois', () => {
  it('deux appels strictement simultanés : un seul fait le travail, l’autre repart bredouille (locked: false)', async () => {
    const { date, startMin } = nextSlot();
    const bk = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: seed.fields.t3, format: 'SIMPLE', date, startMin, durationMin: 60 },
    });
    const bookingId = (bk.json() as { booking: { id: string } }).booking.id;
    const created = await stack.app.inject({
      method: 'POST', url: '/matches', headers: bearer(sofiane), payload: { bookingId, title: 'Match verrou' },
    });
    const matchId = (created.json() as { match: { id: string } }).match.id;
    const start = Date.now() + 100 * 60_000;
    await stack.db.updateTable('matches').set({ time_range: toPgRange({ start, end: start + H }) }).where('id', '=', matchId).execute();
    await stack.db.updateTable('match_players').set({ joined_at: new Date(Date.now() - 24 * H) }).where('match_id', '=', matchId).execute();   // règle 12 : inscrit la veille

    const now = Date.now();
    const [a, b] = await Promise.all([runPeriodicSweep(stack.db, now), runPeriodicSweep(stack.db, now)]);
    const locked = [a, b].filter((r) => r.locked);
    const skipped = [a, b].filter((r) => !r.locked);
    expect(locked).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toEqual({ locked: false, reminders: 0, challengesExpired: 0, resultsConfirmed: 0, claimReminders: 0 });
    expect(await notificationsOf(seed.users.sofiane, 'MATCH_REMINDER', matchId)).toHaveLength(1); // jamais doublé
  });
});
