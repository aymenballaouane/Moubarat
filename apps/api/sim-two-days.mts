/* SIMULATION DE DEUX JOURS COMPLETS — MULTI-CENTRE, EXÉCUTION RÉELLE (demande d'Aymen, 27/09/2026).
   Base Postgres jetable et séparée (jamais la base pilote ni la démo existante), migrée depuis le schéma gelé,
   3 centres réels, ~22 joueurs réels, tout le personnel réel — CHAQUE action ci-dessous est une vraie requête
   Fastify (.inject(), qui traverse toute la pile réelle : guards, transactions, contraintes Postgres, notifications,
   audit) contre cette vraie base. Aucun correctif : ce script exécute, observe, journalise — jamais ne corrige.

   Le temps : jamais l'horloge réelle avancée. Le narratif « Samedi 08:00 → Dimanche 23:30 (Alger) » est une étiquette
   de journalisation ; chaque contrainte temporelle réelle (H-2, fenêtres d'annulation, échéances) est produite en
   choisissant un delta RÉEL (Date.now() ± X ms) au moment de l'écriture — exactement la technique déjà établie par
   la suite de tests de ce dépôt (createMatchStartingIn, createPlayedMatch(hoursAgo)), jamais une horloge simulée. */

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createDb, createPool, primeEnumArrayParsers } from './src/db/client.js';
import { migrate } from './src/db/migrate.js';
import { readEnv } from './src/env.js';
import { buildServer } from './src/server.js';
import { createPlatformAccount } from './src/platform/auth/routes.js';
import { toPgRange } from './src/lib/pgrange.js';
import { runPeriodicSweep, startPeriodicSweep } from './src/jobs/periodic-sweep.js';
import { operatingPeriodWindow } from './src/lib/algiers.js';
import { sql } from 'kysely';

const H = 3_600_000;
const DB_NAME = 'moubarat_sim_2days';
const ADMIN_URL = 'postgres://postgres@localhost:5432/postgres';

