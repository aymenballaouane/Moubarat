import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';

interface Deps { db: Db; guards: PlatformGuards; }

const STATUSES = ['NEW', 'CONVERTED', 'REJECTED'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Demandes d'inscription d'un centre (20/09/2026, demande d'Aymen) — côté superadmin. Superadmin
   UNIQUEMENT (données personnelles d'un contact). La CONVERSION en centre n'a pas de route à elle :
   elle passe par POST /platform/venues avec `requestId` (même transaction que la création du
   centre), pour que toutes les créations de centre partagent le même flux de validation. */
export async function registerPlatformVenueRequestRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  async function counts() {
    const rows = await db.selectFrom('venue_requests').select(['status', (eb) => eb.fn.countAll().as('n')]).groupBy('status').execute();
    const by = { NEW: 0, CONVERTED: 0, REJECTED: 0 };
    for (const r of rows) by[r.status] = Number(r.n);
    return { new: by.NEW, converted: by.CONVERTED, rejected: by.REJECTED };
  }

  app.get<{ Querystring: { status?: string } }>('/platform/venue-requests',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const status = req.query.status ?? 'NEW';
    if (status !== 'ALL' && !(STATUSES as readonly string[]).includes(status)) throw badRequest('status invalide : NEW, CONVERTED, REJECTED ou ALL.');
    let q = db.selectFrom('venue_requests').leftJoin('venues', 'venues.id', 'venue_requests.venue_id')
      .select([
        'venue_requests.id', 'venue_requests.created_at', 'venue_requests.status', 'venue_requests.name',
        'venue_requests.wilaya', 'venue_requests.address', 'venue_requests.contact_name', 'venue_requests.contact_phone',
        'venue_requests.contact_email', 'venue_requests.sports', 'venue_requests.fields_count', 'venue_requests.message',
        'venue_requests.venue_id', 'venue_requests.decided_at', 'venues.name as venue_name',
      ])
      .orderBy('venue_requests.created_at', 'desc').limit(200);
    if (status !== 'ALL') q = q.where('venue_requests.status', '=', status as (typeof STATUSES)[number]);
    const rows = await q.execute();
    return reply.send({
      counts: await counts(),
      // Jamais ip_hash ni consent_at : ni utiles à l'écran, ni à exposer.
      requests: rows.map((r) => ({
        id: r.id, createdAt: r.created_at, status: r.status, name: r.name, wilaya: r.wilaya, address: r.address,
        contactName: r.contact_name, contactPhone: r.contact_phone, contactEmail: r.contact_email,
        sports: r.sports, fieldsCount: r.fields_count, message: r.message,
        venueId: r.venue_id, venueName: r.venue_name, decidedAt: r.decided_at,
      })),
    });
  });

  /* Léger : sert le badge de la navigation (interrogé toutes les 60 s tant que la console est ouverte). */
  app.get('/platform/venue-requests/count',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (_req, reply) => {
    return reply.send({ new: (await counts()).new });
  });

  app.post<{ Params: { id: string } }>('/platform/venue-requests/:id/reject',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) throw notFound('Demande introuvable.');
    const accountId = req.platformAuth!.accountId;
    const done = await db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('venue_requests').select(['id', 'name', 'status']).where('id', '=', req.params.id).forUpdate().executeTakeFirst();
      if (!row) return { error: notFound('Demande introuvable.') };
      if (row.status !== 'NEW') return { error: new ApiError(409, 'REQUEST_ALREADY_HANDLED', 'Cette demande a déjà été traitée.') };
      await trx.updateTable('venue_requests').set({ status: 'REJECTED', decided_at: new Date(), decided_by: accountId }).where('id', '=', row.id).execute();
      return { name: row.name, id: row.id };
    });
    if ('error' in done) throw done.error;
    await writeAudit(db, {
      actorId: accountId, actorRole: 'SUPERADMIN', action: 'VENUE_REQUEST_REJECTED',
      objectType: 'venue_request', objectId: done.id, summary: `a refusé la demande d'inscription du centre ${done.name}`,
    });
    return reply.send({ request: { id: done.id, status: 'REJECTED' } });
  });
}
