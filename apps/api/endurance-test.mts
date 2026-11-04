/* Test d'endurance — mécanisme périodique (rappels H-2, expiration des défis, auto-confirmation des résultats).
   Périmètre validé par Aymen (27/09/2026, GO explicite : "Option A, 4 heures, seuil mémoire à 1 Mo/heure").

   Principe (Option A du périmètre proposé) : le VRAI serveur tourne comme un VRAI processus séparé, en continu,
   sous un temps qui s'écoule RÉELLEMENT (jamais d'horloge falsifiée, jamais Date.now() touché pendant que le
   serveur tourne). PERIODIC_SWEEP_INTERVAL_MS est raccourci à 5 secondes — une variable d'environnement DÉJÀ
   supportée en production (apps/api/src/env.ts), aucun code touché. Ce qu'on accélère, c'est la FRÉQUENCE des
   événements dus : toutes les 2 minutes réelles, on crée par de vraies requêtes HTTP contre le vrai serveur un
   nouveau match (échéance réelle dans 2h05, donc dû au rappel H-2 ~5 minutes plus tard), un nouveau défi (rendu dû
   ~5 minutes plus tard par une seule écriture SQL sur expires_at, exactement le même principe que la simulation
   deux-jours), et un nouveau résultat de match (rendu dû ~5 minutes plus tard par une écriture sur reported_at) —
   sur 4 heures, ≈120 objets de chaque type traverseront leur seuil, largement au-delà de « des dizaines de fois ».

   Zéro ligne de code produit touchée : le raccourcissement de l'intervalle passe par la variable d'environnement
   existante ; la mémoire du vrai processus est lue depuis L'EXTÉRIEUR par l'OS (PowerShell), aucune route de
   diagnostic ajoutée à apps/api/src. Base entièrement jetable, jamais pilote/démo/simulation précédente,
   supprimée et confirmée à la fin. */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, openSync } from 'node:fs';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, createPool, primeEnumArrayParsers } from './src/db/client.js';
import { migrate } from './src/db/migrate.js';
import { toPgRange } from './src/lib/pgrange.js';
import { sha256, newSessionToken } from './src/lib/crypto.js';
import { recordLegalConsent } from './src/modules/legal/service.js';

const execFileP = promisify(execFile);

const MIN = 60_000, H = 3_600_000;
// SMOKE_TEST=1 : passage court (quelques minutes) pour valider l'intégration avant le vrai run de 4h — jamais
// utilisé pour le run réel, dont les valeurs par défaut ci-dessous sont exactement celles validées par Aymen.
const SMOKE = process.env.SMOKE_TEST === '1';
const DURATION_MS = SMOKE ? 3 * MIN : 4 * H;
const SEED_INTERVAL_MS = SMOKE ? 30_000 : 2 * MIN;
const SAMPLE_INTERVAL_MS = SMOKE ? 45_000 : 5 * MIN;
const WARMUP_MS = SMOKE ? 0 : 30 * MIN;
const DUE_LEAD_MS = SMOKE ? 20_000 : 5 * MIN; // délai réel avant qu'un objet créé devienne dû pour le balayage
const MEMORY_SLOPE_THRESHOLD_MB_PER_HOUR = 1;
const FIELD_POOL_PER_KIND = 75; // > 45 requis (durée 90 min / cadence 2 min) — marge confortable
const MAX_ITERATIONS = Math.ceil(DURATION_MS / SEED_INTERVAL_MS) + 2;
// 3 joueurs JAMAIS réutilisés par itération (voir seedOnce) — sans ça, des joueurs tournants réutilisés sur des
// créneaux de match qui se chevauchent (cadence 2 min, durée 90 min) déclenchent la vraie règle SCHEDULE_CONFLICT
// (core, match.ts) au moment de /join. Bug trouvé et corrigé au smoke test (27/09/2026).
const PLAYER_POOL_SIZE = MAX_ITERATIONS * 3 + 10;

const DB_NAME = `moubarat_endurance_${Date.now()}`;
const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';
const DB_URL = `postgres://postgres@localhost:5432/${DB_NAME}`;
const PORT = 3097;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LOG_PATH = './endurance-server.log';
const REPORT_PATH = './endurance-report.json';

