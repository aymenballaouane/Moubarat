import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { resolveActorNames, DELETED_ACTOR_LABEL } from '../../lib/actor-names.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface AuditQuery { action?: string; objectType?: string; q?: string; limit?: string; cursor?: string }

/* Journal plateforme (§6/§11/§13 du mandat, étape 6) — lecture seule sur le
   MÊME audit_log que le CRM (décision Aymen §8, un seul journal). actor_id
   n'a plus de FK (migration 0006, polymorphe) : on résout le nom en
   cherchant dans les deux espaces d'identité possibles (users pour les
   actions CRM historiques, platform_accounts pour les actions SUPERADMIN),
   jamais un deuxième système de journalisation. */
export async function registerPlatformAuditRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get<{ Querystring: AuditQuery }>('/platform/audit-log',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    // L3 (mise à l'échelle, 25/09/2026) : curseur (lib/cursor.ts) — `limit` absent = 100, max 500 ; réponse = les
    // mêmes `entries` plus `nextCursor`. Plus récentes d'abord, départagées par id (index audit_log_at, migration 0026).
    const limit = pageLimit(req.query.limit, { def: 100, max: 500 });
    const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
    let query = db.selectFrom('audit_log').selectAll().select(isoMicros(sql.ref('audit_log.at')).as('at_cursor'));
    if (req.query.action) query = query.where('action', '=', req.query.action);
    if (req.query.objectType) query = query.where('object_type', '=', req.query.objectType);
    if (req.query.q) query = query.where('summary', 'ilike', `%${req.query.q}%`);
    if (cursor) query = query.where(sql<boolean>`(audit_log.at, audit_log.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
    const page = pageOf(
      await query.orderBy('at', 'desc').orderBy('id', 'desc').limit(limit + 1).execute(),
      limit, (r) => [r.at_cursor, r.id],
    );
    const rows = page.items;
    if (rows.length === 0) return reply.send({ entries: [], nextCursor: null });

    const nameById = await resolveActorNames(db, [...new Set(rows.map((r) => r.actor_id))]);

    return reply.send({
      nextCursor: page.nextCursor,
      entries: rows.map((r) => ({
        id: r.id, actorId: r.actor_id, actorName: nameById.get(r.actor_id) ?? DELETED_ACTOR_LABEL,
        actorRole: r.actor_role, action: r.action, objectType: r.object_type, objectId: r.object_id,
        summary: r.summary, before: r.before_val, after: r.after_val,
        venueId: r.venue_id, at: r.at,
      })),
    });
  });
}
