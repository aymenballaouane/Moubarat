import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { badRequest, ApiError, notFound } from '../../lib/http.js';
import { resolveActorNames, DELETED_ACTOR_LABEL } from '../../lib/actor-names.js';
import {
  applyCashMovement, applyCloseSession, buildOpenSession, computeExpected,
  loadOpenSession, loadSessionForUpdate, movementsFor, publicCashMovement,
  publicCashSession, rowToCashMovement, rowToCashSession,
} from './service.js';

/** Écran CRM Caisse (06/09/2026) : `publicCashSession`/`publicCashMovement`
    renvoient des ids d'acteur bruts (`openedBy`/`closedBy`/`byUserId`,
    des `platform_accounts.id`) — la démo affichait un nom parce qu'elle
    stockait directement un nom de fantaisie à la place, jamais un vrai id.
    Résolution via `resolveActorNames` (lib/actor-names.ts) — MÊME fonction
    que Journal, jamais une copie. */
function withSessionNames(session: Record<string, unknown>, nameById: ReadonlyMap<string, string>) {
  const closedBy = session.closedBy as string | null;
  return {
    ...session,
    openedByName: nameById.get(session.openedBy as string) ?? DELETED_ACTOR_LABEL,
    closedByName: closedBy !== null ? (nameById.get(closedBy) ?? DELETED_ACTOR_LABEL) : null,
  };
}

function withMovementName(movement: Record<string, unknown>, nameById: ReadonlyMap<string, string>) {
  return { ...movement, byUserName: nameById.get(movement.byUserId as string) ?? DELETED_ACTOR_LABEL };
}

/* CRM Auth V1 : l'acteur d'une action caisse est un platform_account,
   plus jamais un users.id — opened_by/closed_by/by_user_id n'ont plus de
   contrainte FK stricte depuis la migration 0010 (même correctif que
   audit_log.actor_id, décision Aymen 03/09/2026 : pas de compte système
   générique, l'identité réelle doit rester traçable pour un futur rapport
   par membre du personnel). */
interface Deps { db: Db; guards: PlatformGuards; }

const MOVEMENT_KINDS = ['COLLECTION', 'PAYOUT'] as const;

