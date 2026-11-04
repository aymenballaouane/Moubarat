import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { fromPgRange, toPgRange } from '../../lib/pgrange.js';
import { dayStartMs } from '../../lib/algiers.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface BookingQuery {
  status?: string; venueId?: string; fieldId?: string; day?: string;
}

/* Supervision transversale (§8 du mandat) : même principe que /platform/matches
   — les mêmes données que le module bookings, sans filtre par centre. */
export async function registerPlatformBookingRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {
  app.get<{ Querystring: BookingQuery }>('/platform/bookings',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    let query = db.selectFrom('bookings')
      .innerJoin('fields', 'fields.id', 'bookings.field_id')
      .innerJoin('venues', 'venues.id', 'fields.venue_id')
      .leftJoin('users', 'users.id', 'bookings.by_user_id')
      .select([
        'bookings.id', 'bookings.time_range', 'bookings.status', 'bookings.source',
        'bookings.verified_by_center', 'bookings.reservation_name', 'bookings.reference',
        'bookings.price_total_da', 'bookings.match_id', 'bookings.created_at',
        'fields.id as field_id', 'fields.name as field_name',
        'venues.id as venue_id', 'venues.name as venue_name',
        'users.name as by_user_name', 'bookings.by_user_id',
      ])
      .orderBy('bookings.created_at', 'desc')
      .limit(200);

    if (req.query.status) query = query.where('bookings.status', '=', req.query.status as 'RESERVED');
    if (req.query.venueId) query = query.where('venues.id', '=', req.query.venueId);
    if (req.query.fieldId) query = query.where('fields.id', '=', req.query.fieldId);
    if (req.query.day) {
      const start = dayStartMs(req.query.day);
      const dayRange = toPgRange({ start, end: start + 86_400_000 });
      query = query.where(sql<boolean>`bookings.time_range && ${dayRange}::tstzrange`);
    }

    const rows = await query.execute();
    return reply.send({
      bookings: rows.map((r) => {
        const range = fromPgRange(r.time_range);
        return {
          id: r.id, start: range.start, end: range.end, status: r.status, source: r.source,
          verifiedByCenter: r.verified_by_center, reservationName: r.reservation_name, reference: r.reference,
          priceTotalDa: r.price_total_da, matchId: r.match_id, createdAt: r.created_at,
          fieldId: r.field_id, fieldName: r.field_name, venueId: r.venue_id, venueName: r.venue_name,
          byUserId: r.by_user_id, byUserName: r.by_user_name,
        };
      }),
    });
  });
}
