import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { resolveActorNames, DELETED_ACTOR_LABEL } from '../../lib/actor-names.js';

interface Deps { db: Db; guards: PlatformGuards; }

const PLATFORM_ACTOR_LABEL = 'Équipe Moubarat';

interface AuditQuery { limit?: string; cursor?: string }

/** Journal du centre (« boîte noire ») — MÊME table `audit_log` que le
    journal plateforme (platform/audit/routes.ts, décision Aymen §8, un seul
    journal), filtrée sur ce venue et sans les permissions SUPERADMIN.
    VIEW_AUDIT_LOG = Manager+ (core). Réponse volontairement minimale
    (id/actorName/actorRole/summary/at) : l'écran CRM n'a ni filtre par
    action ni before/after, contrairement à la console plateforme — pas de
    champ inutilisé exposé. */
export async function registerAuditRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get<{ Params: { venueId: string }; Querystring: AuditQuery }>('/venues/:venueId/audit-log',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_AUDIT_LOG');
      // L3 (mise à l'échelle, 25/09/2026) : curseur (lib/cursor.ts) — `limit` absent = 100 (l'ancien défaut), max 200 ;
      // plus récentes d'abord, départagées par id. Réponse : les mêmes `entries` plus `nextCursor`.
      const limit = pageLimit(req.query.limit, { def: 100, max: 200 });
      const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
      let query = db.selectFrom('audit_log').selectAll()
        .select(isoMicros(sql.ref('audit_log.at')).as('at_cursor'))
        .where('venue_id', '=', req.params.venueId);
      if (cursor) query = query.where(sql<boolean>`(audit_log.at, audit_log.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
      const page = pageOf(
        await query.orderBy('at', 'desc').orderBy('id', 'desc').limit(limit + 1).execute(),
        limit, (r) => [r.at_cursor, r.id],
      );
      const rows = page.items;
      if (rows.length === 0) return reply.send({ entries: [], nextCursor: null });

      // Acteur polymorphe (migration 0006, plus de FK) : TOUJOURS un compte
      // plateforme ici en pratique — vérifié par inspection de tous les appels
      // `writeAudit` qui renseignent `venueId` (bookings/venues/cash/
      // recurring-bookings routes ; audit 09/09/2026, D11 : 15 à cette date,
      // reproductible par `grep -rn "writeAudit(" apps/api/src -A3 | grep -B3
      // "venueId:" | grep -c "writeAudit("` — jamais recompter à la main, ce
      // chiffre a déjà dérivé une fois, 13 → 15, sans que ce commentaire ne
      // bouge) : chacun prend son `actorId` sur `req.platformAuth!.accountId`
      // (jamais `req.auth`, l'identité Player), y compris la seule résa
      // auditée à la création (WALK_IN, jamais MOUBARAT/PHONE — voir
      // bookings/routes.ts). Résolu dans les deux espaces d'identité quand
      // même, par prudence, pas parce que le cas joueur existe aujourd'hui —
      // même défense que platform/audit/routes.ts (resolveActorNames,
      // lib/actor-names.ts).
      const nameById = await resolveActorNames(db, [...new Set(rows.map((r) => r.actor_id))]);

      // Depuis le 22/09/2026 (audit produit CE1/CR20), des actions du SUPERADMIN portent un `venueId`
      // (modification de la fiche du centre, suspension d'un compte CRM rattaché) et apparaissent donc
      // dans ce journal. Le centre voit « Équipe Moubarat », JAMAIS le nom personnel du compte plateforme.
      return reply.send({
        nextCursor: page.nextCursor,
        entries: rows.map((r) => ({
          id: r.id,
          actorName: r.actor_role === 'SUPERADMIN' ? PLATFORM_ACTOR_LABEL : (nameById.get(r.actor_id) ?? DELETED_ACTOR_LABEL),
          actorRole: r.actor_role, summary: r.summary, at: r.at,
        })),
      });
    });
}