export async function registerCashRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Ouverture — une seule caisse ouverte par centre (RECEPTION/MANAGER/OWNER).
     `openCashSession` (core) décide sur un `hasOpenSession` lu juste avant ;
     l'index unique partiel `one_open_cash_session` reste l'arbitre final sous
     concurrence réelle (deux ouvertures simultanées) — la violation 23505 est
     mappée ici en refus propre plutôt qu'un 500, même discipline que la
     référence de réservation (bookings/service.ts). */
  app.post<{ Params: { venueId: string }; Body: { openingFloatDa?: number } }>(
    '/venues/:venueId/cash/sessions', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'CASH_SESSION');
      const openingFloatDa = Number(req.body?.openingFloatDa ?? 0);
      if (!Number.isInteger(openingFloatDa) || openingFloatDa < 0) {
        throw badRequest('Le fonds d’ouverture est un entier positif.');
      }
      const now = Date.now();
      const existing = await loadOpenSession(db, req.params.venueId);
      const session = buildOpenSession({
        venueId: req.params.venueId, by: req.platformAuth!.accountId, at: now, openingFloatDa,
        hasOpenSession: existing !== undefined,
      });
      let row;
      try {
        row = await db.insertInto('cash_sessions').values({
          venue_id: session.venueId, opened_by: session.openedBy,
          opening_float_da: session.openingFloatDa, status: 'OPEN',
        }).returningAll().executeTakeFirstOrThrow();
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505' && (e.constraint ?? '').includes('one_open_cash_session')) {
          throw new ApiError(409, 'INVALID_TARGET', 'Une caisse est déjà ouverte — clôture-la d’abord.');
        }
        throw err;
      }
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'CASH_SESSION', objectType: 'cash_session', objectId: row.id,
        summary: `a ouvert la caisse (fonds de départ ${openingFloatDa} DA)`,
      });
      const nameById = await resolveActorNames(db, [row.opened_by]);
      return reply.code(201).send({ session: withSessionNames(publicCashSession(row), nameById) });
    });

  /* Session en cours — même permission que l'ouverture (aucune action de
     lecture dédiée dans la matrice core canCenterAct pour la caisse). */
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/cash/sessions/current',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    await guards.requireCenterAction(req, req.params.venueId, 'CASH_SESSION');
    const row = await loadOpenSession(db, req.params.venueId);
    if (!row) return reply.send({ session: null });
    const movements = await movementsFor(db, row.id);
    const expectedDa = computeExpected(rowToCashSession(row), movements.map(rowToCashMovement));
    const nameById = await resolveActorNames(db, [row.opened_by, ...movements.map((m) => m.by_user_id)]);
    return reply.send({
      session: withSessionNames(publicCashSession(row), nameById),
      movements: movements.map((m) => withMovementName(publicCashMovement(m), nameById)),
      expectedDa,
    });
  });

  /* Mouvement — verrou d'agrégat sur LA session (par id, pas juste « la session
     ouverte du centre ») : sérialise avec une clôture concurrente sur cette
     même session (routes.ts /close prend le même verrou) — un mouvement qui
     arrive après une clôture voit le statut CLOSED à jour et se voit refusé
     par `addCashMovement` (core), jamais silencieusement accepté. */
  app.post<{
    Params: { venueId: string };
    Body: { kind?: string; amountDa?: number; ref?: string; note?: string };
  }>('/venues/:venueId/cash/movements', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'CASH_SESSION');
    const kind = String(req.body?.kind ?? '');
    if (!(MOVEMENT_KINDS as readonly string[]).includes(kind)) {
      throw badRequest('kind invalide : COLLECTION ou PAYOUT.');
    }
    const amountDa = Number(req.body?.amountDa);
    if (!Number.isInteger(amountDa) || amountDa <= 0) {
      throw badRequest('amountDa doit être un entier strictement positif.');
    }
    const ref = req.body?.ref !== undefined ? String(req.body.ref).trim() || undefined : undefined;
    const note = req.body?.note !== undefined ? String(req.body.note).trim() || undefined : undefined;
    const now = Date.now();

    const outcome = await db.transaction().execute(async (trx) => {
      const sessionRow = await loadOpenSession(trx, req.params.venueId, { forUpdate: true });
      if (!sessionRow) throw notFound('Aucune caisse ouverte pour ce centre.');
      const movement = applyCashMovement({
        session: rowToCashSession(sessionRow), kind: kind as 'COLLECTION' | 'PAYOUT',
        amountDa, by: req.platformAuth!.accountId, at: now,
        ...(ref !== undefined ? { ref } : {}), ...(note !== undefined ? { note } : {}),
      });
      const row = await trx.insertInto('cash_movements').values({
        session_id: movement.sessionId, kind: movement.kind, amount_da: movement.amountDa,
        by_user_id: movement.byUserId, ref: movement.ref ?? null, note: movement.note ?? null,
      }).returningAll().executeTakeFirstOrThrow();
      const movements = await movementsFor(trx, sessionRow.id);
      const expectedDa = computeExpected(rowToCashSession(sessionRow), movements.map(rowToCashMovement));
      await writeAudit(trx, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'CASH_MOVEMENT', objectType: 'cash_movement', objectId: row.id,
        summary: `a enregistré un mouvement ${kind === 'COLLECTION' ? 'd’encaissement' : 'de sortie'} de ${amountDa} DA`,
      });
      return { row, expectedDa };
    });
    const nameById = await resolveActorNames(db, [outcome.row.by_user_id]);
    return reply.code(201).send({
      movement: withMovementName(publicCashMovement(outcome.row), nameById), expectedDa: outcome.expectedDa,
    });
  });

  /* Clôture — même verrou. Le montant attendu est recalculé DANS la
     transaction, après acquisition du verrou : aucun mouvement ne peut plus
     s'intercaler entre la lecture des mouvements et la clôture. */
  app.post<{ Params: { venueId: string; id: string }; Body: { declaredClosingDa?: number } }>(
    '/venues/:venueId/cash/sessions/:id/close',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'CASH_SESSION');
      const declaredClosingDa = Number(req.body?.declaredClosingDa);
      if (!Number.isInteger(declaredClosingDa) || declaredClosingDa < 0) {
        throw badRequest('declaredClosingDa est un entier positif.');
      }
      const now = Date.now();
      const outcome = await db.transaction().execute(async (trx) => {
        const sessionRow = await loadSessionForUpdate(trx, req.params.venueId, req.params.id);
        const movements = await movementsFor(trx, sessionRow.id);
        const { session, expectedDa, varianceDa } = applyCloseSession({
          session: rowToCashSession(sessionRow), movements: movements.map(rowToCashMovement),
          declaredClosingDa, by: req.platformAuth!.accountId, at: now,
        });
        const row = await trx.updateTable('cash_sessions').set({
          status: session.status, closed_by: session.closedBy ?? null,
          closed_at: session.closedAt ? new Date(session.closedAt) : null,
          declared_closing_da: session.declaredClosingDa ?? null,
        }).where('id', '=', sessionRow.id).returningAll().executeTakeFirstOrThrow();
        await writeAudit(trx, {
          venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
          action: 'CASH_SESSION', objectType: 'cash_session', objectId: row.id,
          summary: `a clôturé la caisse : déclaré ${declaredClosingDa} DA, attendu ${expectedDa} DA (écart ${varianceDa >= 0 ? '+' : ''}${varianceDa} DA)`,
        });
        return { row, expectedDa, varianceDa };
      });
      const nameById = await resolveActorNames(db, [outcome.row.opened_by, outcome.row.closed_by].filter((id): id is string => id !== null));
      return reply.send({
        session: withSessionNames(publicCashSession(outcome.row), nameById),
        expectedDa: outcome.expectedDa, varianceDa: outcome.varianceDa,
      });
    });

  /* Historique — dernières sessions du centre, écart recalculé pour chacune
     (jamais stocké : source de vérité = mouvements réels, comme le CA). */
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/cash/sessions',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    await guards.requireCenterAction(req, req.params.venueId, 'CASH_SESSION');
    const sessions = await db.selectFrom('cash_sessions').selectAll()
      .where('venue_id', '=', req.params.venueId)
      .orderBy('opened_at', 'desc').limit(50).execute();
    if (sessions.length === 0) return reply.send({ sessions: [] });
    const movements = await db.selectFrom('cash_movements').selectAll()
      .where('session_id', 'in', sessions.map((s) => s.id)).execute();
    const byId = new Map<string, typeof movements>();
    for (const m of movements) byId.set(m.session_id, [...(byId.get(m.session_id) ?? []), m]);
    const actorIds = sessions.flatMap((s) => [s.opened_by, s.closed_by].filter((id): id is string => id !== null));
    const nameById = await resolveActorNames(db, actorIds);
    return reply.send({
      sessions: sessions.map((s) => {
        const ms = (byId.get(s.id) ?? []).map(rowToCashMovement);
        return { ...withSessionNames(publicCashSession(s), nameById), expectedDa: computeExpected(rowToCashSession(s), ms) };
      }),
    });
  });
}
