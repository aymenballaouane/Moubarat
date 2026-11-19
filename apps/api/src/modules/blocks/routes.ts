import type { FastifyInstance } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { ApiError, badRequest } from '../../lib/http.js';

/* Lot B, phase 4 (18/11/2026, GO d'Aymen ; maquettes 3_Bloquer) — bloquer un joueur. Effets, tous appliqués ICI (serveur) :
   - celui qui bloque ne voit plus les matchs organisés par le joueur bloqué (fil, accueil, Jouer, recherche : `feedBlockCondition`) ;
   - le joueur bloqué ne peut plus rejoindre les matchs de celui qui bloque : ils sortent de ses listes, et par un lien il reçoit
     « Ce match n'est plus disponible. » (`assertNotBlockedFrom`) ;
   - personne n'est prévenu ; les inscriptions déjà faites ne changent pas (un inscrit garde l'accès à SON match).
   Le blocage se lève dans Profil › Confidentialité › Joueurs bloqués. */

export const MATCH_UNAVAILABLE = 'MATCH_UNAVAILABLE';
export function matchUnavailable(): ApiError {
  return new ApiError(404, MATCH_UNAVAILABLE, 'Ce match n’est plus disponible.');
}

/** Condition du fil pour `viewerId` : ni les matchs de ceux qu'il a bloqués, ni ceux de ceux qui l'ont bloqué. */
export function feedBlockCondition(viewerId: string): RawBuilder<boolean> {
  return sql<boolean>`matches.organizer_id NOT IN (
    SELECT blocked_id FROM user_blocks WHERE blocker_id = ${viewerId}::uuid
    UNION ALL SELECT blocker_id FROM user_blocks WHERE blocked_id = ${viewerId}::uuid)`;
}

/** Le joueur `viewerId` a-t-il été bloqué par l'organisateur `organizerId` ? */
export async function isBlockedBy(db: Db, organizerId: string, viewerId: string): Promise<boolean> {
  if (organizerId === viewerId) return false;
  const row = await db.selectFrom('user_blocks').select('blocker_id')
    .where('blocker_id', '=', organizerId).where('blocked_id', '=', viewerId).executeTakeFirst();
  return row !== undefined;
}

/** Refuse l'accès au match d'un organisateur qui a bloqué `viewerId` — sauf s'il y est déjà inscrit (rien ne change pour lui). */
export async function assertNotBlockedFrom(db: Db, match: { id: string; organizer_id: string }, viewerId: string | undefined): Promise<void> {
  if (!viewerId || !(await isBlockedBy(db, match.organizer_id, viewerId))) return;
  const joined = await db.selectFrom('match_players').select('user_id')
    .where('match_id', '=', match.id).where('user_id', '=', viewerId).where('status', '=', 'JOINED').executeTakeFirst();
  if (!joined) throw matchUnavailable();
}

export async function registerBlockRoutes(app: FastifyInstance, deps: { db: Db; guards: Guards }): Promise<void> {
  const { db, guards } = deps;

  app.get('/me/blocks', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const rows = await db.selectFrom('user_blocks')
      .innerJoin('users', 'users.id', 'user_blocks.blocked_id')
      .leftJoin('profiles', 'profiles.user_id', 'users.id')
      .select(['users.id as userId', 'users.name as pseudo', 'profiles.first_name as firstName', 'user_blocks.created_at as blockedAt'])
      .where('user_blocks.blocker_id', '=', req.auth!.userId)
      .orderBy('user_blocks.created_at', 'desc').execute();
    return reply.send({ blocked: rows.map((r) => ({ userId: r.userId, name: r.firstName?.trim() || r.pseudo, blockedAt: r.blockedAt.getTime() })) });
  });

  app.post<{ Body: { userId?: unknown } }>('/me/blocks', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw badRequest('Joueur inconnu.');
    if (userId === req.auth!.userId) throw badRequest('Tu ne peux pas te bloquer toi-même.', 'BLOCK_SELF');
    const target = await db.selectFrom('users').select('id').where('id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'Joueur inconnu.');
    await db.insertInto('user_blocks').values({ blocker_id: req.auth!.userId, blocked_id: userId })
      .onConflict((oc) => oc.columns(['blocker_id', 'blocked_id']).doNothing()).execute();
    return reply.code(204).send();
  });

  app.delete<{ Params: { userId: string } }>('/me/blocks/:userId', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) throw badRequest('Joueur inconnu.');
    await db.deleteFrom('user_blocks').where('blocker_id', '=', req.auth!.userId).where('blocked_id', '=', req.params.userId).execute();
    return reply.code(204).send();
  });
}
