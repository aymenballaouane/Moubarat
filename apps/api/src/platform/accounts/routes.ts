import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';

interface Deps { db: Db; guards: PlatformGuards; }

/* SUPERADMIN V1, étape 2 — première ressource réellement protégée par
   requireSuperadmin (pas juste requirePlatformAuth) : qui a un accès
   plateforme aujourd'hui ? Sert aussi de preuve HTTP du guard avant de
   construire l'étape 3 (centres). Jamais password_hash dans la réponse. */
export async function registerPlatformAccountRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get('/platform/accounts', { preHandler: (req) => guards.requireSuperadmin(req) }, async (_req, reply) => {
    const rows = await db.selectFrom('platform_accounts')
      .select(['id', 'email', 'name', 'is_superadmin', 'status', 'created_at'])
      .orderBy('created_at').execute();
    return reply.send({
      accounts: rows.map((r) => ({
        id: r.id, email: r.email, name: r.name,
        isSuperadmin: r.is_superadmin, status: r.status, createdAt: r.created_at,
      })),
    });
  });
}
