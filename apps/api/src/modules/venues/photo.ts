import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';
import { writeAudit } from '../../audit/log.js';

/* La photo principale d'un centre (lot « Match libre », phase photos — option A d'Aymen du 17/11/2026 : dans la base, coût 0, aucune
   dépendance). UNE photo par centre : le premier des quatre emplacements du CRM, « Photo d'ambiance ». Le CRM la réduit LUI-MÊME dans le
   navigateur du gérant (canvas) en deux tailles, JPEG ou WebP ; le serveur ne fait que vérifier et ranger (migration 0049).

   - PUT /venues/:venueId/photo     { mime, large, card } (base64) — EDIT_PROFILE, comme la fiche du centre.
   - DELETE /venues/:venueId/photo  — même permission.
   - GET /venues/:venueId/photo/:size (large | card) — publique, les octets de l'image ; cache d'un an (l'app ajoute `?v=version`).

   La version (`photoVersion`, `null` sans photo) est servie par GET /venues et GET /venues/:id (routes.ts). */

const MAX = { large: 900_000, card: 250_000 } as const;
const MIMES = ['image/jpeg', 'image/webp'] as const;
type Mime = (typeof MIMES)[number];

/** Les premiers octets disent ce qu'est vraiment le fichier — jamais le type annoncé seul. */
function sniff(buf: Buffer): Mime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decode(raw: unknown, size: 'large' | 'card', mime: Mime): Buffer {
  if (typeof raw !== 'string' || raw.length === 0) throw badRequest(`Image ${size} manquante.`, 'PHOTO_INVALID');
  const b64 = raw.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw badRequest(`Image ${size} illisible.`, 'PHOTO_INVALID');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0 || buf.length > MAX[size]) throw badRequest(`Image ${size} trop lourde.`, 'PHOTO_TOO_LARGE');
  if (sniff(buf) !== mime) throw badRequest('Ce fichier n’est pas une image JPEG ou WebP.', 'PHOTO_INVALID');
  return buf;
}

export async function registerVenuePhotoRoutes(app: FastifyInstance, { db, guards }: { db: Db; guards: PlatformGuards }): Promise<void> {
  app.put<{ Params: { venueId: string }; Body: { mime?: unknown; large?: unknown; card?: unknown } }>('/venues/:venueId/photo',
    { bodyLimit: 1_600_000, preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PROFILE');
      const b = req.body ?? {};
      if (!(MIMES as readonly unknown[]).includes(b.mime)) throw badRequest('Format d’image : JPEG ou WebP.', 'PHOTO_INVALID');
      const mime = b.mime as Mime;
      const large = decode(b.large, 'large', mime);
      const card = decode(b.card, 'card', mime);
      const actorId = req.platformAuth!.accountId;
      const row = await db.insertInto('venue_photos')
        .values({ venue_id: req.params.venueId, mime, large, card, version: 1, updated_by: actorId })
        .onConflict((oc) => oc.column('venue_id').doUpdateSet({
          mime, large, card, version: sql<number>`venue_photos.version + 1`, updated_at: sql<Date>`now()`, updated_by: actorId,
        }))
        .returning(['version']).executeTakeFirstOrThrow();
      await writeAudit(db, {
        venueId: req.params.venueId, actorId, actorRole: role, action: 'CENTER_UPDATED', objectType: 'venue', objectId: req.params.venueId,
        summary: 'a changé la photo du centre',
      });
      return reply.send({ photoVersion: row.version });
    });

  app.delete<{ Params: { venueId: string } }>('/venues/:venueId/photo',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PROFILE');
      const res = await db.deleteFrom('venue_photos').where('venue_id', '=', req.params.venueId).executeTakeFirst();
      if (Number(res.numDeletedRows) > 0) {
        await writeAudit(db, {
          venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role, action: 'CENTER_UPDATED',
          objectType: 'venue', objectId: req.params.venueId, summary: 'a retiré la photo du centre',
        });
      }
      return reply.send({ photoVersion: null });
    });

  /* Publique, comme la fiche d'un centre : une photo de terrain n'a rien de personnel. Le centre inconnu et le centre sans photo
     répondent pareil (404) : l'app retombe alors sur le logo Moubarat. */
  app.get<{ Params: { venueId: string; size: string } }>('/venues/:venueId/photo/:size', async (req, reply) => {
    const size = req.params.size;
    if (size !== 'large' && size !== 'card') throw notFound('Photo introuvable.');
    if (!/^[0-9a-f-]{36}$/i.test(req.params.venueId)) throw notFound('Photo introuvable.');
    const row = await db.selectFrom('venue_photos').select(['mime', size, 'version'])
      .where('venue_id', '=', req.params.venueId).executeTakeFirst();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Photo introuvable.');
    return reply
      .header('content-type', row.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(row[size]);
  });
}
