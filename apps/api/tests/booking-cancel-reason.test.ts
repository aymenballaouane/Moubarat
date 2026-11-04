import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayOfDayStart } from '@moubarat/core';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { algiersDateOf, dayStartMs } from '../src/lib/algiers.js';
import { makeSafeDayPicker } from './helpers/dates.js';

/* Motif d'annulation (15/09/2026, demande d'Aymen — prérequis avant le
   premier centre réel) : STAFF_ERROR (erreur de saisie du centre) vs CLIENT
   (le client a annulé). Couvre : écriture (staff vs joueur), validation
   serveur, résumé d'audit, et les deux exclusions confirmées — cashReport
   (CA perdu, testé dans analytics.test.ts/promos.test.ts) et
   clientReliabilityV1 (fiabilité, testé ici).

   Vérifications demandées par Aymen dans ce même lot :
   - rescheduleBooking (packages/core/src/rules/ops.ts §10, « Modifier /
     déplacer une réservation ») n'a AUCUN appelant dans apps/api ni
     apps/crm (recherche faite avant de coder) — jamais wiré à une route,
     jamais un chemin qui pourrait passer par CANCELLED. Rien à tester : le
     code est mort, garanti par construction (aucune route ne peut
     l'atteindre). Le test ci-dessous sur l'annulation joueur couvre le seul
     AUTRE chemin d'écriture réel (POST /bookings/:id/cancel), séparé de
     POST /bookings/:id/status (celui-ci modifié).
   - matchHealth (packages/core) ne prend aucune donnée liée à une résa ou à
     un motif d'annulation en entrée — seulement capacity/joined/timing +
     une fiabilité DÉJÀ CALCULÉE, fournie par l'appelant. La seule vraie
     traversée trouvée : le Dashboard CRM utilise clientReliabilityV1 (via
     GET /venues/:id/clients/:id) comme « fiabilité du capitaine » nourrissant
     matchHealth côté client (apps/crm/src/lib/dashboardDetail.ts, fonction
     pure, déjà testée par ses propres tests unitaires CRM). Exclure
     STAFF_ERROR de clientReliabilityV1 (ci-dessous) corrige donc aussi cette
     traversée automatiquement, sans code supplémentaire — le test de
     fiabilité ci-dessous EST la preuve : matchHealth ne peut recevoir une
     fiabilité dégradée par une annulation STAFF_ERROR que si
     clientReliabilityV1 la reflète, ce qu'il ne fait plus. */

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '';

/* Les appels du premier bloc de ce fichier sont espacés de 2 jours au moins : sauter le vendredi décale la date d'UN
   jour, et deux valeurs consécutives retombaient alors sur LE MÊME jour (409 SLOT_TAKEN un vendredi — constaté le
   25/09/2026). */
const nextNonFriday = makeSafeDayPicker();

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER — CANCEL_BOOKING
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF
});
afterAll(() => stack.teardown());