const trace: { t: number; step: string; extra?: unknown }[] = [];
function log(step: string, extra?: unknown) {
  const line = { t: Date.now(), step, ...(extra !== undefined ? { extra } : {}) };
  trace.push(line);
  console.log(`[${new Date().toISOString()}] ${step}`, extra !== undefined ? JSON.stringify(extra) : '');
}

async function httpJson(method: string, path: string, token: string | null, body?: unknown) {
  // Bug trouvé au smoke test (27/09/2026) : envoyer 'content-type: application/json' SANS corps fait échouer
  // Fastify en 400 ("Body cannot be empty...") — l'en-tête ne doit être posé que si un corps est réellement envoyé.
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* pas de corps JSON */ }
  return { status: res.status, body: json };
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Le serveur n'a jamais répondu 200 sur ${url} dans le délai.`);
}

async function readProcessMemory(pid: number): Promise<{ rssBytes: number; privateBytes: number }> {
  const { stdout } = await execFileP('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-Process -Id ${pid} | Select-Object WorkingSet64,PrivateMemorySize64 | ConvertTo-Json`,
  ]);
  const parsed = JSON.parse(stdout);
  return { rssBytes: parsed.WorkingSet64, privateBytes: parsed.PrivateMemorySize64 };
}

function linregSlopePerHour(points: { t: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const t0 = points[0]!.t;
  const xs = points.map((p) => (p.t - t0) / H);
  const ys = points.map((p) => p.y);
  const n = xs.length;
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]! - xm) * (ys[i]! - ym); den += (xs[i]! - xm) ** 2; }
  return den === 0 ? 0 : num / den;
}

interface Player { userId: string; name: string; token: string }
interface Fixtures {
  venueId: string; fieldIdsReminder: string[]; fieldIdsResult: string[]; fieldIdsChallenge: string[];
  players: Player[]; teamAId: string; teamBId: string;
}
interface SeededMatch { i: number; matchId: string; kickoff: number; userIds: string[]; ok: boolean }
interface SeededChallenge { i: number; challengeId: string; dueAt: number; ok: boolean }
interface SeededResult { i: number; matchId: string; dueAt: number; ok: boolean }

