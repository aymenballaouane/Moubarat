import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { badRequest, notFound } from '../../lib/http.js';

interface Deps { db: Db; guards: Guards; }

/* Chantier iOS (04/09/2026) — enregistrement des appareils pour le push.
   L'app native reçoit un jeton APNs à chaque lancement et le (ré)envoie ici
   (PUT = idempotent : même jeton, même compte → simple `last_seen_at`) ; à la
   déconnexion elle le retire (DELETE), pour qu'un autre joueur connecté sur
   le même téléphone ne reçoive jamais les notifications du précédent.
   Toujours borné à l'appelant : on ne retire que SES jetons. */

/** Jeton APNs = octets en hexadécimal (64 caractères aujourd'hui — Apple
    demande de ne pas supposer une longueur fixe, d'où la fourchette). */
const IOS_TOKEN = /^[0-9a-fA-F]{32,512}$/;

export async function registerPushRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.put<{ Body: { token?: string; platform?: string } }>('/me/push-devices',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const token = req.body?.token?.trim() ?? '';
      const platform = req.body?.platform;
      if (platform !== 'ios' && platform !== 'android') throw badRequest('Plateforme invalide (ios ou android).');
      if (!token || token.length > 512) throw badRequest('Jeton d’appareil requis.');
      if (platform === 'ios' && !IOS_TOKEN.test(token)) throw badRequest('Jeton APNs invalide (hexadécimal attendu).');

      await db.insertInto('push_devices')
        .values({ token, user_id: req.auth!.userId, platform })
        .onConflict((oc) => oc.column('token').doUpdateSet({
          user_id: req.auth!.userId, platform, last_seen_at: new Date(),
        }))
        .execute();
      return reply.code(204).send();
    });

  app.delete<{ Params: { token: string } }>('/me/push-devices/:token',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const res = await db.deleteFrom('push_devices')
        .where('token', '=', req.params.token)
        .where('user_id', '=', req.auth!.userId)
        .executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound('Appareil inconnu pour ce compte.');
      return reply.code(204).send();
    });
}
