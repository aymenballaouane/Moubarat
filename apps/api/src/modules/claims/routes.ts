import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { canRespondToClaim } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { writeAudit } from '../../audit/log.js';
import { must } from '../../lib/http.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { getBookingWithVenue } from '../bookings/service.js';

/* Règle 21 — « C'est bien toi ? » : les réservations que des centres ont saisies à MON numéro et qui attendent ma réponse, et la réponse.
   « C'est moi » : la réservation passe à mon nom (elle compte pour moi, elle apparaît dans Mes réservations). « Ce n'est pas moi » : elle disparaît de mes matchs et le centre est
   prévenu (ligne du Journal du centre, auteur « Moubarat » — un joueur n'est jamais un acteur du centre — et pastille sur la réservation dans le CRM). */

interface Deps { db: Db; guards: Guards }

export async function registerClaimRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.get('/me/claims', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const rows = await db.selectFrom('bookings')
      .innerJoin('fields', 'fields.id', 'bookings.field_id')
      .innerJoin('venues', 'venues.id', 'fields.venue_id')
      .select([
        'bookings.id', 'bookings.reference', 'bookings.time_range', 'bookings.field_id', 'bookings.format', 'bookings.price_total_da',
        'bookings.reservation_name', 'fields.name as field_name', 'venues.id as venue_id', 'venues.name as venue_name',
      ])
      .where('bookings.claimed_user_id', '=', req.auth!.userId).where('bookings.claim_status', '=', 'PENDING')
      .where('bookings.status', '=', 'RESERVED').where(sql<boolean>`upper(bookings.time_range) > now()`)
      .orderBy(sql`lower(bookings.time_range)`)
      .execute();
    return reply.send({
      claims: rows.map((r) => {
        const range = fromPgRange(r.time_range);
        return {
          bookingId: r.id, reference: r.reference, start: range.start, end: range.end, fieldId: r.field_id, field: r.field_name,
          venue: { id: r.venue_id, name: r.venue_name }, format: r.format, totalDa: r.price_total_da, reservationName: r.reservation_name,
        };
      }),
    });
  });

  for (const answer of ['confirm', 'decline'] as const) {
    app.post<{ Params: { id: string } }>(`/me/claims/:id/${answer}`, { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const me = req.auth!.userId;
      const out = await db.transaction().execute(async (trx) => {
        const { row, venue } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        must(canRespondToClaim({
          status: row.status, start: fromPgRange(row.time_range).start, claimStatus: row.claim_status, claimedUserId: row.claimed_user_id,
        }, me, now));
        if (answer === 'confirm') {
          await trx.updateTable('bookings').set({ by_user_id: me, claim_status: 'CONFIRMED' }).where('id', '=', row.id).execute();
        } else {
          await trx.updateTable('bookings').set({ claim_status: 'DECLINED' }).where('id', '=', row.id).execute();
        }
        await writeAudit(trx, {
          venueId: venue.id, actorId: me, actorRole: 'SUPERADMIN',
          action: answer === 'confirm' ? 'BOOKING_CLAIM_CONFIRMED' : 'BOOKING_CLAIM_DECLINED',
          objectType: 'booking', objectId: row.id,
          summary: answer === 'confirm'
            ? `a prévenu que le joueur à ce numéro confirme la réservation ${row.reference ?? row.id} (« C’est moi ») — elle passe à son nom`
            : `a prévenu que le joueur à ce numéro dit que ce n’est pas lui pour la réservation ${row.reference ?? row.id} — elle reste au nom du centre`,
        });
        return { bookingId: row.id };
      });
      return reply.send({ ok: true, bookingId: out.bookingId, answer });
    });
  }
}