async function walkIn(date: string, startMin: number): Promise<{ id: string }> {
  const res = await stack.app.inject({
    method: 'POST', url: '/bookings', headers: bearer(nadia),
    payload: { fieldId: seed.fields.t1, date, startMin, durationMin: 60, source: 'WALK_IN', reservationName: 'Test Motif' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { booking: { id: string } }).booking;
}

describe('POST /bookings/:id/status — motif d’annulation obligatoire côté staff (15/09/2026)', () => {
  it('CANCELLED sans motif : refusé (400 CANCEL_REASON_REQUIRED)', async () => {
    const date = nextNonFriday(20);
    const b = await walkIn(date, 600);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(yacine), payload: { status: 'CANCELLED' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('CANCEL_REASON_REQUIRED');
  });

  it('CANCELLED avec un motif invalide : refusé (400)', async () => {
    const date = nextNonFriday(22);
    const b = await walkIn(date, 600);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(yacine),
      payload: { status: 'CANCELLED', reason: 'PARCE_QUE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CANCELLED avec reason: STAFF_ERROR — écrit, audit distinct', async () => {
    const date = nextNonFriday(24);
    const b = await walkIn(date, 600);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(yacine),
      payload: { status: 'CANCELLED', reason: 'STAFF_ERROR' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const row = await stack.db.selectFrom('bookings').select('cancel_reason').where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row.cancel_reason).toBe('STAFF_ERROR');

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('object_type', '=', 'booking').where('object_id', '=', b.id).where('action', '=', 'BOOKING_CANCELLED')
      .executeTakeFirstOrThrow();
    expect(audit.summary).toContain('erreur de saisie du centre');
    expect(audit.summary).not.toContain('retirés du CA engagé');
  });

  it('CANCELLED avec reason: CLIENT — écrit, audit distinct', async () => {
    const date = nextNonFriday(26);
    const b = await walkIn(date, 600);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(yacine),
      payload: { status: 'CANCELLED', reason: 'CLIENT' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const row = await stack.db.selectFrom('bookings').select('cancel_reason').where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row.cancel_reason).toBe('CLIENT');

    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('object_type', '=', 'booking').where('object_id', '=', b.id).where('action', '=', 'BOOKING_CANCELLED')
      .executeTakeFirstOrThrow();
    expect(audit.summary).toContain('client');
    expect(audit.summary).toContain('retirés du CA engagé');
  });

  it('Staff (lecture seule) refusé — CANCEL_BOOKING = Réception+ depuis CRM-4 (27/09/2026), pas Staff — indépendant du motif', async () => {
    const date = nextNonFriday(28);
    const b = await walkIn(date, 600);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(amine),
      payload: { status: 'CANCELLED', reason: 'CLIENT' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRM-4 (27/09/2026, GO d’Aymen) : Réception annule elle-même — motif toujours obligatoire, audité sous son propre rôle', async () => {
    const date = nextNonFriday(30);
    const noReason = await walkIn(date, 600);
    const refused = await stack.app.inject({
      method: 'POST', url: `/bookings/${noReason.id}/status`, headers: bearer(nadia), payload: { status: 'CANCELLED' },
    });
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: string }).error).toBe('CANCEL_REASON_REQUIRED');

    const b = await walkIn(date, 720);
    const res = await stack.app.inject({
      method: 'POST', url: `/bookings/${b.id}/status`, headers: bearer(nadia),
      payload: { status: 'CANCELLED', reason: 'STAFF_ERROR' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await stack.db.selectFrom('bookings').select('cancel_reason').where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row.cancel_reason).toBe('STAFF_ERROR');
    const audit = await stack.db.selectFrom('audit_log').selectAll()
      .where('object_type', '=', 'booking').where('object_id', '=', b.id).where('action', '=', 'BOOKING_CANCELLED')
      .executeTakeFirstOrThrow();
    expect(audit.actor_role).toBe('RECEPTION');
  });
});

describe('POST /bookings/:id/cancel — annulation joueur, toujours CLIENT (15/09/2026)', () => {
  it('un joueur qui annule sa propre résa : cancel_reason = CLIENT, sans paramètre, jamais STAFF_ERROR possible', async () => {
    const date = nextNonFriday(25);
    const karim = await loginAs(stack, seed.phones.karim, 'Karim Motif');
    const create = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(karim),
      payload: { fieldId: seed.fields.t2, date, startMin: 600, durationMin: 60, source: 'MOUBARAT' },
    });
    expect(create.statusCode, create.body).toBe(201);
    const bookingId = (create.json() as { booking: { id: string } }).booking.id;

    // Même en essayant de glisser un motif dans le corps de la requête (un
    // joueur n'a de toute façon pas accès à cette idée côté UI) : ignoré,
    // toujours CLIENT — jamais un moyen de se déclarer STAFF_ERROR soi-même.
    const cancel = await stack.app.inject({
      method: 'POST', url: `/bookings/${bookingId}/cancel`, headers: bearer(karim),
      payload: { reason: 'STAFF_ERROR' },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);

    const row = await stack.db.selectFrom('bookings').select('cancel_reason').where('id', '=', bookingId).executeTakeFirstOrThrow();
    expect(row.cancel_reason).toBe('CLIENT');
  });
});

describe('Fiabilité client — une annulation STAFF_ERROR disparaît ENTIÈREMENT (15/09/2026, confirmé par Aymen)', () => {
  it('bookingsCount, pénalité et score identiques à un client qui n’a JAMAIS eu cette annulation', async () => {
    // Deux joueurs avec le MÊME historique honoré (3 résas honorées, visible
    // dès RELIABILITY_MIN_VISIBLE) — seul Reda a EN PLUS une résa annulée
    // STAFF_ERROR qui, si elle comptait, dégraderait son score et gonflerait
    // son total. Les deux doivent ressortir strictement identiques.
    const reda = await loginAs(stack, seed.phones.reda, 'Reda Motif');
    const fouad = await loginAs(stack, seed.phones.fouad, 'Fouad Motif');

    for (const [i, token] of [reda, fouad].entries()) {
      for (let k = 0; k < 3; k++) {
        // Écart large (≥ 5 j) entre chaque `minDaysOut` : deux valeurs trop
        // rapprochées peuvent retomber sur LE MÊME jour si l'une d'elles
        // tombe un vendredi (nextNonFriday avance alors d'un jour) — trouvé
        // en vérification (409 SLOT_TAKEN inattendu avec un pas de 1).
        const date = nextNonFriday(30 + i * 30 + k * 5);
        const create = await stack.app.inject({
          method: 'POST', url: '/bookings', headers: bearer(token),
          payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date, startMin: 600, durationMin: 60, source: 'MOUBARAT' },
        });
        expect(create.statusCode, create.body).toBe(201);
        const id = (create.json() as { booking: { id: string } }).booking.id;
        await stack.app.inject({ method: 'POST', url: `/bookings/${id}/status`, headers: bearer(nadia), payload: { status: 'HONORED' } });
      }
    }

    // Reda seul : une 4e résa, annulée en STAFF_ERROR tardivement (aurait
    // compté LATE si elle comptait — le cas le plus pénalisant).
    const extraDate = nextNonFriday(50);
    const extra = await stack.app.inject({
      method: 'POST', url: '/bookings', headers: bearer(reda),
      payload: { fieldId: seed.fields.t3, format: 'DOUBLE', date: extraDate, startMin: 900, durationMin: 60, source: 'MOUBARAT' },
    });
    expect(extra.statusCode, extra.body).toBe(201);
    const extraId = (extra.json() as { booking: { id: string } }).booking.id;
    const cancelRes = await stack.app.inject({
      method: 'POST', url: `/bookings/${extraId}/status`, headers: bearer(yacine),
      payload: { status: 'CANCELLED', reason: 'STAFF_ERROR' },
    });
    expect(cancelRes.statusCode, cancelRes.body).toBe(200);

    const redaId = (await stack.db.selectFrom('bookings').select('by_user_id').where('id', '=', extraId).executeTakeFirstOrThrow()).by_user_id;
    const fouadId = (await stack.db.selectFrom('users').select('id').where('phone', '=', seed.phones.fouad).executeTakeFirstOrThrow()).id;
    const redaRes = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients/${redaId}`, headers: bearer(hamid) });
    const fouadRes = await stack.app.inject({ method: 'GET', url: `/venues/${seed.venueId}/clients/${fouadId}`, headers: bearer(hamid) });
    expect(redaRes.statusCode, redaRes.body).toBe(200);
    expect(fouadRes.statusCode, fouadRes.body).toBe(200);

    interface ClientMetrics {
      bookingsCount: number; totalSpentDa: number; honored: number; paid: number;
      cancelledEarly: number; cancelledLate: number; noShow: number;
      reliability: { visible: boolean; score: number | null; band: string | null; confidence: string | null; total: number };
    }
    // Comparaison sur les seules métriques — jamais userId/name/phone,
    // forcément différents entre Reda et Fouad.
    const metricsOf = (c: ClientMetrics) => ({
      bookingsCount: c.bookingsCount, totalSpentDa: c.totalSpentDa, honored: c.honored, paid: c.paid,
      cancelledEarly: c.cancelledEarly, cancelledLate: c.cancelledLate, noShow: c.noShow, reliability: c.reliability,
    });
    const redaMetrics = metricsOf((redaRes.json() as { client: ClientMetrics }).client);
    const fouadMetrics = metricsOf((fouadRes.json() as { client: ClientMetrics }).client);
    expect(redaMetrics.bookingsCount).toBe(3); // pas 4 : la STAFF_ERROR n'existe pas pour ce calcul
    expect(redaMetrics.cancelledEarly).toBe(0);
    expect(redaMetrics.cancelledLate).toBe(0);
    expect(redaMetrics).toEqual(fouadMetrics); // strictement identique à un historique qui n'a jamais eu cette annulation
  });
});