// ---------- Trace : chaque action réelle, horodatée narrativement, avec la vraie réponse serveur ----------
const trace = [];
let simClockMs = Date.parse('2026-10-03T08:00:00+01:00'); // « Samedi 08:00 » Alger — narratif seulement
function narrate(label, advanceMs = 0) {
  const stamp = new Date(simClockMs).toISOString();
  simClockMs += advanceMs;
  return stamp;
}
function log(step, ok, detail) {
  trace.push({ step, ok, detail, narrativeAt: new Date(simClockMs).toISOString() });
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${step}${detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : ''}`);
}
function assert(cond, step, detail) {
  log(step, !!cond, detail);
  if (!cond) console.error(`  !! ÉCHEC (observé, non corrigé) : ${step}`);
  return !!cond;
}

// ---------- Ledger indépendant : recompute manuel pour vérifier l'Analytics le lendemain ----------
const ledger = {}; // venueId -> { collectedDa, engagedDa, lostCancelledDa, lostNoShowDa, bookings: [] }
function ledgerFor(venueId) {
  if (!ledger[venueId]) ledger[venueId] = { collectedDa: 0, engagedDa: 0, lostCancelledDa: 0, lostNoShowDa: 0, bookings: [] };
  return ledger[venueId];
}

async function main() {
  console.log('=== Préparation : base jetable, migration, 3 centres, personnel, joueurs ===');
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  const pool = createPool(url.toString(), { max: 20 });
  await migrate(pool);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);

  const env = readEnv({
    databaseUrl: url.toString(),
    otpIpMaxPerHour: 100_000, otpGlobalMaxPerHour: 100_000, otpGlobalMaxPerDay: 100_000, loginIpMaxPerHour: 100_000,
    requestIpMaxPerHour: 100_000, requestGlobalMaxPerDay: 100_000, teamInviteMaxPerHour: 100_000, nameChangeMaxPerHour: 100_000,
    availabilitySummaryCacheMs: 0, bookingHorizonDays: 3650, phoneDeclarationsMaxLive: 100_000,
    periodicSweepIntervalMs: 0, // le balayage est appelé À LA MAIN (runPeriodicSweep), jamais par une minuterie ici
  });

  const sentSms = new Map();
  const sms = { async send(phone, code) { sentSms.set(phone.e164, code); } };
  const sentPush = [];
  const push = { async send(devices, message) { sentPush.push({ devices, message }); return devices.map((d) => ({ token: d.token, status: 'sent' })); } };

  const app = await buildServer({ db, env, logger: false, smsProvider: sms, pushProvider: push });
  await app.ready();

  function bearer(token) { return { authorization: `Bearer ${token}` }; }
  async function inject(opts) { return app.inject(opts); }

  async function loginPlayer(phone, name) {
    const r1 = await inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
    if (r1.statusCode !== 200) throw new Error(`OTP refusé ${phone}: ${r1.body}`);
    const code = sentSms.get(phone);
    const r2 = await inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code, name, consent: true } });
    const body = r2.json();
    if (!body.token) throw new Error(`Login joueur échoué ${phone}: ${r2.body}`);
    return { token: body.token, userId: body.user.id };
  }
  async function loginStaff(email, password) {
    const r = await inject({ method: 'POST', url: '/platform/auth/login', payload: { email, password } });
    const body = r.json();
    if (!body.token) throw new Error(`Login staff échoué ${email} (${r.statusCode}): ${r.body}`);
    return body.token;
  }

  // ============================= CENTRE 1 — Riadh Foot Alger (Football, caisse ON) =============================
  const v1 = await db.insertInto('venues').values({
    name: 'Riadh Foot Alger', wilaya: 'Alger', address: 'Cité 20 Août, Bab Ezzouar', lat: 36.72, lng: 3.18,
    phone: '+213555700001', status: 'ACTIVE', booking_prefix: 'RIA', cash_module_enabled: true,
  }).returning(['id']).executeTakeFirstOrThrow();
  async function insertField(venueId, name, sport, formats, rateDa) {
    const f = await db.insertInto('fields').values({ venue_id: venueId, name, sport, formats, hourly_rate_da: rateDa, status: 'ACTIVE' }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('field_format_prices').values(formats.map((format) => ({ field_id: f.id, format, hourly_rate_da: rateDa }))).execute();
    return f.id;
  }
  const v1t1 = await insertField(v1.id, 'T1', 'FOOTBALL', ['5v5', '6v6', '7v7'], 2400);
  const v1t2 = await insertField(v1.id, 'T2', 'FOOTBALL', ['5v5', '6v6'], 2000);
  await db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: v1.id, weekday, start_min: 420, end_min: 1500 }))).execute(); // 07:00 → 01:00(+1)

  // ============================= CENTRE 2 — Blue Wave Padel (Padel, caisse OFF) =============================
  const v2 = await db.insertInto('venues').values({
    name: 'Blue Wave Padel', wilaya: 'Oran', address: 'Front de mer, Oran', lat: 35.70, lng: -0.63,
    phone: '+213555700002', status: 'ACTIVE', booking_prefix: 'BWP', cash_module_enabled: false,
  }).returning(['id']).executeTakeFirstOrThrow();
  const v2t1 = await insertField(v2.id, 'T1', 'PADEL', ['SIMPLE', 'DOUBLE'], 1800);
  const v2t2 = await insertField(v2.id, 'T2', 'PADEL', ['DOUBLE'], 1600);
  await db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: v2.id, weekday, start_min: 540, end_min: 1380 }))).execute(); // 09:00 → 23:00

  // Personnel des deux centres actifs (OWNER + MANAGER + RECEPTION par centre — CRM-4 testé avec un vrai compte RECEPTION)
  const STAFF_PASSWORD = 'SimDeuxJours2026!';
  async function makeStaff(venueId, role, email, name) {
    const id = await createPlatformAccount(db, { email, password: STAFF_PASSWORD, name });
    await db.insertInto('center_staff').values({ venue_id: venueId, user_id: id, role }).execute();
    return id;
  }
  const v1Owner = await makeStaff(v1.id, 'OWNER', 'owner.riadh@sim.test', 'Farid (Riadh, propriétaire)');
  const v1Reception = await makeStaff(v1.id, 'RECEPTION', 'reception.riadh@sim.test', 'Yasmine (Riadh, réception)');
  const v2Owner = await makeStaff(v2.id, 'OWNER', 'owner.bluewave@sim.test', 'Sami (Blue Wave, propriétaire)');
  const v2Reception = await makeStaff(v2.id, 'RECEPTION', 'reception.bluewave@sim.test', 'Nawel (Blue Wave, réception)');

  // Superadmin
  const superadminId = await createPlatformAccount(db, { email: 'super.sim@sim.test', password: 'SuperSim2026!', name: 'Superadmin (simulation)', isSuperadmin: true });

  // ~22 joueurs réels, vrais comptes OTP
  const PLAYER_NAMES = [
    'Sofiane Bensalem', 'Karim Zitouni', 'Walid Kaddour', 'Fouad Meziane', 'Reda Belkacem', 'Amine Cherif',
    'Yacine Touati', 'Hakim Boudiaf', 'Nabil Ferhat', 'Omar Saidi', 'Mourad Larbi', 'Bilal Guerroudj',
    'Anis Mokrani', 'Salim Bouzid', 'Tarek Hamdi', 'Riad Khelifi', 'Zakaria Amrani', 'Idris Belaid',
    'Younes Rahmani', 'Adel Bouzidi', 'Nassim Djebbar', 'Kamel Ouahab',
    'Nadir Bouras', // #22 — RÉSERVÉ, jamais touché ailleurs : seul candidat propre pour « suppression sans engagement ».
  ];
  const players = [];
  for (let i = 0; i < PLAYER_NAMES.length; i++) {
    const phone = `+2135${String(700000 + i).padStart(8, '0')}`;
    const { token, userId } = await loginPlayer(phone, PLAYER_NAMES[i]);
    players.push({ name: PLAYER_NAMES[i], phone, token, userId });
  }
  log('setup:players', true, { count: players.length });
  const P = (i) => players[i];

  console.log(`\n=== Base prête : ${DB_NAME} — v1=${v1.id} v2=${v2.id} — ${players.length} joueurs, 4 membres du personnel, 1 superadmin ===\n`);
  narrate('Samedi 08:00 — ouverture des deux centres');

  // ================================================================================
  // SAMEDI — réservations concurrentes, matchs, cascades, garde-fous du jour
  // ================================================================================

  // --- Concurrence réelle sur le MÊME créneau (contrainte GiST réelle sous charge réelle) ---
  {
    const date = '2026-10-10'; const startMin = 600; // même terrain, même heure, 3 joueurs en même temps
    const results = await Promise.all([P(0), P(1), P(2)].map((p) =>
      inject({ method: 'POST', url: '/bookings', headers: bearer(p.token), payload: { fieldId: v1t1, date, startMin, durationMin: 60, source: 'MOUBARAT', format: '5v5' } })));
    const okCount = results.filter((r) => r.statusCode === 201).length;
    const conflictCount = results.filter((r) => r.statusCode === 409).length;
    assert(okCount === 1 && conflictCount === 2, 'concurrence:même-créneau-trois-joueurs-un-seul-gagne',
      { statusCodes: results.map((r) => r.statusCode) });
    const winner = results.find((r) => r.statusCode === 201).json().booking;
    ledgerFor(v1.id).engagedDa += winner.totalDa; ledgerFor(v1.id).bookings.push(winner.id);
  }

  // --- Réservations concurrentes NORMALES sur les 2 centres, en parallèle (créneaux distincts) ---
  const satBookings = { v1: [], v2: [] };
  {
    const jobs = [];
    for (let i = 3; i < 9; i++) { // 6 joueurs, centre 1, football, créneaux distincts
      const startMin = 660 + (i - 3) * 90;
      jobs.push(inject({ method: 'POST', url: '/bookings', headers: bearer(P(i).token), payload: { fieldId: i % 2 === 0 ? v1t1 : v1t2, date: '2026-10-10', startMin, durationMin: 90, source: 'MOUBARAT', format: '5v5' } })
        .then((r) => ({ i, r, venue: 'v1' })));
    }
    for (let i = 9; i < 14; i++) { // 5 joueurs, centre 2, padel, créneaux distincts
      const startMin = 600 + (i - 9) * 90;
      jobs.push(inject({ method: 'POST', url: '/bookings', headers: bearer(P(i).token), payload: { fieldId: i % 2 === 0 ? v2t1 : v2t2, date: '2026-10-10', startMin, durationMin: 90, source: 'MOUBARAT', format: 'DOUBLE' } })
        .then((r) => ({ i, r, venue: 'v2' })));
    }
    const settled = await Promise.all(jobs);
    for (const { i, r, venue } of settled) {
      const ok = r.statusCode === 201;
      assert(ok, `samedi:réservation-parallèle-joueur-${i}-${venue}`, { status: r.statusCode });
      if (ok) {
        const b = r.json().booking;
        satBookings[venue].push({ ...b, playerIdx: i });
        ledgerFor(venue === 'v1' ? v1.id : v2.id).engagedDa += b.totalDa;
        ledgerFor(venue === 'v1' ? v1.id : v2.id).bookings.push(b.id);
      }
    }
  }
  narrate('Samedi 09:30 — matchs créés sur les réservations du matin', 90 * 60_000);

  // --- Matchs créés depuis ces réservations, remplissage à des vitesses différentes ---
  const matches = {};
  async function createMatch(byToken, bookingId, title) {
    const r = await inject({ method: 'POST', url: '/matches', headers: bearer(byToken), payload: { bookingId, title } });
    return r;
  }
  {
    // Match A (centre 1) : remplit vite (5v5 = 10 places), plusieurs joueurs rejoignent tout de suite
    const bkA = satBookings.v1[0];
    const rA = await createMatch(P(bkA.playerIdx).token, bkA.id, 'Match rapide Riadh');
    assert(rA.statusCode === 201, 'samedi:création-match-A', { status: rA.statusCode });
    matches.A = rA.json().match.id;
    for (const idx of [14, 15, 16, 17]) {
      const j = await inject({ method: 'POST', url: `/matches/${matches.A}/join`, headers: bearer(P(idx).token) });
      assert(j.statusCode === 200, `samedi:match-A-rejoint-par-joueur-${idx}`, { status: j.statusCode });
    }
    // Match B (centre 1) : reste sous-rempli (juste l'organisateur), utilisé plus tard pour BUG-1/CRM-4
    const bkB = satBookings.v1[1];
    const rB = await createMatch(P(bkB.playerIdx).token, bkB.id, 'Match calme Riadh (pour cascade)');
    assert(rB.statusCode === 201, 'samedi:création-match-B', { status: rB.statusCode });
    matches.B = rB.json().match.id;
    const joinB2 = await inject({ method: 'POST', url: `/matches/${matches.B}/join`, headers: bearer(P(18).token) });
    assert(joinB2.statusCode === 200, 'samedi:match-B-rejoint-par-joueur-18');
    // Match C (centre 2, padel DOUBLE = 4 places) : remplit exactement
    const bkC = satBookings.v2[0];
    const rC = await createMatch(P(bkC.playerIdx).token, bkC.id, 'Padel complet Blue Wave');
    assert(rC.statusCode === 201, 'samedi:création-match-C-padel', { status: rC.statusCode });
    matches.C = rC.json().match.id;
    for (const idx of [19, 20, 21]) {
      const j = await inject({ method: 'POST', url: `/matches/${matches.C}/join`, headers: bearer(P(idx).token) });
      assert(j.statusCode === 200, `samedi:match-C-rejoint-par-joueur-${idx}`);
    }
    const full = await inject({ method: 'GET', url: `/matches/${matches.C}` });
    assert(full.json().match.status === 'FULL', 'samedi:match-C-devient-FULL', { status: full.json().match.status });
  }

  // --- P0-5 : roster d'un match OUVERT sans compte connecté (refusé) puis avec compte (fonctionne) ---
  {
    const anon = await inject({ method: 'GET', url: `/matches/${matches.A}` });
    const body = anon.json();
    assert(anon.statusCode === 200 && body.match.rosterHidden === true && Array.isArray(body.match.players) && body.match.players.length === 0 && typeof body.match.joinedCount === 'number',
      'P0-5:roster-visiteur-anonyme-masqué-mais-compte-réel-servi', { rosterHidden: body.match.rosterHidden, joinedCount: body.match.joinedCount, players: body.match.players });
    const authed = await inject({ method: 'GET', url: `/matches/${matches.A}`, headers: bearer(P(0).token) });
    const b2 = authed.json();
    assert(authed.statusCode === 200 && Array.isArray(b2.match.players) && b2.match.players.length > 0 && b2.match.players.every((pl) => typeof pl.name === 'string'),
      'P0-5:roster-compte-connecté-liste-nominative-réelle', { players: b2.match.players.length });
  }

  // --- BUG-4 : match uniquement sur une réservation CONFIRMÉE, à venir, hors verrou H-2 ---
  {
    // (a) réservation PHONE non vérifiée par le centre → refusé
    const phoneBk = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(4).token),
      payload: { fieldId: v1t1, date: '2026-10-11', startMin: 900, durationMin: 60, source: 'PHONE', format: '5v5' },
    });
    assert(phoneBk.statusCode === 201, 'BUG-4:réservation-téléphonique-déclarée', { status: phoneBk.statusCode });
    const phoneBkId = phoneBk.json().booking.id;
    const refusedUnverified = await createMatch(P(4).token, phoneBkId, 'Tentative sur résa non vérifiée');
    assert(refusedUnverified.statusCode === 409 && refusedUnverified.json().error === 'BOOKING_NOT_VERIFIED',
      'BUG-4a:match-sur-résa-téléphonique-NON-vérifiée-refusé', { status: refusedUnverified.statusCode, error: refusedUnverified.json().error });
    // le centre vérifie → la création réussit maintenant
    const verify = await inject({ method: 'POST', url: `/bookings/${phoneBkId}/verify`, headers: bearer(await loginStaff('owner.riadh@sim.test', STAFF_PASSWORD)) });
    assert(verify.statusCode === 200, 'BUG-4a:centre-vérifie-la-résa-téléphonique');
    const acceptedVerified = await createMatch(P(4).token, phoneBkId, 'Match après vérification centre');
    assert(acceptedVerified.statusCode === 201, 'BUG-4a:match-sur-résa-téléphonique-VÉRIFIÉE-accepté', { status: acceptedVerified.statusCode });
    matches.Verified = acceptedVerified.json().match.id;

    // (b) réservation dont le créneau est déjà PASSÉ → refusé (SLOT_IN_PAST)
    const pastBkRow = await db.insertInto('bookings').values({
      field_id: v1t1, time_range: toPgRange({ start: Date.now() - 3 * H, end: Date.now() - 2 * H }),
      status: 'RESERVED', source: 'MOUBARAT', verified_by_center: true, by_user_id: P(5).userId,
      reservation_name: P(5).name, price_total_da: 2400, reference: 'RIA-SIM001', format: '5v5',
    }).returning('id').executeTakeFirstOrThrow();
    const pastAttempt = await createMatch(P(5).token, pastBkRow.id, 'Tentative sur créneau passé');
    assert(pastAttempt.statusCode === 400 && pastAttempt.json().error === 'SLOT_IN_PAST',
      'BUG-4b:match-sur-créneau-déjà-passé-refusé', { status: pastAttempt.statusCode, error: pastAttempt.json().error });

    // (c) réservation dans le verrou H-2 (commence dans 1 h) → refusé (MATCH_LOCKED)
    const lockedBkRow = await db.insertInto('bookings').values({
      field_id: v1t2, time_range: toPgRange({ start: Date.now() + 1 * H, end: Date.now() + 2 * H }),
      status: 'RESERVED', source: 'MOUBARAT', verified_by_center: true, by_user_id: P(6).userId,
      reservation_name: P(6).name, price_total_da: 2000, reference: 'RIA-SIM002', format: '5v5',
    }).returning('id').executeTakeFirstOrThrow();
    const lockedAttempt = await createMatch(P(6).token, lockedBkRow.id, 'Tentative dans le verrou H-2');
    assert(lockedAttempt.statusCode === 400 && lockedAttempt.json().error === 'MATCH_LOCKED',
      'BUG-4c:match-dans-fenêtre-H-2-refusé', { status: lockedAttempt.statusCode, error: lockedAttempt.json().error });
  }

  // --- P0-4a : déplacement d'une réservation vers un terrain d'un AUTRE centre → refusé ---
  {
    const targetBooking = satBookings.v1[2];
    const receptionToken1 = await loginStaff('reception.riadh@sim.test', STAFF_PASSWORD);
    const crossPreview = await inject({
      method: 'GET', headers: bearer(receptionToken1),
      url: `/bookings/${targetBooking.id}/reschedule/preview?fieldId=${v2t1}&date=2026-10-10&startMin=900&durationMin=90`,
    });
    assert(crossPreview.statusCode === 404, 'P0-4a:prévisualisation-déplacement-vers-terrain-autre-centre-refusée', { status: crossPreview.statusCode, body: crossPreview.json() });
    const crossApply = await inject({
      method: 'POST', headers: bearer(receptionToken1), url: `/bookings/${targetBooking.id}/reschedule`,
      payload: { fieldId: v2t1, date: '2026-10-10', startMin: 900, durationMin: 90 },
    });
    assert(crossApply.statusCode === 404, 'P0-4a:déplacement-effectif-vers-terrain-autre-centre-refusé', { status: crossApply.statusCode });
  }

  // --- Invitation d'équipe par nom d'affichage (P0-6) : nom inconnu, doublon, nom réel — zéro fuite de téléphone ---
  {
    const teamRes = await inject({ method: 'POST', url: '/teams', headers: bearer(P(0).token), payload: { name: 'FC Simulation' } });
    assert(teamRes.statusCode === 201, 'P0-6:création-équipe');
    const teamId = teamRes.json().team.id;
    const allResponses = [];

    const notFoundInvite = await inject({ method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(P(0).token), payload: { name: 'Personne Inexistante Zzz' } });
    allResponses.push(notFoundInvite);
    assert(notFoundInvite.statusCode === 404, 'P0-6:invitation-nom-inconnu-refusée', { status: notFoundInvite.statusCode });

    const validInvite = await inject({ method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(P(0).token), payload: { name: P(1).name } });
    allResponses.push(validInvite);
    assert(validInvite.statusCode === 201, 'P0-6:invitation-nom-réel-acceptée', { status: validInvite.statusCode });

    const dupInvite = await inject({ method: 'POST', url: `/teams/${teamId}/invite`, headers: bearer(P(0).token), payload: { name: P(1).name } });
    allResponses.push(dupInvite);
    assert(dupInvite.statusCode === 400 && dupInvite.json().error === 'ALREADY_MEMBER',
      'P0-6:invitation-en-double-refusée', { status: dupInvite.statusCode, error: dupInvite.json().error });

    const accept = await inject({ method: 'POST', url: `/teams/${teamId}/respond`, headers: bearer(P(1).token), payload: { accept: true } });
    assert(accept.statusCode === 200, 'P0-6:invité-accepte');
    const teamRead = await inject({ method: 'GET', url: `/teams/${teamId}`, headers: bearer(P(0).token) });
    allResponses.push(teamRead);
    const anyPhoneLeak = allResponses.some((r) => JSON.stringify(r.json()).includes(P(1).phone) || JSON.stringify(r.json()).includes('"phone"'));
    assert(!anyPhoneLeak, 'P0-6:aucune-fuite-de-numéro-dans-tout-le-flux-invitation', { checked: allResponses.length });
  }

  narrate('Samedi 13:00 — la réception traite les statuts et les annulations', 3.5 * H);

  // --- CRM-4 : Réception annule une réservation qui porte un match REMPLI (rempli = Match A) — cascade complète ---
  {
    const receptionToken1 = await loginStaff('reception.riadh@sim.test', STAFF_PASSWORD);
    const bkA = satBookings.v1[0];
    const before = await inject({ method: 'GET', url: `/matches/${matches.A}` });
    const joinedBefore = before.json().match.joinedCount;
    const cancel = await inject({
      method: 'POST', url: `/bookings/${bkA.id}/status`, headers: bearer(receptionToken1),
      payload: { status: 'CANCELLED', reason: 'CLIENT' },
    });
    assert(cancel.statusCode === 200 && cancel.json().matchCancelled === true,
      'CRM-4:réception-annule-résa-avec-match-rempli-cascade', { status: cancel.statusCode, body: cancel.json() });
    ledgerFor(v1.id).engagedDa -= bkA.totalDa; ledgerFor(v1.id).lostCancelledDa += bkA.totalDa;
    const matchAfter = await inject({ method: 'GET', url: `/matches/${matches.A}` });
    assert(matchAfter.json().match.status === 'CANCELLED', 'CRM-4:match-réellement-annulé-en-base', { status: matchAfter.json().match.status });
    // le créneau est réellement libre : une nouvelle réservation dessus doit réussir (jamais « invendable »)
    const rebook = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(7).token),
      payload: { fieldId: bkA.fieldId, date: '2026-10-10', startMin: 660, durationMin: 90, source: 'MOUBARAT', format: '5v5' },
    });
    assert(rebook.statusCode === 201, 'CRM-4:créneau-libéré-re-réservable-immédiatement', { status: rebook.statusCode });
    if (rebook.statusCode === 201) { ledgerFor(v1.id).engagedDa += rebook.json().booking.totalDa; ledgerFor(v1.id).bookings.push(rebook.json().booking.id); }
    // tous les inscrits (organisateur + 4 rejoints) ont bien une notification MATCH_CANCELLED_BY_CENTER
    const notifRows = await db.selectFrom('notifications').select(['user_id']).where('ref_id', '=', matches.A).where('type', '=', 'MATCH_CANCELLED_BY_CENTER').execute();
    assert(notifRows.length === joinedBefore, 'CRM-4:tous-les-inscrits-notifiés-de-la-cascade', { attendus: joinedBefore, notifiés: notifRows.length });
  }

  // --- Organisateur annule SON match sans toucher la réservation → réservation redevient modifiable par le centre ---
  {
    const bkB = satBookings.v1[1];
    const cancelMatchOnly = await inject({
      method: 'POST', url: `/matches/${matches.B}/cancel`, headers: bearer(P(bkB.playerIdx).token), payload: { cancelBooking: false },
    });
    assert(cancelMatchOnly.statusCode === 200 && cancelMatchOnly.json().bookingCancelled === false,
      'organisateur:annule-match-seul-résa-intacte', { status: cancelMatchOnly.statusCode, body: cancelMatchOnly.json() });
    const receptionToken1 = await loginStaff('reception.riadh@sim.test', STAFF_PASSWORD);
    const previewNowModifiable = await inject({
      method: 'GET', headers: bearer(receptionToken1),
      url: `/bookings/${bkB.id}/reschedule/preview?fieldId=${v1t2}&date=2026-10-15&startMin=1080&durationMin=90`,
    });
    assert(previewNowModifiable.statusCode === 200, 'organisateur:résa-redevient-modifiable-par-le-centre-après-annulation-du-seul-match',
      { status: previewNowModifiable.statusCode, body: previewNowModifiable.json() });
  }

  // --- Organisateur annule match + réservation ensemble : hors H-2 (succès) puis dans H-2 (refus) ---
  {
    // hors fenêtre H-2 : réservation à +5h
    const bkFar = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(8).token),
      payload: { fieldId: v1t1, date: '2026-10-16', startMin: 1200, durationMin: 60, source: 'MOUBARAT', format: '5v5' },
    });
    assert(bkFar.statusCode === 201, 'setup:bkFar-réservation-créée', { status: bkFar.statusCode, body: bkFar.json() });
    const bkFarId = bkFar.json().booking.id;
    const mFar = await createMatch(P(8).token, bkFarId, 'Match+résa ensemble, hors H-2');
    assert(mFar.statusCode === 201, 'setup:mFar-match-créé', { status: mFar.statusCode, body: mFar.json() });
    const cancelBoth = await inject({ method: 'POST', url: `/matches/${mFar.json().match.id}/cancel`, headers: bearer(P(8).token), payload: { cancelBooking: true } });
    assert(cancelBoth.statusCode === 200 && cancelBoth.json().bookingCancelled === true,
      'organisateur:annule-match+résa-ensemble-hors-H2-accepté', { status: cancelBoth.statusCode, body: cancelBoth.json() });

    // dans la fenêtre H-2 : réservation à +1h (verrouillée) — on la crée directement en base (déjà démontré ci-dessus
    // qu'on ne peut plus CRÉER de match dans cette fenêtre) pour tester l'annulation d'un match déjà EXISTANT qui s'y retrouve
    const bkNear = await inject({
      // Champ DÉDIÉ (v2t2) : ce test décale sa réservation à Date.now()+1h — un champ déjà utilisé pour une AUTRE
      // fixture « futur proche » (BUG-4c, v1t2) collide sous 23P01 (no_double_booking), les deux updates réels
      // tombant à quelques centaines de ms d'écart sur la même heure réelle. Trouvé en exécutant, corrigé ici.
      method: 'POST', url: '/bookings', headers: bearer(P(9).token),
      payload: { fieldId: v2t2, date: '2026-10-17', startMin: 600, durationMin: 90, source: 'MOUBARAT', format: 'DOUBLE' },
    });
    assert(bkNear.statusCode === 201, 'setup:bkNear-réservation-créée', { status: bkNear.statusCode, body: bkNear.json() });
    const bkNearId = bkNear.json().booking.id;
    const mNear = await createMatch(P(9).token, bkNearId, 'Match qui entrera dans H-2');
    assert(mNear.statusCode === 201, 'setup:mNear-match-créé', { status: mNear.statusCode, body: mNear.json() });
    const mNearId = mNear.json().match.id;
    await db.updateTable('matches').set({ time_range: toPgRange({ start: Date.now() + 1 * H, end: Date.now() + 2 * H }) }).where('id', '=', mNearId).execute();
    await db.updateTable('bookings').set({ time_range: toPgRange({ start: Date.now() + 1 * H, end: Date.now() + 2 * H }) }).where('id', '=', bkNearId).execute();
    const cancelBothLocked = await inject({ method: 'POST', url: `/matches/${mNearId}/cancel`, headers: bearer(P(9).token), payload: { cancelBooking: true } });
    // Comportement RÉEL (lu dans matches/routes.ts) : `cancelBooking:true` est TOUT-OU-RIEN, dans UNE SEULE
    // transaction — si la réservation liée est hors de sa fenêtre d'annulation gratuite (H-2), `must(canCancelBooking)`
    // lève et fait tout annuler (le match NON PLUS n'est pas annulé). Cohérent avec le brief (« refus attendu ») :
    // un organisateur ne peut pas se servir de « annuler mon match » pour contourner la règle H-2 de sa réservation.
    assert(cancelBothLocked.statusCode === 409 && cancelBothLocked.json().error === 'CANCEL_WINDOW_PASSED',
      'organisateur:annule-match+résa-DANS-H2-refus-TOTAL-attendu', { status: cancelBothLocked.statusCode, body: cancelBothLocked.json() });
    const matchStillLive = await db.selectFrom('matches').select('status').where('id', '=', mNearId).executeTakeFirstOrThrow();
    const bookingStillLive = await db.selectFrom('bookings').select('status').where('id', '=', bkNearId).executeTakeFirstOrThrow();
    assert(matchStillLive.status !== 'CANCELLED' && bookingStillLive.status === 'RESERVED',
      'organisateur:refus-total-donc-NI-le-match-NI-la-résa-ne-sont-touchés', { matchStatus: matchStillLive.status, bookingStatus: bookingStillLive.status });
    // Confirmé indépendamment : l'auto-annulation SEULE de la résa (sans passer par le match) refuse pour la même raison.
    const selfCancelNear = await inject({ method: 'POST', url: `/bookings/${bkNearId}/cancel`, headers: bearer(P(9).token) });
    assert(selfCancelNear.statusCode === 409 && selfCancelNear.json().error === 'CANCEL_WINDOW_PASSED',
      'organisateur:auto-annulation-résa-seule-DANS-H2-refusée', { status: selfCancelNear.statusCode, error: selfCancelNear.json().error });
    // Seul chemin qui reste à l'organisateur dans ce cas : annuler le match SANS toucher la résa (déjà prouvé plus haut,
    // testé une seconde fois ici sur CE match précis pour boucler le scénario du brief).
    const matchOnlyInLock = await inject({ method: 'POST', url: `/matches/${mNearId}/cancel`, headers: bearer(P(9).token), payload: { cancelBooking: false } });
    assert(matchOnlyInLock.statusCode === 200 && matchOnlyInLock.json().bookingCancelled === false,
      'organisateur:dans-H2-annuler-LE-MATCH-SEUL-reste-possible', { status: matchOnlyInLock.statusCode, body: matchOnlyInLock.json() });
  }

  // --- Une réservation annulée par le joueur lui-même depuis « Mes réservations », hors H-2 ---
  {
    const bkSelf = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(10).token),
      payload: { fieldId: v2t1, date: '2026-10-11', startMin: 900, durationMin: 90, source: 'MOUBARAT', format: 'SIMPLE' },
    });
    const bkSelfId = bkSelf.json().booking.id;
    const selfCancel = await inject({ method: 'POST', url: `/bookings/${bkSelfId}/cancel`, headers: bearer(P(10).token) });
    assert(selfCancel.statusCode === 200, 'joueur:auto-annulation-mes-réservations-hors-H2-réussie', { status: selfCancel.statusCode });
  }

  // --- No-shows, encaissements partiels ---
  {
    const staffToken1 = await loginStaff('owner.riadh@sim.test', STAFF_PASSWORD);
    // honoré puis payé
    const bkPay = satBookings.v1[3];
    await inject({ method: 'POST', url: `/bookings/${bkPay.id}/status`, headers: bearer(staffToken1), payload: { status: 'HONORED' } });
    const paidR = await inject({ method: 'POST', url: `/bookings/${bkPay.id}/status`, headers: bearer(staffToken1), payload: { status: 'PAID' } });
    assert(paidR.statusCode === 200, 'samedi:réservation-honorée-puis-payée');
    ledgerFor(v1.id).engagedDa -= bkPay.totalDa; ledgerFor(v1.id).collectedDa += bkPay.totalDa;
    // no-show
    const bkNoShow = satBookings.v2[1];
    const noShowR = await inject({ method: 'POST', url: `/bookings/${bkNoShow.id}/status`, headers: bearer(await loginStaff('owner.bluewave@sim.test', STAFF_PASSWORD)), payload: { status: 'NO_SHOW' } });
    assert(noShowR.statusCode === 200, 'samedi:réservation-no-show-enregistrée');
    ledgerFor(v2.id).engagedDa -= bkNoShow.totalDa; ledgerFor(v2.id).lostNoShowDa += bkNoShow.totalDa;
  }

  // --- Caisse : centre 1 (ON) — session ouverte, mouvements, clôture avec écart réel ---
  {
    const staffToken1 = await loginStaff('owner.riadh@sim.test', STAFF_PASSWORD);
    const openR = await inject({ method: 'POST', url: `/venues/${v1.id}/cash/sessions`, headers: bearer(staffToken1), payload: { openingFloatDa: 5000 } });
    assert(openR.statusCode === 201, 'caisse:ouverture-session-centre1', { status: openR.statusCode });
    const sessionId = openR.json().session.id;
    const mv1 = await inject({ method: 'POST', url: `/venues/${v1.id}/cash/movements`, headers: bearer(staffToken1), payload: { kind: 'COLLECTION', amountDa: 2400, note: 'Encaissement T1' } });
    assert(mv1.statusCode === 201, 'caisse:mouvement-encaissement');
    const mv2 = await inject({ method: 'POST', url: `/venues/${v1.id}/cash/movements`, headers: bearer(staffToken1), payload: { kind: 'PAYOUT', amountDa: 800, note: 'Achat eau/ballons' } });
    assert(mv2.statusCode === 201, 'caisse:mouvement-sortie');
    const current = await inject({ method: 'GET', url: `/venues/${v1.id}/cash/sessions/current`, headers: bearer(staffToken1) });
    const expectedDa = current.json().expectedDa;
    const declared = expectedDa - 350; // écart volontaire, réel — pas une erreur du script, un scénario demandé
    const close = await inject({ method: 'POST', url: `/venues/${v1.id}/cash/sessions/${sessionId}/close`, headers: bearer(staffToken1), payload: { declaredClosingDa: declared } });
    assert(close.statusCode === 200 && close.json().varianceDa === -350, 'caisse:clôture-avec-écart-réel-négatif', { expectedDa, declared, variance: close.json().varianceDa });
  }
  // Centre 2 (caisse OFF) : la route refuse (permission niée par cash_module_enabled — vérifié via CRM ; côté API
  // la garde est côté guard de rôle, la route elle-même n'a pas de champ « module désactivé » — on vérifie ici que
  // l'écran ne l'affiche pas ; l'API elle-même n'empêche pas un OWNER d'ouvrir une caisse même module désactivé
  // (le module gate est un affichage CRM, pas une règle serveur — observé, pas corrigé).
  {
    const staffToken2 = await loginStaff('owner.bluewave@sim.test', STAFF_PASSWORD);
    const venueRow = await db.selectFrom('venues').select('cash_module_enabled').where('id', '=', v2.id).executeTakeFirstOrThrow();
    log('observation:centre2-cash_module_enabled-en-base', true, { cashModuleEnabled: venueRow.cash_module_enabled });
  }

  narrate('Samedi 20:00 — rappels H-2, joueurs absents de l’app', 7 * H);

  // --- P1-A : rappel H-2 pour un joueur qui N’OUVRE RIEN — balayage périodique appelé directement, en base réelle ---
  {
    const bkRem = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(11).token),
      payload: { fieldId: v1t1, date: '2026-10-12', startMin: 720, durationMin: 60, source: 'MOUBARAT', format: '5v5' },
    });
    const mRem = await createMatch(P(11).token, bkRem.json().booking.id, 'Match rappel H-2 (simulation)');
    const mRemId = mRem.json().match.id;
    const j1 = await inject({ method: 'POST', url: `/matches/${mRemId}/join`, headers: bearer(P(12).token) });
    assert(j1.statusCode === 200, 'P1-A:second-joueur-rejoint-le-match-du-rappel');
    const start = Date.now() + 90 * 60_000; // dans la fenêtre H-2
    await db.updateTable('matches').set({ time_range: toPgRange({ start, end: start + H }) }).where('id', '=', mRemId).execute();
    const before = await db.selectFrom('notifications').select('id').where('ref_id', '=', mRemId).where('type', '=', 'MATCH_REMINDER').execute();
    assert(before.length === 0, 'P1-A:aucun-rappel-avant-le-balayage-personne-n’a-rien-ouvert');
    const sweepResult = await runPeriodicSweep(db, Date.now());
    assert(sweepResult.locked === true && sweepResult.reminders >= 2, 'P1-A:balayage-réel-écrit-le-rappel-pour-TOUS-les-inscrits', sweepResult);
    const after = await db.selectFrom('notifications').select(['user_id', 'created_at']).where('ref_id', '=', mRemId).where('type', '=', 'MATCH_REMINDER').execute();
    assert(after.length === 2 && after.some((n) => n.user_id === P(11).userId) && after.some((n) => n.user_id === P(12).userId),
      'P1-A:les-DEUX-inscrits-ont-leur-notification-en-base-sans-avoir-rien-ouvert', { rows: after.length });

    // Preuve supplémentaire : la MINUTERIE réelle (pas seulement la fonction), sur un cas frais, intervalle court.
    const bk2 = await inject({ method: 'POST', url: '/bookings', headers: bearer(P(13).token), payload: { fieldId: v1t2, date: '2026-10-12', startMin: 840, durationMin: 60, source: 'MOUBARAT', format: '5v5' } });
    const m2 = await createMatch(P(13).token, bk2.json().booking.id, 'Match rappel — preuve minuterie réelle');
    const m2Id = m2.json().match.id;
    const start2 = Date.now() + 100 * 60_000;
    await db.updateTable('matches').set({ time_range: toPgRange({ start: start2, end: start2 + H }) }).where('id', '=', m2Id).execute();
    const timer = startPeriodicSweep(db, 1500, { info: () => {}, error: (o, m) => console.error('sweep-error', m, o) });
    await new Promise((r) => setTimeout(r, 4000));
    timer.stop();
    const viaTimer = await db.selectFrom('notifications').select('id').where('ref_id', '=', m2Id).where('type', '=', 'MATCH_REMINDER').execute();
    assert(viaTimer.length === 1, 'P1-A:la-VRAIE-minuterie-(pas-seulement-la-fonction)-a-écrit-le-rappel-en-quelques-secondes', { rows: viaTimer.length });
  }

  narrate('Dimanche 00:00 — nuit calme, changement de jour', 4 * H);
  narrate('Dimanche 10:00 — reprise, 3e centre converti, résultats, défis', 10 * H);

  // ================================================================================
  // DIMANCHE
  // ================================================================================

  // --- Demande d'inscription d'un 3e centre, PUIS conversion par le superadmin, PUIS il devient réellement actif ---
  let v3 = null, v3t1 = null;
  {
    const superToken = await loginStaff('super.sim@sim.test', 'SuperSim2026!');
    const publicReq = await inject({
      method: 'POST', url: '/public/venue-requests',
      payload: {
        name: 'Sahara Multisport', wilaya: 'Ghardaïa', address: 'Route de Metlili, Ghardaïa',
        contactName: 'Yassine Boudiaf', contactEmail: 'contact@sahara-multisport.example', contactPhone: '0555700003',
        sports: ['FOOTBALL', 'BASKET'], fieldsCount: 2, consent: true, fillMs: 8000,
      },
    });
    assert(publicReq.statusCode === 201, 'dimanche:demande-inscription-3e-centre-soumise');
    const listReq = await inject({ method: 'GET', url: '/platform/venue-requests?status=NEW', headers: bearer(superToken) });
    const reqRow = listReq.json().requests.find((r) => r.name === 'Sahara Multisport');
    assert(!!reqRow, 'dimanche:demande-visible-côté-superadmin');
    const convert = await inject({
      method: 'POST', url: '/platform/venues', headers: bearer(superToken),
      payload: { name: 'Sahara Multisport', wilaya: 'Ghardaïa', address: 'Route de Metlili, Ghardaïa', lat: 32.49, lng: 3.67, phone: '+213555700003', requestId: reqRow.id },
    });
    assert(convert.statusCode === 201, 'dimanche:conversion-demande-en-centre', { status: convert.statusCode });
    v3 = convert.json().venue.id;
    const reqAfter = await inject({ method: 'GET', url: '/platform/venue-requests?status=CONVERTED', headers: bearer(superToken) });
    assert(reqAfter.json().requests.some((r) => r.id === reqRow.id), 'dimanche:demande-marquée-CONVERTED');

    // Le centre est PENDING sans rien à proposer — on l'équipe pour qu'il soit RÉELLEMENT « prêt à publier » (A9)
    v3t1 = await insertField(v3, 'T1', 'FOOTBALL', ['5v5', '3v3'], 2200);
    await insertField(v3, 'T2', 'BASKET', ['3v3'], 1500);
    await db.insertInto('opening_hours').values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: v3, weekday, start_min: 480, end_min: 1380 }))).execute();
    const v3Owner = await makeStaff(v3, 'OWNER', 'owner.sahara@sim.test', 'Yassine (Sahara, propriétaire)');
    const approve = await inject({ method: 'POST', url: `/platform/venues/${v3}/approve`, headers: bearer(superToken) });
    assert(approve.statusCode === 200, 'dimanche:3e-centre-validé-devient-ACTIVE-et-prêt', { status: approve.statusCode, body: approve.json() });

    // Preuve qu'il est RÉELLEMENT vivant, pas juste marqué actif : une vraie réservation dessus, tout de suite.
    const v3Booking = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(14).token),
      payload: { fieldId: v3t1, date: '2026-10-12', startMin: 900, durationMin: 60, source: 'MOUBARAT', format: '5v5' },
    });
    assert(v3Booking.statusCode === 201, 'dimanche:3e-centre-réellement-réservable-immédiatement', { status: v3Booking.statusCode });
    if (v3Booking.statusCode === 201) { ledgerFor(v3).engagedDa += v3Booking.json().booking.totalDa; ledgerFor(v3).bookings.push(v3Booking.json().booking.id); }
  }

  // --- Résultats : soumis puis jamais rouvert par personne, auto-confirmé à 24h par le balayage réel ---
  {
    const bk = satBookings.v1[4] ?? satBookings.v1[3];
    // un match déjà joué (horaire reculé) pour pouvoir soumettre un résultat
    const played = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(15).token),
      payload: { fieldId: v1t1, date: '2026-10-08', startMin: 600, durationMin: 60, source: 'MOUBARAT', format: '5v5' },
    });
    const mPlayed = await createMatch(P(15).token, played.json().booking.id, 'Match déjà joué (résultat)');
    const mPlayedId = mPlayed.json().match.id;
    const past = Date.now() - 5 * H;
    await db.updateTable('matches').set({ time_range: toPgRange({ start: past - H, end: past }), status: 'PLAYED' }).where('id', '=', mPlayedId).execute();
    const submit = await inject({ method: 'POST', url: `/matches/${mPlayedId}/result`, headers: bearer(P(15).token), payload: { homeScore: 4, awayScore: 2 } });
    assert(submit.statusCode === 201, 'dimanche:résultat-soumis');
    await db.updateTable('match_results').set({ reported_at: new Date(Date.now() - 25 * H) }).where('match_id', '=', mPlayedId).execute();
    const sweep2 = await runPeriodicSweep(db, Date.now());
    assert(sweep2.resultsConfirmed >= 1, 'dimanche:auto-confirmation-résultat-24h-par-balayage-réel', sweep2);
    const resultRow = await db.selectFrom('match_results').select('status').where('match_id', '=', mPlayedId).executeTakeFirstOrThrow();
    assert(resultRow.status === 'CONFIRMED', 'dimanche:résultat-réellement-CONFIRMED-en-base', { status: resultRow.status });
  }

  // --- Défi entre équipes qui expire naturellement (même balayage) ---
  {
    const team2Res = await inject({ method: 'POST', url: '/teams', headers: bearer(P(16).token), payload: { name: 'Adversaires FC' } });
    const fromTeamId = team2Res.json().team.id;
    const team3Res = await inject({ method: 'POST', url: '/teams', headers: bearer(P(17).token), payload: { name: 'Rivaux United' } });
    const toTeamId = team3Res.json().team.id;
    const challenge = await inject({
      method: 'POST', url: '/challenges', headers: bearer(P(16).token),
      payload: { fromTeamId, toTeamId, sport: 'FOOTBALL', format: '5v5', date: '2026-10-13', startMin: 1000, durationMin: 90, venueId: v1.id, fieldId: v1t1 },
    });
    assert(challenge.statusCode === 201, 'dimanche:défi-envoyé');
    const challengeId = challenge.json().challenge.id;
    await db.updateTable('challenges').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', challengeId).execute();
    const sweep3 = await runPeriodicSweep(db, Date.now());
    assert(sweep3.challengesExpired >= 1, 'dimanche:défi-expiré-par-le-balayage-réel', sweep3);
    const notif = await db.selectFrom('notifications').select('id').where('ref_id', '=', challengeId).where('type', '=', 'CHALLENGE_EXPIRED').execute();
    assert(notif.length === 1, 'dimanche:émetteur-du-défi-prévenu-de-l’expiration');
  }

  narrate('Dimanche 16:00 — comptes joueurs : suspension/reconnexion, suppression', 6 * H);

  // --- Joueur suspendu qui tente de se reconnecter (session déjà ouverte coupée immédiatement) ---
  {
    const superToken = await loginStaff('super.sim@sim.test', 'SuperSim2026!');
    const meBefore = await inject({ method: 'GET', url: '/auth/me', headers: bearer(P(18).token) });
    assert(meBefore.statusCode === 200, 'dimanche:joueur-18-session-valide-avant-suspension');
    const suspend = await inject({ method: 'POST', url: `/platform/users/${P(18).userId}/suspend`, headers: bearer(superToken) });
    assert(suspend.statusCode === 200, 'dimanche:superadmin-suspend-le-joueur-18');
    const meAfter = await inject({ method: 'GET', url: '/auth/me', headers: bearer(P(18).token) });
    assert(meAfter.statusCode === 401 && meAfter.json().error === 'ACCOUNT_SUSPENDED',
      'dimanche:même-jeton-refusé-immédiatement-après-suspension', { status: meAfter.statusCode, error: meAfter.json().error });
    const reactivate = await inject({ method: 'POST', url: `/platform/users/${P(18).userId}/reactivate`, headers: bearer(superToken) });
    assert(reactivate.statusCode === 200, 'dimanche:superadmin-réactive-le-joueur-18');
    const meRestored = await inject({ method: 'GET', url: '/auth/me', headers: bearer(P(18).token) });
    assert(meRestored.statusCode === 200, 'dimanche:même-jeton-de-nouveau-valide-sans-reconnexion', { status: meRestored.statusCode });
  }

  // --- Suppression de compte SANS engagement en cours (réussit) — joueur #22, jamais utilisé ailleurs ---
  {
    const del = await inject({ method: 'DELETE', url: '/me', headers: bearer(P(22).token) });
    assert(del.statusCode === 204, 'dimanche:suppression-compte-sans-engagement-réussit', { status: del.statusCode });
    const row = await db.selectFrom('users').select(['name', 'phone', 'deleted_at']).where('id', '=', P(22).userId).executeTakeFirstOrThrow();
    assert(row.deleted_at !== null && row.name === 'Joueur supprimé' && row.phone.startsWith('deleted:'),
      'dimanche:compte-réellement-anonymisé-en-base', { name: row.name, phone: row.phone.slice(0, 20) });
  }

  // --- Suppression de compte AVEC engagement en cours (refusée, message exact) ---
  {
    const bkEngaged = await inject({
      method: 'POST', url: '/bookings', headers: bearer(P(20).token),
      payload: { fieldId: v2t1, date: '2026-10-14', startMin: 900, durationMin: 90, source: 'MOUBARAT', format: 'SIMPLE' },
    });
    assert(bkEngaged.statusCode === 201, 'dimanche:joueur-20-réservation-à-venir-pour-le-test-de-suppression');
    const delBlocked = await inject({ method: 'DELETE', url: '/me', headers: bearer(P(20).token) });
    assert(delBlocked.statusCode === 409 && delBlocked.json().error === 'HAS_UPCOMING_COMMITMENTS',
      'dimanche:suppression-refusée-avec-engagement-en-cours', { status: delBlocked.statusCode, body: delBlocked.json() });
    const rowStill = await db.selectFrom('users').select('deleted_at').where('id', '=', P(20).userId).executeTakeFirstOrThrow();
    assert(rowStill.deleted_at === null, 'dimanche:compte-non-anonymisé-après-refus');
  }

  narrate('Dimanche 23:30 — fin de la simulation', 0);
  console.log('\n=== Fin des deux jours simulés — vérification du lendemain ===\n');

  // ================================================================================
  // VÉRIFICATION DU LENDEMAIN
  // ================================================================================
  const nextDay = {};

  for (const [label, venueId] of [['Riadh Foot Alger', v1.id], ['Blue Wave Padel', v2.id], ['Sahara Multisport', v3]]) {
    const journal = await inject({ method: 'GET', url: `/venues/${venueId}/audit-log`, headers: bearer(await loginStaff(label === 'Riadh Foot Alger' ? 'owner.riadh@sim.test' : label === 'Blue Wave Padel' ? 'owner.bluewave@sim.test' : 'owner.sahara@sim.test', label === 'Riadh Foot Alger' ? STAFF_PASSWORD : label === 'Blue Wave Padel' ? STAFF_PASSWORD : STAFF_PASSWORD)) });
    assert(journal.statusCode === 200, `lendemain:journal-lisible-${label}`, { entries: journal.json().entries?.length });
    nextDay[label] = { journalEntries: journal.json().entries?.length ?? 0 };

    const ownerTok = await loginStaff(label === 'Riadh Foot Alger' ? 'owner.riadh@sim.test' : label === 'Blue Wave Padel' ? 'owner.bluewave@sim.test' : 'owner.sahara@sim.test', STAFF_PASSWORD);
    const fromDay = '2026-10-01', toDay = '2026-10-20'; // large fenêtre, couvre toutes les dates réelles utilisées par le script
    const revenue = await inject({ method: 'GET', url: `/venues/${venueId}/analytics/revenue?from=${fromDay}&to=${toDay}`, headers: bearer(ownerTok) });
    if (revenue.statusCode === 200) {
      const server = revenue.json().overall;
      // Vérification INDÉPENDANTE — pas mon propre carnet de bord tenu à la main (incomplet, on l'a constaté), mais
      // une agrégation SQL directe, MÊME fenêtre (jour d'exploitation, lib/algiers.ts) et MÊME règle que le core
      // (cashReport, crm.ts : source CENTER exclue, PAID→collecté, RESERVED/HONORED→engagé, CANCELLED→perdu annulé
      // (motif compris, jamais exclu par cashReport lui-même), NO_SHOW→perdu no-show) — recalculée ici à la main,
      // sans jamais appeler le code serveur qu'elle vérifie.
      const win = operatingPeriodWindow(fromDay, toDay);
      const independent = await sql`
        SELECT
          COALESCE(SUM(b.price_total_da) FILTER (WHERE b.status = 'PAID'), 0)::int AS collected,
          COALESCE(SUM(b.price_total_da) FILTER (WHERE b.status IN ('RESERVED', 'HONORED')), 0)::int AS engaged,
          COALESCE(SUM(b.price_total_da) FILTER (WHERE b.status = 'CANCELLED'), 0)::int AS lost_cancelled,
          COALESCE(SUM(b.price_total_da) FILTER (WHERE b.status = 'NO_SHOW'), 0)::int AS lost_no_show
        FROM bookings b JOIN fields f ON f.id = b.field_id
        WHERE f.venue_id = ${venueId}::uuid AND b.source != 'CENTER'
          AND lower(b.time_range) >= ${new Date(win.start)} AND lower(b.time_range) < ${new Date(win.end)}
      `.execute(db);
      const row = independent.rows[0];
      const match = server.collected === row.collected && server.engaged === row.engaged
        && server.lostCancelled === row.lost_cancelled && server.lostNoShow === row.lost_no_show;
      assert(match, `lendemain:analytics-CA-serveur=SQL-indépendant-${label}`,
        { serveur: server, sqlIndépendant: row });
      nextDay[label].revenueMatch = match;
    } else {
      log(`lendemain:analytics-inaccessible-${label}`, false, { status: revenue.statusCode });
    }
  }

  // Aucune donnée dans un état intermédiaire : tout booking annulé a bien un cancel_reason, tout match annulé
  // par cascade a bien son booking annulé ou détaché, aucune notification orpheline sans destinataire réel.
  {
    const orphanCancelled = await db.selectFrom('bookings').select('id').where('status', '=', 'CANCELLED').where('cancel_reason', 'is', null).execute();
    assert(orphanCancelled.length === 0, 'lendemain:aucune-réservation-annulée-sans-motif', { count: orphanCancelled.length });
    const orphanNotifs = await db.selectFrom('notifications as n')
      .leftJoin('users as u', 'u.id', 'n.user_id')
      .select('n.id').where('u.id', 'is', null).execute();
    assert(orphanNotifs.length === 0, 'lendemain:aucune-notification-orpheline', { count: orphanNotifs.length });
  }

  // Console superadmin cohérente sur les 3 centres
  {
    const superToken = await loginStaff('super.sim@sim.test', 'SuperSim2026!');
    const venuesList = await inject({ method: 'GET', url: '/platform/venues', headers: bearer(superToken) });
    const names = venuesList.json().venues.map((v) => v.name);
    assert(['Riadh Foot Alger', 'Blue Wave Padel', 'Sahara Multisport'].every((n) => names.includes(n)),
      'lendemain:console-superadmin-liste-les-3-centres', { names });
    const usersList = await inject({ method: 'GET', url: '/platform/users?q=Adel', headers: bearer(superToken) });
    assert(usersList.statusCode === 200, 'lendemain:console-recherche-utilisateurs-fonctionne');
    const platformAudit = await inject({ method: 'GET', url: '/platform/audit-log?action=CENTER_CREATED', headers: bearer(superToken) });
    assert(platformAudit.statusCode === 200 && platformAudit.json().entries.some((e) => e.summary.includes('Sahara Multisport')),
      'lendemain:journal-plateforme-trace-la-création-du-3e-centre');
  }

  writeFileSync('./sim-trace.json', JSON.stringify({ dbName: DB_NAME, venues: { v1: v1.id, v2: v2.id, v3 }, ledger, trace, nextDay }, null, 2));
  const failed = trace.filter((t) => !t.ok);
  console.log(`\n=== TERMINÉ : ${trace.length} vérifications, ${failed.length} échec(s) observé(s) ===`);
  if (failed.length > 0) console.log(JSON.stringify(failed, null, 2));

  await app.close();
  await pool.end();
  console.log(`\nBase conservée pour vérification indépendante : ${DB_NAME} (à supprimer explicitement ensuite).`);
}

main().catch((err) => { console.error('ÉCHEC DU SCRIPT DE SIMULATION :', err); process.exit(1); });
