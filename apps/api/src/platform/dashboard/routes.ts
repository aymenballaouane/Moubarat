import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { algiersDateOf, dayStartMs } from '../../lib/algiers.js';
import { toPgRange } from '../../lib/pgrange.js';

interface Deps { db: Db; guards: PlatformGuards; }

const DAY_MS = 86_400_000;

/* Vue plateforme (§1 du mandat) — pilotage global, pas gestion d'un centre.
   Chaque chiffre est une requête directe, aucune donnée mise en cache ou
   pré-agrégée : le tableau de bord reflète l'instant présent. */
export async function registerPlatformDashboardRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get('/platform/dashboard', { preHandler: (req) => guards.requireSuperadmin(req) }, async (_req, reply) => {
    const now = Date.now();
    const today = algiersDateOf(now);
    const todayRange = toPgRange({ start: dayStartMs(today), end: dayStartMs(today) + DAY_MS });

    const [
      centersByStatus, playerCount, matchesToday, bookingsToday, recentAudit, newRequests,
    ] = await Promise.all([
      db.selectFrom('venues').select(['status', (eb) => eb.fn.countAll().as('n')]).groupBy('status').execute(),
      db.selectFrom('users').where('role', '=', 'PLAYER')
        .select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      db.selectFrom('matches')
        .where(sql<boolean>`matches.time_range && ${todayRange}::tstzrange`)
        .where('status', '!=', 'CANCELLED')
        .select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      db.selectFrom('bookings')
        .where(sql<boolean>`bookings.time_range && ${todayRange}::tstzrange`)
        .where('status', '!=', 'CANCELLED')
        .select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      db.selectFrom('audit_log').selectAll().orderBy('at', 'desc').limit(10).execute(),
      db.selectFrom('venue_requests').where('status', '=', 'NEW').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
    ]);

    const byStatus = { PENDING: 0, ACTIVE: 0, REJECTED: 0, SUSPENDED: 0 };
    for (const row of centersByStatus) byStatus[row.status as keyof typeof byStatus] = Number(row.n);

    return reply.send({
      centers: {
        total: byStatus.PENDING + byStatus.ACTIVE + byStatus.REJECTED + byStatus.SUSPENDED,
        active: byStatus.ACTIVE, pending: byStatus.PENDING,
        suspended: byStatus.SUSPENDED, rejected: byStatus.REJECTED,
      },
      requests: { new: Number(newRequests?.n ?? 0) },
      players: Number(playerCount?.n ?? 0),
      matchesToday: Number(matchesToday?.n ?? 0),
      bookingsToday: Number(bookingsToday?.n ?? 0),
      recentActivity: recentAudit.map((e) => ({
        id: e.id, actorRole: e.actor_role, action: e.action,
        objectType: e.object_type, objectId: e.object_id,
        summary: e.summary, at: e.at,
      })),
    });
  });
}
