/* Test isolé P0-4a — déplacement cross-centre, sans l'ambiguïté "conflit de créneau vs garde de sécurité".
   Demande d'Aymen (27/09/2026, suite au rapport de vérification de la simulation deux-jours) : dans cette
   simulation, la tentative de déplacer une réservation du centre v1 vers un terrain du centre v2 avait été
   refusée (404), MAIS le créneau visé sur v2 n'était en réalité pas libre (chevauchement avec une autre
   réservation) — donc l'élimination de l'explication alternative ("un simple conflit de créneau, pas la
   garde P0-4a") reposait sur la lecture du code, pas sur un cas de base qui isole proprement les deux causes.

   Ce script répare cela avec DEUX cas, sur une base jetable dédiée (jamais pilote/démo, détruite à la fin) :
   - CAS A : le créneau visé sur v2 est GARANTI libre (vérifié par SQL, avec l'opérateur natif Postgres de
     chevauchement de plages, AVANT la tentative) — élimine l'ambiguïté par construction.
   - CAS B : le créneau visé sur v2 est ENSUITE délibérément occupé par une vraie réservation, et la MÊME
     tentative de déplacement est refaite — si le refus reste 404 (pas 409 SLOT_TAKEN), cela prouve
     EMPIRIQUEMENT que la garde de centre s'évalue avant la détection de conflit (comme le montre déjà le
     code, reschedule.ts : la garde ligne 64, le conflit ligne 71+) — donc même le cas "ambigu" d'origine
     est correctement expliqué, pas seulement par lecture de code mais par un test qui le démontre.
   - CONTRÔLE C : un déplacement DANS LE MÊME centre, sur un créneau tout aussi libre, doit RÉUSSIR — pour
     prouver que le mécanisme de déplacement n'est pas cassé en général, seul le franchissement de centre
     est bloqué.

   Aucune donnée pilote/démo touchée. Aucune ligne de code produit modifiée par ce script (setup uniquement
   via SQL direct sur les tables de structure — venues/fields/staff — et le core déjà réel ; l'ACTION testée
   elle-même passe uniquement par de vraies requêtes HTTP contre le vrai serveur, comme la simulation deux-jours). */

import { sql } from 'kysely';
import { setupTestStack, loginAsPlatform, bearer, insertTestField } from './tests/helpers.js';
import { createPlatformAccount } from './src/platform/auth/routes.js';

