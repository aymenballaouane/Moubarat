import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { fromPgRange } from '../src/lib/pgrange.js';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack, insertTestField } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

/* Fermetures exceptionnelles (§5.6 de l'audit général — schéma et lecture par
   le moteur déjà réels, jamais câblés en écriture, « saisie disponible en
   V1.5 »). Chantier demandé par Aymen le 14-15/09/2026, cinq exigences
   précises, une section de tests par exigence :
     1. preuve via l'endpoint de disponibilité réellement utilisé par l'app
        joueur (pas une simple lecture de la table) ;
     2. journée d'exploitation (queue après minuit), pas journée calendaire ;
     3. refus si la plage contient déjà une résa ou un abonnement ;
     4. les heures fermées sortent du dénominateur d'occupation ;
     5. POST et DELETE tracés dans audit_log.
   Centre jetable dédié (jamais le centre pilote partagé par les autres
   fichiers), horaires 08:00→01:00(+1) pour tous les jours utilisés — même
   convention que le seed réel, pour rester réaliste. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', nadia = '';
let venueId = '', t1 = '', t2 = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);

  const v = await stack.db.insertInto('venues').values({
    name: 'Centre fermetures (test)', wilaya: 'Alger', address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
  }).returning('id').executeTakeFirstOrThrow();
  venueId = v.id;
  const f1 = await insertTestField(stack.db, {
    venue_id: venueId, name: 'T1', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
  });
  const f2 = await insertTestField(stack.db, {
    venue_id: venueId, name: 'T2', sport: 'FOOTBALL', formats: ['5v5'], hourly_rate_da: 2000, status: 'ACTIVE',
  });
  t1 = f1.id; t2 = f2.id;
  // 08:00 → 01:00(+1), tous les jours — même convention que fixtures.ts.
  await stack.db.insertInto('opening_hours').values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ venue_id: venueId, weekday, start_min: 480, end_min: 1500 })),
  ).execute();
  await stack.db.insertInto('center_staff').values([
    { venue_id: venueId, user_id: seed.crmStaff.hamid, role: 'MANAGER' },
    { venue_id: venueId, user_id: seed.crmStaff.nadia, role: 'RECEPTION' },
  ]).execute();
});
afterAll(() => stack.teardown());

function nextWeekday(target: number, minDaysOut: number): string {
  for (let d = minDaysOut; d <= minDaysOut + 8; d++) {
    const date = algiersDateOf(Date.now() + d * 86_400_000);
    if (weekdayOfDayStart(dayStartMs(date)) === target) return date;
  }
  throw new Error('unreachable');
}

describe('permissions — EDIT_HOURS pour créer/retirer, VIEW_PLANNING pour lister', () => {
  it('RECEPTION refusée en écriture (403), autorisée en lecture (200)', async () => {
    const date = nextWeekday(1, 20); // loin de tout autre test de ce fichier
    const refused = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(nadia),
      payload: { fieldId: null, reason: 'HOLIDAY', date, wholeDay: true },
    });
    expect(refused.statusCode).toBe(403);

    const list = await stack.app.inject({ method: 'GET', url: `/venues/${venueId}/closures`, headers: bearer(nadia) });
    expect(list.statusCode).toBe(200);
  });
});

describe('exigence n°1 — l’endpoint de disponibilité de l’app joueur ne renvoie plus les créneaux fermés', () => {
  it('fermeture de TOUT LE CENTRE : les deux terrains disparaissent de la disponibilité', async () => {
    const date = nextWeekday(2, 20);
    const before = await stack.app.inject({ method: 'GET', url: `/fields/${t1}/availability?date=${date}&duration=90` });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { starts: unknown[] }).starts.length).toBeGreaterThan(0);

    const create = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: null, reason: 'HOLIDAY', label: 'Aïd', date, wholeDay: true },
    });
    expect(create.statusCode, create.body).toBe(201);

    const afterT1 = await stack.app.inject({ method: 'GET', url: `/fields/${t1}/availability?date=${date}&duration=90` });
    const afterT2 = await stack.app.inject({ method: 'GET', url: `/fields/${t2}/availability?date=${date}&duration=90` });
    expect((afterT1.json() as { starts: unknown[] }).starts).toEqual([]);
    expect((afterT2.json() as { starts: unknown[] }).starts).toEqual([]);
  });

  it('fermeture d’UN SEUL terrain : l’autre terrain reste réservable', async () => {
    const date = nextWeekday(3, 20);
    const create = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: t1, reason: 'MAINTENANCE', date, wholeDay: true },
    });
    expect(create.statusCode, create.body).toBe(201);

    const t1Avail = await stack.app.inject({ method: 'GET', url: `/fields/${t1}/availability?date=${date}&duration=90` });
    const t2Avail = await stack.app.inject({ method: 'GET', url: `/fields/${t2}/availability?date=${date}&duration=90` });
    expect((t1Avail.json() as { starts: unknown[] }).starts).toEqual([]);
    expect((t2Avail.json() as { starts: unknown[] }).starts.length).toBeGreaterThan(0);
  });
});

describe('exigence n°2 — journée d’exploitation, pas journée calendaire', () => {
  it('fermer « toute la journée » (08:00→01:00(+1)) bloque bien jusqu’à 01:00 le lendemain, pas seulement jusqu’à minuit', async () => {
    const date = nextWeekday(4, 20);

    // Avant fermeture : un créneau existe bien après minuit (le centre ferme
    // réellement à 01:00) — sans cette preuve, le test suivant ne prouverait
    // rien (le créneau pourrait être absent pour une tout autre raison).
    const before = await stack.app.inject({
      method: 'GET', url: `/fields/${t1}/availability?date=${date}&duration=30&step=30`,
    });
    const beforeStarts = (before.json() as { starts: { startMin: number }[] }).starts;
    expect(beforeStarts.some((s) => s.startMin === 1440)).toBe(true); // 00:00 le lendemain, avant fermeture

    const create = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: t1, reason: 'HOLIDAY', date, wholeDay: true },
    });
    expect(create.statusCode, create.body).toBe(201);
    const closureId = (create.json() as { closure: { id: string } }).closure.id;

    // La ligne stockée couvre bien 480→1500 min (08:00 → 01:00 le lendemain),
    // jamais 00:00→24:00 calendaire — c'est le calcul qui doit produire ce
    // bon résultat, pas une coïncidence de l'assertion suivante. Ciblée par
    // l'id renvoyé par le POST (pas orderBy('id','desc') : les uuid générés
    // par gen_random_uuid() ne trient pas chronologiquement).
    const stored = await stack.db.selectFrom('closures').select('during')
      .where('id', '=', closureId).executeTakeFirstOrThrow();
    const range = fromPgRange(stored.during);
    expect(range.start).toBe(dayStartMs(date) + 480 * 60_000);
    expect(range.end).toBe(dayStartMs(date) + 1500 * 60_000);

    // Après fermeture : le créneau de 00:00 le lendemain (partie « après
    // minuit » de LA MÊME journée d'exploitation) a disparu. Une fermeture
    // calculée en journée CALENDAIRE (0→1440) aurait laissé passer ce
    // créneau, puisqu'il est postérieur à 1440.
    const after = await stack.app.inject({
      method: 'GET', url: `/fields/${t1}/availability?date=${date}&duration=30&step=30`,
    });
    const afterStarts = (after.json() as { starts: { startMin: number }[] }).starts;
    expect(afterStarts.some((s) => s.startMin === 1440)).toBe(false);
  });
});

describe('exigence n°3 — refus si la plage contient déjà une résa ou un abonnement', () => {
  it('une réservation RESERVED existante bloque la fermeture, et la liste des conflits est renvoyée', async () => {
    const date = nextWeekday(5, 20);
    const sofiane = await loginAs(stack, seed.phones.sofiane);
    const booking = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(sofiane),
      payload: { fieldId: t1, date, startMin: 900, durationMin: 90 },
    });
    expect(booking.statusCode, booking.body).toBe(201);

    const attempt = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: t1, reason: 'MAINTENANCE', date, wholeDay: true },
    });
    expect(attempt.statusCode).toBe(409);
    const body = attempt.json() as { error: string; details?: { conflicts: { kind: string }[] } };
    expect(body.error).toBe('SLOT_TAKEN');
    expect(body.details?.conflicts.some((c) => c.kind === 'BOOKING')).toBe(true);

    const countBefore = 2; // exigence n°1 (test 2) + exigence n°2 ont déjà posé chacune une fermeture sur t1
    const countAfter = await stack.db.selectFrom('closures')
      .select((eb) => eb.fn.countAll<string>().as('n')).where('venue_id', '=', venueId).where('field_id', '=', t1)
      .executeTakeFirstOrThrow();
    expect(Number(countAfter.n)).toBe(countBefore); // le refus n'a rien ajouté
  });

  it('une occurrence d’abonnement actif bloque aussi la fermeture', async () => {
    const date = nextWeekday(6, 20);
    const weekday = weekdayOfDayStart(dayStartMs(date));
    await stack.db.insertInto('recurring_bookings').values({
      field_id: t2, weekday, start_min: 900, duration_min: 90,
      holder_name: 'Club Test Fermetures', active_from: new Date(Date.now() - 86_400_000),
    }).execute();

    const attempt = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: t2, reason: 'EVENT', date, wholeDay: true },
    });
    expect(attempt.statusCode).toBe(409);
    const body = attempt.json() as { details?: { conflicts: { kind: string; label: string }[] } };
    expect(body.details?.conflicts.some((c) => c.kind === 'SUBSCRIPTION' && c.label === 'Club Test Fermetures')).toBe(true);
  });
});

describe('exigence n°4 — les heures fermées sortent du dénominateur d’occupation', () => {
  it('un jour férié SANS AUCUNE réservation, dans une période qui en a par ailleurs, fait MONTER le taux (dénominateur réduit), jamais chuter', async () => {
    // Deux jours consécutifs : une vraie résa le premier, rien le second —
    // fermé ensuite en jour férié. Sans le correctif, le second jour compte
    // pour de l'ouverture non réservée et TIRE LE TAUX VERS LE BAS ; avec le
    // correctif, ses minutes sortent du dénominateur et le taux, calculé sur
    // le seul jour resté ouvert, ne peut que monter (même numérateur, plus
    // petit dénominateur) — jamais rester identique par coïncidence.
    const dayWithBooking = nextWeekday(0, 60); // dimanche, loin de tout le reste de ce fichier
    const holiday = algiersDateOf(dayStartMs(dayWithBooking) + 86_400_000); // lundi suivant
    const from = dayWithBooking; const to = holiday;

    // Karim, pas Sofiane : Sofiane a déjà été connecté dans la section
    // « exigence n°3 » de ce même fichier — un second /auth/otp/request pour
    // le même numéro dans la même exécution heurte le vrai cooldown OTP (60 s).
    const karim = await loginAs(stack, seed.phones.karim, 'Karim Fermetures');
    const booking = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(karim),
      payload: { fieldId: t1, date: dayWithBooking, startMin: 900, durationMin: 90 },
    });
    expect(booking.statusCode, booking.body).toBe(201);

    const before = await stack.app.inject({
      method: 'GET', url: `/venues/${venueId}/analytics/occupancy?from=${from}&to=${to}`, headers: bearer(hamid),
    });
    const beforeOverall = (before.json() as { overall: number }).overall;
    expect(beforeOverall).toBeGreaterThan(0); // la résa du premier jour compte déjà

    const closure = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: null, reason: 'HOLIDAY', date: holiday, wholeDay: true },
    });
    expect(closure.statusCode, closure.body).toBe(201);

    const after = await stack.app.inject({
      method: 'GET', url: `/venues/${venueId}/analytics/occupancy?from=${from}&to=${to}`, headers: bearer(hamid),
    });
    const afterOverall = (after.json() as { overall: number }).overall;
    expect(afterOverall).toBeGreaterThan(beforeOverall);
  });
});

describe('exigence n°5 — POST et DELETE tracés dans audit_log', () => {
  it('création puis retrait : deux entrées lisibles, avec acteur et rôle réels', async () => {
    const date = nextWeekday(1, 40);
    const create = await stack.app.inject({
      method: 'POST', url: `/venues/${venueId}/closures`, headers: bearer(hamid),
      payload: { fieldId: null, reason: 'HOLIDAY', label: 'Jour de test', date, wholeDay: true },
    });
    expect(create.statusCode, create.body).toBe(201);
    const closureId = (create.json() as { closure: { id: string } }).closure.id;

    const del = await stack.app.inject({
      method: 'DELETE', url: `/venues/${venueId}/closures/${closureId}`, headers: bearer(hamid),
    });
    expect(del.statusCode).toBe(204);

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('venue_id', '=', venueId).where('object_type', '=', 'closure').where('object_id', '=', closureId)
      .orderBy('at', 'asc').execute();
    expect(audit).toHaveLength(2);
    expect(audit[0]!.action).toBe('CENTER_UPDATED');
    expect(audit[0]!.actor_id).toBe(seed.crmStaff.hamid);
    expect(audit[0]!.actor_role).toBe('MANAGER');
    expect(audit[0]!.summary).toContain('a fermé le centre');
    expect(audit[0]!.summary).toContain('Jour de test');
    expect(audit[1]!.summary).toContain('a retiré la fermeture');
  });
});
