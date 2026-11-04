/* Tranche « CRM Analytics + Caisse » — module Caisse : ouverture/clôture de
   session, mouvements, calcul de l'attendu. Même discipline que les fichiers
   précédents : vrai Postgres 16 éphémère, aucun simulacre. Le core décide
   (openCashSession/addCashMovement/closeCashSession/cashExpected), l'API
   persiste et verrouille (agrégat sur la ligne cash_sessions). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';

let stack: TestStack;
let seed: SeedResult;
let hamid = '', yacine = '', nadia = '', amine = '', sofiane = '';

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  hamid = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);   // OWNER
  yacine = await loginAsPlatform(stack, seed.crmStaffEmails.yacine, seed.crmStaffPassword); // MANAGER
  nadia = await loginAsPlatform(stack, seed.crmStaffEmails.nadia, seed.crmStaffPassword);   // RECEPTION
  amine = await loginAsPlatform(stack, seed.crmStaffEmails.amine, seed.crmStaffPassword);   // STAFF — pas de droit caisse
  sofiane = await loginAs(stack, seed.phones.sofiane); // pas membre du centre
});
afterAll(async () => { await stack.teardown(); });

async function closeAnyOpenSession(): Promise<void> {
  const current = await stack.app.inject({
    method: 'GET', url: `/venues/${seed.venueId}/cash/sessions/current`, headers: bearer(hamid),
  });
  const body = current.json() as { session: { id: string } | null };
  if (body.session) {
    await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions/${body.session.id}/close`,
      headers: bearer(hamid), payload: { declaredClosingDa: 0 },
    });
  }
}

describe('ouverture / permissions', () => {
  it('RECEPTION+ peut ouvrir, STAFF et non-membre refusés, fonds négatif refusé', async () => {
    await closeAnyOpenSession();

    const staffTry = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(amine),
      payload: { openingFloatDa: 5000 },
    });
    expect(staffTry.statusCode).toBe(403);

    // sofiane est un jeton Player, pas un compte plateforme — 401, pas 403.
    const outsiderTry = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(sofiane),
      payload: { openingFloatDa: 5000 },
    });
    expect(outsiderTry.statusCode).toBe(401);

    const negative = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(nadia),
      payload: { openingFloatDa: -100 },
    });
    expect(negative.statusCode).toBe(400);

    const opened = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(nadia),
      payload: { openingFloatDa: 5000 },
    });
    expect(opened.statusCode).toBe(201);
    const session = (opened.json() as { session: { status: string; openingFloatDa: number } }).session;
    expect(session.status).toBe('OPEN');
    expect(session.openingFloatDa).toBe(5000);

    await closeAnyOpenSession();
  });

  it('une seule caisse ouverte à la fois (refus logique, séquentiel)', async () => {
    await closeAnyOpenSession();
    const first = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(hamid),
      payload: { openingFloatDa: 3000 },
    });
    expect(first.statusCode).toBe(201);

    const second = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(hamid),
      payload: { openingFloatDa: 3000 },
    });
    expect(second.statusCode).toBe(400);
    expect((second.json() as { error: string }).error).toBe('INVALID_TARGET');

    await closeAnyOpenSession();
  });

  it('deux ouvertures concurrentes : une seule réussit, l’autre est refusée proprement (jamais un 500)', async () => {
    await closeAnyOpenSession();
    const attempts = await Promise.all([
      stack.app.inject({
        method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(hamid),
        payload: { openingFloatDa: 1000 },
      }),
      stack.app.inject({
        method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(yacine),
        payload: { openingFloatDa: 1000 },
      }),
    ]);
    // La course peut être tranchée par le contrôle logique (400, la lecture
    // non verrouillée de hasOpenSession a vu l'autre déjà insérée) OU par
    // l'index unique en base sous vraie concurrence (409, les deux lectures
    // sont passées avant que l'une des deux n'insère) — les deux sont des
    // refus propres, jamais un 500 ni deux succès.
    const winners = attempts.filter((r) => r.statusCode === 201);
    expect(winners).toHaveLength(1);
    const loser = attempts.find((r) => r.statusCode !== 201)!;
    expect([400, 409]).toContain(loser.statusCode);
    expect((loser.json() as { error: string }).error).toBe('INVALID_TARGET');
    const rows = await stack.db.selectFrom('cash_sessions')
      .selectAll().where('venue_id', '=', seed.venueId).where('status', '=', 'OPEN').execute();
    expect(rows).toHaveLength(1);

    await closeAnyOpenSession();
  });
});

describe('mouvements et clôture', () => {
  it('cycle complet : ouverture → mouvements → attendu → clôture avec écart', async () => {
    await closeAnyOpenSession();
    const opened = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(nadia),
      payload: { openingFloatDa: 2000 },
    });
    const sessionId = (opened.json() as { session: { id: string } }).session.id;

    const badKind = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'REFUND', amountDa: 100 },
    });
    expect(badKind.statusCode).toBe(400);

    const badAmount = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'COLLECTION', amountDa: 0 },
    });
    expect(badAmount.statusCode).toBe(400);

    const c1 = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'COLLECTION', amountDa: 4500, ref: 'COM-0101' },
    });
    expect(c1.statusCode).toBe(201);
    expect((c1.json() as { expectedDa: number }).expectedDa).toBe(6500); // 2000 + 4500

    const payout = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'PAYOUT', amountDa: 500, note: 'Fournisseur eau' },
    });
    expect(payout.statusCode).toBe(201);
    expect((payout.json() as { expectedDa: number }).expectedDa).toBe(6000); // 6500 - 500

    const current = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/cash/sessions/current`, headers: bearer(hamid),
    });
    const currentBody = current.json() as { movements: unknown[]; expectedDa: number };
    expect(currentBody.movements).toHaveLength(2);
    expect(currentBody.expectedDa).toBe(6000);

    const closed = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions/${sessionId}/close`,
      headers: bearer(hamid), payload: { declaredClosingDa: 5900 },
    });
    expect(closed.statusCode).toBe(200);
    const closedBody = closed.json() as { session: { status: string }; expectedDa: number; varianceDa: number };
    expect(closedBody.session.status).toBe('CLOSED');
    expect(closedBody.expectedDa).toBe(6000);
    expect(closedBody.varianceDa).toBe(-100); // déclaré 5900, attendu 6000

    const reclose = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions/${sessionId}/close`,
      headers: bearer(hamid), payload: { declaredClosingDa: 5900 },
    });
    expect(reclose.statusCode).toBe(400);
    expect((reclose.json() as { error: string }).error).toBe('INVALID_TARGET');

    const afterClose = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'COLLECTION', amountDa: 100 },
    });
    expect(afterClose.statusCode).toBe(404); // plus de caisse ouverte
  });

  it('aucune caisse ouverte → mouvement refusé (404)', async () => {
    await closeAnyOpenSession();
    const res = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'COLLECTION', amountDa: 100 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('historique : sessions passées avec écart recalculé', async () => {
    const list = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(hamid),
    });
    expect(list.statusCode).toBe(200);
    const sessions = (list.json() as { sessions: { status: string; expectedDa: number }[] }).sessions;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => typeof s.expectedDa === 'number')).toBe(true);
  });
});

describe('noms d’acteur réels — chantier Caisse (06/09/2026), resolveActorNames (lib/actor-names.ts, même fonction que Journal)', () => {
  it('ouverture, mouvement et clôture portent le vrai nom de leur acteur, jamais un id brut', async () => {
    await closeAnyOpenSession();
    const opened = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(nadia),
      payload: { openingFloatDa: 1000 },
    });
    const openedSession = (opened.json() as { session: { id: string; openedByName: string } }).session;
    expect(openedSession.openedByName).toBe('Nadia Cherif');

    const move = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
      payload: { kind: 'COLLECTION', amountDa: 500 },
    });
    expect((move.json() as { movement: { byUserName: string } }).movement.byUserName).toBe('Nadia Cherif');

    const current = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/cash/sessions/current`, headers: bearer(hamid),
    });
    const currentBody = current.json() as { session: { openedByName: string }; movements: { byUserName: string }[] };
    expect(currentBody.session.openedByName).toBe('Nadia Cherif');
    expect(currentBody.movements[0]!.byUserName).toBe('Nadia Cherif');

    const closed = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions/${openedSession.id}/close`,
      headers: bearer(hamid), payload: { declaredClosingDa: 1500 },
    });
    const closedSession = (closed.json() as { session: { openedByName: string; closedByName: string | null } }).session;
    expect(closedSession.openedByName).toBe('Nadia Cherif');
    expect(closedSession.closedByName).toBe('Hamid Benali');
  });

  it('acteur dont le compte a depuis disparu : « Compte supprimé », jamais un id brut ni un crash', async () => {
    await closeAnyOpenSession();
    const ghostId = '00000000-0000-0000-0000-000000000000';
    await stack.db.insertInto('cash_sessions').values({
      venue_id: seed.venueId, opened_by: ghostId, opening_float_da: 0, status: 'CLOSED',
      closed_by: ghostId, closed_at: new Date(), declared_closing_da: 0,
    }).execute();

    const list = await stack.app.inject({
      method: 'GET', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(hamid),
    });
    expect(list.statusCode).toBe(200);
    const ghost = (list.json() as { sessions: { openedBy: string; openedByName: string; closedByName: string | null }[] })
      .sessions.find((s) => s.openedBy === ghostId);
    expect(ghost).toBeDefined();
    expect(ghost?.openedByName).toBe('Compte supprimé');
    expect(ghost?.closedByName).toBe('Compte supprimé');
  });
});

describe('concurrence mouvement vs clôture', () => {
  it('un mouvement et une clôture simultanés sur la même session restent cohérents (jamais de 500, jamais de double compte)', async () => {
    await closeAnyOpenSession();
    const opened = await stack.app.inject({
      method: 'POST', url: `/venues/${seed.venueId}/cash/sessions`, headers: bearer(nadia),
      payload: { openingFloatDa: 1000 },
    });
    const sessionId = (opened.json() as { session: { id: string } }).session.id;

    const [moveRes, closeRes] = await Promise.all([
      stack.app.inject({
        method: 'POST', url: `/venues/${seed.venueId}/cash/movements`, headers: bearer(nadia),
        payload: { kind: 'COLLECTION', amountDa: 777 },
      }),
      stack.app.inject({
        method: 'POST', url: `/venues/${seed.venueId}/cash/sessions/${sessionId}/close`,
        headers: bearer(hamid), payload: { declaredClosingDa: 1000 },
      }),
    ]);

    expect([200, 201, 400, 404]).toContain(moveRes.statusCode);
    expect(closeRes.statusCode).toBe(200);

    const movementRows = await stack.db.selectFrom('cash_movements')
      .selectAll().where('session_id', '=', sessionId).execute();
    const closedRow = await stack.db.selectFrom('cash_sessions')
      .select('declared_closing_da').where('id', '=', sessionId).executeTakeFirstOrThrow();

    // Cohérence : le mouvement a soit réussi (une ligne en base, incluse dans
    // le calcul de clôture ultérieur), soit échoué (aucune ligne) — jamais un
    // état intermédiaire où la ligne existe sans avoir été comptée, ou l'inverse.
    if (moveRes.statusCode === 201) {
      expect(movementRows).toHaveLength(1);
    } else {
      expect(movementRows).toHaveLength(0);
    }
    expect(closedRow.declared_closing_da).toBe(1000);
  });
});