const trace: { step: string; ok: boolean; detail?: unknown }[] = [];
let failures = 0;
function assert(cond: boolean, step: string, detail?: unknown) {
  trace.push({ step, ok: cond, detail });
  const mark = cond ? 'OK  ' : 'FAIL';
  console.log(`[${mark}] ${step}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('=== Test isolé P0-4a — base jetable dédiée (setupTestStack) ===');
  const stack = await setupTestStack();
  const { app, db } = stack;

  try {
    // ---------- Structure : 2 centres, staff, terrains ----------
    const v1 = await db.insertInto('venues').values({
      name: 'Centre A (source)', wilaya: 'Alger', address: 'Test', lat: 36.7, lng: 3.1,
      phone: '+213555900001', status: 'ACTIVE', booking_prefix: 'TCA', cash_module_enabled: true,
    }).returning(['id']).executeTakeFirstOrThrow();
    const v2 = await db.insertInto('venues').values({
      name: 'Centre B (cible)', wilaya: 'Oran', address: 'Test', lat: 35.7, lng: -0.6,
      phone: '+213555900002', status: 'ACTIVE', booking_prefix: 'TCB', cash_module_enabled: true,
    }).returning(['id']).executeTakeFirstOrThrow();

    const f1 = await insertTestField(db, { venue_id: v1.id, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2500, status: 'ACTIVE' });
    const f2 = await insertTestField(db, { venue_id: v2.id, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2200, status: 'ACTIVE' });

    await db.insertInto('opening_hours').values(
      [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        { venue_id: v1.id, weekday, start_min: 0, end_min: 1440 },
        { venue_id: v2.id, weekday, start_min: 0, end_min: 1440 },
      ]),
    ).execute();

    const PASSWORD = 'IsolatedP0_4a_2026!';
    const owner1Id = await createPlatformAccount(db, { email: 'owner.a@p0-4a-test.local', password: PASSWORD, name: 'Owner Centre A' });
    await db.insertInto('center_staff').values({ venue_id: v1.id, user_id: owner1Id, role: 'OWNER' }).execute();
    const owner2Id = await createPlatformAccount(db, { email: 'owner.b@p0-4a-test.local', password: PASSWORD, name: 'Owner Centre B' });
    await db.insertInto('center_staff').values({ venue_id: v2.id, user_id: owner2Id, role: 'OWNER' }).execute();

    const token1 = await loginAsPlatform(stack, 'owner.a@p0-4a-test.local', PASSWORD);
    const token2 = await loginAsPlatform(stack, 'owner.b@p0-4a-test.local', PASSWORD);

    // Date cible : loin dans le futur, jour fixe, aucune ambiguïté de fuseau/horizon.
    const DATE = '2027-03-15';

    // ---------- Réservation source, sur le centre A, via une vraie requête HTTP (WALK_IN) ----------
    const createSrc = await app.inject({
      method: 'POST', url: '/bookings', headers: bearer(token1),
      payload: { fieldId: f1.id, date: DATE, startMin: 600, durationMin: 90, source: 'WALK_IN', reservationName: 'Client Test A' },
    });
    assert(createSrc.statusCode === 201, 'setup:réservation-source-créée-sur-centre-A', { status: createSrc.statusCode, body: createSrc.json() });
    const srcBookingId = createSrc.json().booking.id as string;
    const srcBefore = await db.selectFrom('bookings').select(['field_id', 'time_range']).where('id', '=', srcBookingId).executeTakeFirstOrThrow();

    // ================================================================
    // CAS A — créneau cible sur le centre B GARANTI libre
    // ================================================================
    console.log('\n--- CAS A : créneau cible sur Centre B garanti libre ---');

    // Preuve indépendante AVANT la tentative : aucune ligne, ET aucun chevauchement de plage
    // (même opérateur natif Postgres && que la contrainte d'exclusion réelle no_double_booking).
    const overlapRowsA = await sql<{ n: number }>`
      select count(*)::int as n from bookings
      where field_id = ${f2.id} and status != 'CANCELLED'
        and time_range && tstzrange('2027-03-15T11:00:00Z'::timestamptz, '2027-03-15T12:30:00Z'::timestamptz)
    `.execute(db);
    const freeCountA = overlapRowsA.rows[0]!.n;
    assert(freeCountA === 0, 'CAS-A:preuve-indépendante-créneau-cible-réellement-libre-avant-tentative', { chevauchements: freeCountA });

    const previewA = await app.inject({
      method: 'GET', headers: bearer(token1),
      url: `/bookings/${srcBookingId}/reschedule/preview?fieldId=${f2.id}&date=${DATE}&startMin=660&durationMin=90`,
    });
    assert(previewA.statusCode === 404, 'CAS-A:preview-cross-centre-refusée-slot-libre', { status: previewA.statusCode, body: previewA.json() });

    const commitA = await app.inject({
      method: 'POST', headers: bearer(token1),
      url: `/bookings/${srcBookingId}/reschedule`,
      payload: { fieldId: f2.id, date: DATE, startMin: 660, durationMin: 90 },
    });
    assert(commitA.statusCode === 404, 'CAS-A:commit-cross-centre-refusé-slot-libre', { status: commitA.statusCode, body: commitA.json() });

    const srcAfterA = await db.selectFrom('bookings').select(['field_id', 'time_range']).where('id', '=', srcBookingId).executeTakeFirstOrThrow();
    assert(
      srcAfterA.field_id === srcBefore.field_id && String(srcAfterA.time_range) === String(srcBefore.time_range),
      'CAS-A:réservation-source-strictement-inchangée-en-base',
      { avant: srcBefore, apres: srcAfterA },
    );

    // ================================================================
    // CAS B — même tentative, créneau cible désormais RÉELLEMENT occupé sur B
    // ================================================================
    console.log('\n--- CAS B : même créneau cible sur Centre B, désormais réellement occupé ---');

    const occupy = await app.inject({
      method: 'POST', url: '/bookings', headers: bearer(token2),
      payload: { fieldId: f2.id, date: DATE, startMin: 660, durationMin: 90, source: 'WALK_IN', reservationName: 'Client Test B Occupant' },
    });
    assert(occupy.statusCode === 201, 'CAS-B:réservation-occupante-créée-sur-Centre-B', { status: occupy.statusCode, body: occupy.json() });

    const overlapRowsB = await sql<{ n: number }>`
      select count(*)::int as n from bookings
      where field_id = ${f2.id} and status != 'CANCELLED'
        and time_range && tstzrange('2027-03-15T11:00:00Z'::timestamptz, '2027-03-15T12:30:00Z'::timestamptz)
    `.execute(db);
    const occupiedCountB = overlapRowsB.rows[0]!.n;
    assert(occupiedCountB === 1, 'CAS-B:preuve-indépendante-créneau-cible-désormais-réellement-occupé', { chevauchements: occupiedCountB });

    const previewB = await app.inject({
      method: 'GET', headers: bearer(token1),
      url: `/bookings/${srcBookingId}/reschedule/preview?fieldId=${f2.id}&date=${DATE}&startMin=660&durationMin=90`,
    });
    assert(
      previewB.statusCode === 404 && previewB.json().error !== 'SLOT_TAKEN',
      'CAS-B:preview-cross-centre-refusée-404-jamais-409-SLOT_TAKEN-malgré-slot-occupé',
      { status: previewB.statusCode, body: previewB.json() },
    );

    const commitB = await app.inject({
      method: 'POST', headers: bearer(token1),
      url: `/bookings/${srcBookingId}/reschedule`,
      payload: { fieldId: f2.id, date: DATE, startMin: 660, durationMin: 90 },
    });
    assert(
      commitB.statusCode === 404 && commitB.json().error !== 'SLOT_TAKEN',
      'CAS-B:commit-cross-centre-refusé-404-jamais-409-SLOT_TAKEN-malgré-slot-occupé',
      { status: commitB.statusCode, body: commitB.json() },
    );

    const srcAfterB = await db.selectFrom('bookings').select(['field_id', 'time_range']).where('id', '=', srcBookingId).executeTakeFirstOrThrow();
    assert(
      srcAfterB.field_id === srcBefore.field_id && String(srcAfterB.time_range) === String(srcBefore.time_range),
      'CAS-B:réservation-source-toujours-strictement-inchangée-en-base',
      { avant: srcBefore, apres: srcAfterB },
    );

    // ================================================================
    // CONTRÔLE C — déplacement DANS le même centre, sur un créneau libre : doit réussir
    // ================================================================
    console.log('\n--- CONTRÔLE C : déplacement même-centre, créneau libre — doit réussir ---');

    const overlapRowsC = await sql<{ n: number }>`
      select count(*)::int as n from bookings
      where field_id = ${f1.id} and status != 'CANCELLED'
        and time_range && tstzrange('2027-03-15T14:00:00Z'::timestamptz, '2027-03-15T15:30:00Z'::timestamptz)
    `.execute(db);
    assert(overlapRowsC.rows[0]!.n === 0, 'CONTRÔLE-C:preuve-indépendante-créneau-même-centre-libre', { chevauchements: overlapRowsC.rows[0]!.n });

    const commitC = await app.inject({
      method: 'POST', headers: bearer(token1),
      url: `/bookings/${srcBookingId}/reschedule`,
      payload: { fieldId: f1.id, date: DATE, startMin: 840, durationMin: 90 },
    });
    assert(commitC.statusCode === 200, 'CONTRÔLE-C:déplacement-même-centre-réussi', { status: commitC.statusCode, body: commitC.json() });

    const srcAfterC = await db.selectFrom('bookings').select(['field_id', 'time_range']).where('id', '=', srcBookingId).executeTakeFirstOrThrow();
    assert(
      srcAfterC.field_id === f1.id && String(srcAfterC.time_range) !== String(srcBefore.time_range),
      'CONTRÔLE-C:réservation-effectivement-déplacée-en-base-même-centre',
      { avant: srcBefore, apres: srcAfterC },
    );

    console.log(`\n=== TERMINÉ : ${trace.length} vérifications, ${failures} échec(s) ===`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await stack.teardown();
    console.log('Base jetable détruite (teardown automatique de setupTestStack).');
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