async function main() {
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  const pool = createPool(DB_URL, { max: 5 });
  await migrate(pool);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);
  log('db:créée-et-migrée', { DB_NAME });

  let windDownStarted = false;
  let serverCrashed = false;
  let crashInfo: { code: number | null; signal: string | null; at: number } | null = null;

  const logFd = openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: DB_URL, PORT: String(PORT), HOST: '127.0.0.1',
      PERIODIC_SWEEP_INTERVAL_MS: '5000', OTP_DEV_MODE: 'true', INSTANCE_NAME: 'endurance-test',
    },
    stdio: ['ignore', logFd, logFd, 'ipc'],
  });
  child.on('exit', (code, signal) => {
    if (!windDownStarted) {
      serverCrashed = true;
      crashInfo = { code, signal, at: Date.now() };
      log('SERVEUR:SORTIE-INATTENDUE', crashInfo);
    }
  });

  try {
    // Délai généreux (120s au lieu de 30s) : un environnement occasionnellement lent au démarrage (observé lors
    // d'une tentative précédente, 28/09/2026 — child muet plus de 30s sans planter) ne doit pas faire échouer
    // tout le run pour une simple lenteur de boot, jamais un vrai correctif de code produit.
    await waitForHealth(`${BASE_URL}/health`, 120_000);
    log('serveur:prêt', { pid: child.pid, port: PORT });

    // ---------- Fixtures (structure incidentale : direct SQL, comme partout dans ce projet) ----------
    const venue = await db.insertInto('venues').values({
      name: 'Centre Endurance', wilaya: 'Alger', address: 'Test endurance', lat: 36.7, lng: 3.1,
      phone: '+213555990000', status: 'ACTIVE', booking_prefix: 'END', cash_module_enabled: true,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('opening_hours').values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: venue.id, weekday, start_min: 0, end_min: 1440 })),
    ).execute();

    async function makeFields(prefix: string, count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const f = await db.insertInto('fields').values({
          venue_id: venue.id, name: `${prefix}${i}`, sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, status: 'ACTIVE',
        }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('field_format_prices').values({ field_id: f.id, format: '5v5', hourly_rate_da: 2500 }).execute();
        ids.push(f.id);
      }
      return ids;
    }
    const fieldIdsReminder = await makeFields('R', FIELD_POOL_PER_KIND);
    const fieldIdsResult = await makeFields('S', FIELD_POOL_PER_KIND);
    const fieldIdsChallenge = await makeFields('C', FIELD_POOL_PER_KIND);
    log('fixtures:terrains-créés', { total: fieldIdsReminder.length + fieldIdsResult.length + fieldIdsChallenge.length });

    const players: Player[] = [];
    for (let i = 0; i < PLAYER_POOL_SIZE; i++) {
      const phone = `+2135${String(810000 + i).padStart(8, '0')}`;
      const name = `Joueur Endurance ${i}`;
      const user = await db.insertInto('users').values({ phone, name }).returning(['id']).executeTakeFirstOrThrow();
      await recordLegalConsent(db, 'PLAYER', user.id, '127.0.0.1');
      const token = newSessionToken();
      await db.insertInto('sessions').values({ user_id: user.id, token_hash: sha256(token) }).execute();
      players.push({ userId: user.id, name, token });
    }
    const teamARes = await httpJson('POST', '/teams', players[0]!.token, { name: 'Equipe Endurance A' });
    const teamBRes = await httpJson('POST', '/teams', players[1]!.token, { name: 'Equipe Endurance B' });
    if (teamARes.status !== 201 || teamBRes.status !== 201) {
      throw new Error(`Création des équipes de test échouée : A=${teamARes.status} B=${teamBRes.status}`);
    }
    const fixtures: Fixtures = {
      venueId: venue.id, fieldIdsReminder, fieldIdsResult, fieldIdsChallenge, players,
      teamAId: teamARes.body.team.id, teamBId: teamBRes.body.team.id,
    };
    log('fixtures:joueurs-et-équipes-créés', { players: players.length });

    // ---------- Boucle principale ----------
    const startTime = Date.now();
    const endTime = startTime + DURATION_MS;
    let iteration = 0;
    const memSamples: { t: number; rssBytes: number; privateBytes: number }[] = [];
    const matchesSeeded: SeededMatch[] = [];
    const challengesSeeded: SeededChallenge[] = [];
    const resultsSeeded: SeededResult[] = [];

    async function sampleMemory() {
      try {
        const mem = await readProcessMemory(child.pid!);
        memSamples.push({ t: Date.now(), ...mem });
        log('mémoire:échantillon', { rssMB: Math.round(mem.rssBytes / 1_048_576) });
      } catch (e) { log('mémoire:échec-échantillon', { error: String(e) }); }
    }

    async function seedOnce(i: number) {
      // Triplet de joueurs JAMAIS réutilisé sur toute la durée du run (voir fixtures.players, dimensionné en
      // conséquence) — bug trouvé au smoke test (27/09/2026) : des joueurs tournants réutilisés sur des créneaux
      // de match qui se chevauchent massivement (cadence 2 min, durée 90 min) déclenchaient la vraie règle métier
      // SCHEDULE_CONFLICT (core, match.ts) au moment de /join — pas un défaut produit, un défaut de CE script.
      const organizer = fixtures.players[(3 * i) % fixtures.players.length]!;
      const joiner1 = fixtures.players[(3 * i + 1) % fixtures.players.length]!;
      const joiner2 = fixtures.players[(3 * i + 2) % fixtures.players.length]!;

      // --- sous-mécanisme 1 : rappel H-2 (échéance réelle now+2h05, jamais Date.now() touché) ---
      const remField = fixtures.fieldIdsReminder[i % fixtures.fieldIdsReminder.length]!;
      const kickoff = Date.now() + 2 * H + DUE_LEAD_MS;
      const remBooking = await db.insertInto('bookings').values({
        field_id: remField, time_range: toPgRange({ start: kickoff, end: kickoff + 90 * MIN }),
        status: 'RESERVED', source: 'MOUBARAT', verified_by_center: true, by_user_id: organizer.userId,
        reservation_name: organizer.name, price_total_da: 2500, reference: `END-R${i}`, format: '5v5',
      }).returning('id').executeTakeFirstOrThrow();
      const remMatchRes = await httpJson('POST', '/matches', organizer.token, { bookingId: remBooking.id, title: `Endurance rappel ${i}` });
      if (remMatchRes.status !== 201) {
        log('seed:rappel:échec-création-match', { i, status: remMatchRes.status, body: remMatchRes.body });
        matchesSeeded.push({ i, matchId: '', kickoff, userIds: [], ok: false });
      } else {
        const remMatchId = remMatchRes.body.match.id;
        const join1 = await httpJson('POST', `/matches/${remMatchId}/join`, joiner1.token);
        const join2 = await httpJson('POST', `/matches/${remMatchId}/join`, joiner2.token);
        if (join1.status !== 200) log('seed:rappel:échec-join-1', { i, status: join1.status, body: join1.body });
        if (join2.status !== 200) log('seed:rappel:échec-join-2', { i, status: join2.status, body: join2.body });
        // Seuls les joueurs RÉELLEMENT JOINED comptent comme destinataires attendus du rappel — un join refusé
        // ne doit jamais gonfler artificiellement le compte de rappels "manqués" à la vérification.
        const userIds = [organizer.userId, ...(join1.status === 200 ? [joiner1.userId] : []), ...(join2.status === 200 ? [joiner2.userId] : [])];
        matchesSeeded.push({ i, matchId: remMatchId, kickoff, userIds, ok: true });
      }

      // --- sous-mécanisme 2 : expiration de défi (expires_at forcé à now+5min juste après création) ---
      const challField = fixtures.fieldIdsChallenge[i % fixtures.fieldIdsChallenge.length]!;
      const dateStr = new Date(Date.now() + (60 + i) * 24 * H).toISOString().slice(0, 10);
      // Seul le capitaine de l'équipe émettrice peut envoyer un défi (NOT_CAPTAIN sinon) — toujours l'équipe A,
      // dont le capitaine fixe est players[0] (créateur de l'équipe à la création des fixtures), jamais l'organisateur
      // rotatif du rappel ci-dessus (bug trouvé et corrigé lors du smoke test SMOKE_TEST=1, 27/09/2026).
      const challRes = await httpJson('POST', '/challenges', fixtures.players[0]!.token, {
        fromTeamId: fixtures.teamAId, toTeamId: fixtures.teamBId, sport: 'FOOTBALL', format: '5v5',
        date: dateStr, startMin: 600, durationMin: 90, venueId: fixtures.venueId, fieldId: challField,
      });
      if (challRes.status !== 201) {
        log('seed:défi:échec-création', { i, status: challRes.status, body: challRes.body });
        challengesSeeded.push({ i, challengeId: '', dueAt: 0, ok: false });
      } else {
        const challengeId = challRes.body.challenge.id;
        const dueAt = Date.now() + DUE_LEAD_MS;
        await db.updateTable('challenges').set({ expires_at: new Date(dueAt) }).where('id', '=', challengeId).execute();
        challengesSeeded.push({ i, challengeId, dueAt, ok: true });
      }

      // --- sous-mécanisme 3 : auto-confirmation résultat 24h (reported_at forcé à now-23h55 juste après soumission) ---
      const resField = fixtures.fieldIdsResult[i % fixtures.fieldIdsResult.length]!;
      const resStart = Date.now() + 3 * H; // > H-2 : passe la garde de création
      const resBooking = await db.insertInto('bookings').values({
        field_id: resField, time_range: toPgRange({ start: resStart, end: resStart + 90 * MIN }),
        status: 'RESERVED', source: 'MOUBARAT', verified_by_center: true, by_user_id: organizer.userId,
        reservation_name: organizer.name, price_total_da: 2500, reference: `END-S${i}`, format: '5v5',
      }).returning('id').executeTakeFirstOrThrow();
      const resMatchRes = await httpJson('POST', '/matches', organizer.token, { bookingId: resBooking.id, title: `Endurance résultat ${i}` });
      if (resMatchRes.status !== 201) {
        log('seed:résultat:échec-création-match', { i, status: resMatchRes.status, body: resMatchRes.body });
        resultsSeeded.push({ i, matchId: '', dueAt: 0, ok: false });
      } else {
        const resMatchId = resMatchRes.body.match.id;
        const pastStart = Date.now() - 3 * H, pastEnd = Date.now() - Math.round(1.5 * H);
        await db.updateTable('matches').set({ time_range: toPgRange({ start: pastStart, end: pastEnd }), status: 'PLAYED' }).where('id', '=', resMatchId).execute();
        const submitRes = await httpJson('POST', `/matches/${resMatchId}/result`, organizer.token, { homeScore: 2, awayScore: 1 });
        if (submitRes.status !== 201) {
          log('seed:résultat:échec-soumission', { i, status: submitRes.status, body: submitRes.body });
          resultsSeeded.push({ i, matchId: resMatchId, dueAt: 0, ok: false });
        } else {
          const dueAt = Date.now() + DUE_LEAD_MS;
          await db.updateTable('match_results').set({ reported_at: new Date(Date.now() - (24 * H - DUE_LEAD_MS)) }).where('match_id', '=', resMatchId).execute();
          resultsSeeded.push({ i, matchId: resMatchId, dueAt, ok: true });
        }
      }
    }

    await sampleMemory();
    const seedTimer = setInterval(() => {
      if (serverCrashed || Date.now() >= endTime) return;
      iteration++;
      const idx = iteration;
      seedOnce(idx).catch((e) => log('seed:erreur-non-gérée', { iteration: idx, error: String(e) }));
    }, SEED_INTERVAL_MS);
    const sampleTimer = setInterval(() => { void sampleMemory(); }, SAMPLE_INTERVAL_MS);

    log('run:démarré', { startTime, endTime, durationHeures: DURATION_MS / H });
    while (Date.now() < endTime && !serverCrashed) {
      await new Promise((r) => setTimeout(r, 10_000));
    }
    clearInterval(seedTimer);
    clearInterval(sampleTimer);
    // Laisse les dernières itérations lancées se terminer avant de figer le décompte.
    await new Promise((r) => setTimeout(r, 15_000));
    windDownStarted = true;
    await sampleMemory();
    log('run:terminé', { serverCrashed, crashInfo, iterations: iteration, actualDurationMs: Date.now() - startTime });

    // ---------- Arrêt propre (IPC 'shutdown', convention Windows — voir lib/lifecycle.ts) ----------
    if (!serverCrashed) {
      await new Promise<void>((resolve) => {
        let done = false;
        child.once('exit', () => { done = true; resolve(); });
        try { child.send?.('shutdown'); } catch { child.kill(); }
        setTimeout(() => { if (!done) { log('arrêt:délai-dépassé-sortie-forcée'); child.kill(); resolve(); } }, 40_000);
      });
      log('serveur:arrêté');
    }

    // ---------- Vérification indépendante (jamais un simple relevé de "ok" auto-déclaré) ----------
    const duplicates = await sql<{ user_id: string; type: string; ref_id: string; n: number }>`
      select user_id, type, ref_id, count(*)::int as n from notifications
      where type in ('MATCH_REMINDER', 'CHALLENGE_EXPIRED', 'RESULT_CONFIRMED')
      group by user_id, type, ref_id having count(*) > 1
    `.execute(db);

    const okMatches = matchesSeeded.filter((m) => m.ok);
    const dueMatches = okMatches.filter((m) => m.kickoff - 2 * H <= Date.now());
    const reminderChecks: { matchId: string; userId: string; found: boolean; deltaMs: number | null }[] = [];
    for (const m of dueMatches) {
      for (const userId of m.userIds) {
        const row = await db.selectFrom('notifications').select('created_at')
          .where('user_id', '=', userId).where('type', '=', 'MATCH_REMINDER').where('ref_id', '=', m.matchId)
          .executeTakeFirst();
        const expectedDueAt = m.kickoff - 2 * H;
        reminderChecks.push({
          matchId: m.matchId, userId, found: row !== undefined,
          deltaMs: row ? row.created_at.getTime() - expectedDueAt : null,
        });
      }
    }
    const missedReminders = reminderChecks.filter((c) => !c.found);
    const deltas = reminderChecks.filter((c) => c.deltaMs !== null).map((c) => c.deltaMs as number);
    const firstDeltas = deltas.slice(0, Math.min(20, deltas.length));
    const lastDeltas = deltas.slice(Math.max(0, deltas.length - 20));
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    const okChallenges = challengesSeeded.filter((c) => c.ok && c.dueAt <= Date.now());
    const challengeChecks: { challengeId: string; expired: boolean; notified: boolean }[] = [];
    for (const c of okChallenges) {
      const row = await db.selectFrom('challenges').select('status').where('id', '=', c.challengeId).executeTakeFirstOrThrow();
      const notif = await db.selectFrom('notifications').select('id').where('ref_id', '=', c.challengeId).where('type', '=', 'CHALLENGE_EXPIRED').execute();
      challengeChecks.push({ challengeId: c.challengeId, expired: row.status === 'EXPIRED', notified: notif.length === 1 });
    }

    const okResults = resultsSeeded.filter((r) => r.ok && r.dueAt <= Date.now());
    const resultChecks: { matchId: string; confirmed: boolean; notified: boolean }[] = [];
    for (const r of okResults) {
      const row = await db.selectFrom('match_results').select('status').where('match_id', '=', r.matchId).executeTakeFirstOrThrow();
      const notif = await db.selectFrom('notifications').select('id').where('ref_id', '=', r.matchId).where('type', '=', 'RESULT_CONFIRMED').execute();
      resultChecks.push({ matchId: r.matchId, confirmed: row.status === 'CONFIRMED', notified: notif.length === 1 });
    }

    const warmupCutoff = startTime + WARMUP_MS;
    const postWarmupSamples = memSamples.filter((s) => s.t >= warmupCutoff).map((s) => ({ t: s.t, y: s.rssBytes }));
    const slopeBytesPerHour = linregSlopePerHour(postWarmupSamples);
    const slopeMBPerHour = slopeBytesPerHour !== null ? slopeBytesPerHour / 1_048_576 : null;

    const verification = {
      serverCrashed, crashInfo,
      iterations: iteration,
      attempted: { matches: matchesSeeded.length, challenges: challengesSeeded.length, results: resultsSeeded.length },
      failedCreations: {
        matches: matchesSeeded.filter((m) => !m.ok).length,
        challenges: challengesSeeded.filter((c) => !c.ok).length,
        results: resultsSeeded.filter((r) => !r.ok).length,
      },
      duplicates: { count: duplicates.rows.length, rows: duplicates.rows },
      reminders: {
        due: dueMatches.length * 3, found: reminderChecks.filter((c) => c.found).length,
        missed: missedReminders.length, missedDetail: missedReminders,
        maxDeltaMs: deltas.length ? Math.max(...deltas.map(Math.abs)) : null,
        avgDeltaFirst20Ms: avg(firstDeltas), avgDeltaLast20Ms: avg(lastDeltas),
      },
      challenges: {
        due: challengeChecks.length,
        allExpired: challengeChecks.every((c) => c.expired), allNotified: challengeChecks.every((c) => c.notified),
        failures: challengeChecks.filter((c) => !c.expired || !c.notified),
      },
      results: {
        due: resultChecks.length,
        allConfirmed: resultChecks.every((r) => r.confirmed), allNotified: resultChecks.every((r) => r.notified),
        failures: resultChecks.filter((r) => !r.confirmed || !r.notified),
      },
      memory: {
        samples: memSamples.length, postWarmupSamples: postWarmupSamples.length,
        slopeBytesPerHour, slopeMBPerHour,
        thresholdMBPerHour: MEMORY_SLOPE_THRESHOLD_MB_PER_HOUR,
        withinThreshold: slopeMBPerHour !== null ? Math.abs(slopeMBPerHour) < MEMORY_SLOPE_THRESHOLD_MB_PER_HOUR : null,
        firstSampleMB: memSamples.length ? Math.round(memSamples[0]!.rssBytes / 1_048_576) : null,
        lastSampleMB: memSamples.length ? Math.round(memSamples[memSamples.length - 1]!.rssBytes / 1_048_576) : null,
      },
    };
    log('vérification:calculée', {
      duplicates: verification.duplicates.count, missedReminders: verification.reminders.missed,
      slopeMBPerHour: verification.memory.slopeMBPerHour,
    });

    const report = {
      dbName: DB_NAME, startTime, endTime: Date.now(), plannedDurationMs: DURATION_MS,
      memSamples, matchesSeeded, challengesSeeded, resultsSeeded, verification, trace,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log('rapport:écrit', { path: REPORT_PATH });

    console.log('\n=== TEST D\'ENDURANCE TERMINÉ ===');
    console.log(JSON.stringify(verification, null, 2));
  } finally {
    windDownStarted = true;
    if (!child.killed) { try { child.kill(); } catch { /* déjà mort */ } }
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    const check = await admin.query(`SELECT datname FROM pg_database WHERE datname = $1`, [DB_NAME]);
    log('nettoyage:base-supprimée', { confirmé: check.rows.length === 0 });
    await admin.end();
  }
}

main().catch((err) => { console.error('FATAL', err); process.exitCode = 1; });
