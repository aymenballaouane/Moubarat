import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { withRosterCounts, type MatchRow } from '../../modules/matches/service.js';
import { dayStartMs } from '../../lib/algiers.js';
import { toPgRange } from '../../lib/pgrange.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface MatchQuery {
  status?: string; venueId?: string; organizerId?: string; day?: string;
}

/* Supervision transversale (§7 du mandat) : les mêmes lectures que
   apps/api/src/modules/matches, juste sans filtre par centre — réutilise
   publicMatch/withRosterCounts (module matches), aucune règle nouvelle. */
export async function registerPlatformMatchRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get<{ Querystring: MatchQuery }>('/platform/matches',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    let query = db.selectFrom('matches')
      .leftJoin('venues', 'venues.id', 'matches.venue_id')
      .leftJoin('users', 'users.id', 'matches.organizer_id')
      .selectAll('matches')
      .select(['venues.name as venue_name', 'users.name as organizer_name'])
      .orderBy('matches.created_at', 'desc')
      .limit(200);

    if (req.query.status) query = query.where('matches.status', '=', req.query.status as MatchRow['status']);
    if (req.query.venueId) query = query.where('matches.venue_id', '=', req.query.venueId);
    if (req.query.organizerId) query = query.where('matches.organizer_id', '=', req.query.organizerId);
    if (req.query.day) {
      const start = dayStartMs(req.query.day);
      const dayRange = toPgRange({ start, end: start + 86_400_000 });
      query = query.where(sql<boolean>`matches.time_range && ${dayRange}::tstzrange`);
    }

    const rows = await query.execute();
    const enriched = await withRosterCounts(db, rows as unknown as MatchRow[]);
    return reply.send({
      matches: enriched.map((m, i) => ({ ...m, venueName: rows[i]!.venue_name, organizerName: rows[i]!.organizer_name })),
    });
  });
}
