import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import type { Guards } from '../../auth/guards.js';
import { sweepMatchReminders } from './reminders.js';
import { algiersDateOf } from '../../lib/algiers.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';

interface Deps { db: Db; guards: Guards; }

/* Lecture + marquer-lu (Lot 3B, étape 2) — le seul point d'écriture qui
   existait avant ce fichier (../../notifications/write.ts) est interne,
   déclenché par les autres modules à la création d'une notification ; rien
   ne permettait à un client de relire les siennes. Gap identifié et chiffré
   dans docs/LOT3A_AUDIT_COMPATIBILITE_API.md §8.2 : la table `notifications`
   (schéma gelé) avait déjà toutes les colonnes nécessaires, il ne manquait
   que ce module de routes — aucune migration ici. */
export async function registerNotificationRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Pagination par curseur (mise à l'échelle L3, 25/09/2026 — contrat : lib/cursor.ts) : `?limit=&cursor=`, `limit`
     absent = 100, l'ancien plafond ; réponse = les mêmes `notifications` plus `nextCursor`. Tri : plus récentes d'abord,
     départagées par id. */
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/me/notifications',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const limit = pageLimit(req.query.limit, { def: 100, max: 100 });
    const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
    // Lot P1, point 6 : rappels H-2 produits paresseusement au moment de la
    // lecture (voir reminders.ts) — AVANT de lire, pour que le rappel tout
    // juste créé fasse partie de la réponse. Sur la PREMIÈRE page seulement : faire défiler les suivantes ne doit
    // jamais déclencher d'écriture (transaction + verrou par joueur à chaque page).
    if (!cursor) await sweepMatchReminders(db, req.auth!.userId, Date.now());
    let query = db.selectFrom('notifications').leftJoin('users as actor', 'actor.id', 'notifications.actor_id').selectAll('notifications')
      .select('actor.name as actor_name')
      .select(isoMicros(sql.ref('notifications.created_at')).as('created_at_cursor'))
      .where('notifications.user_id', '=', req.auth!.userId)
      .orderBy('notifications.created_at', 'desc').orderBy('notifications.id', 'desc')
      .limit(limit + 1);
    if (cursor) query = query.where(sql<boolean>`(notifications.created_at, notifications.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
    const page = pageOf(await query.execute(), limit, (r) => [r.created_at_cursor, r.id]);
    return reply.send({
      nextCursor: page.nextCursor,
      notifications: page.items.map((r) => ({
        id: r.id,
        userId: r.user_id,
        type: r.type,
        refId: r.ref_id ?? undefined,
        createdAt: r.created_at.getTime(),
        readAt: r.read_at !== null ? r.read_at.getTime() : undefined,
        // Lot 11 : qui a fait l'action (« Karim a rejoint ton match ») — absent pour une notification sans acteur.
        actorId: r.actor_id ?? undefined,
        actorName: r.actor_name ?? undefined,
      })),
    });
  });

  /* « Réglages » des notifications (règle 38, Lot 11) : EXACTEMENT trois interrupteurs — une place se libère dans ta ville, le rappel avant tes matchs, les bons plans des centres.
     Le troisième est `profiles.promo_opt_in`, le MÊME réglage que l'accord « bons plans » de « Mes accords » (règle 30) : jamais deux colonnes qui pourraient se contredire.
     Tout le reste (confirmation, annulation, joueur qui arrive ou part, centre qui réserve à ton numéro) part toujours — aucun interrupteur. Un compte sans profil : tout allumé sauf les bons plans. */
  app.get('/me/notification-settings', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const p = await db.selectFrom('profiles').select(['notify_spot_city', 'notify_reminder', 'promo_opt_in']).where('user_id', '=', req.auth!.userId).executeTakeFirst();
    return reply.send({ spotInCity: p?.notify_spot_city ?? true, reminder: p?.notify_reminder ?? true, promos: p?.promo_opt_in ?? false });
  });

  app.patch<{ Body: { spotInCity?: unknown; reminder?: unknown; promos?: unknown } }>('/me/notification-settings',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const body = req.body ?? {};
      const fields: { notify_spot_city?: boolean; notify_reminder?: boolean; promo_opt_in?: boolean } = {};
      for (const [key, col] of [['spotInCity', 'notify_spot_city'], ['reminder', 'notify_reminder'], ['promos', 'promo_opt_in']] as const) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== 'boolean') throw badRequest(`${key} attendu : vrai ou faux.`);
        fields[col] = body[key] as boolean;
      }
      if (Object.keys(fields).length === 0) throw badRequest('Aucun réglage à changer.');
      await db.insertInto('profiles')
        .values({ user_id: req.auth!.userId, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], ...fields })
        .onConflict((oc) => oc.column('user_id').doUpdateSet(fields)).execute();
      const p = await db.selectFrom('profiles').select(['notify_spot_city', 'notify_reminder', 'promo_opt_in']).where('user_id', '=', req.auth!.userId).executeTakeFirstOrThrow();
      return reply.send({ spotInCity: p.notify_spot_city, reminder: p.notify_reminder, promos: p.promo_opt_in });
    });

  /* « Préviens-moi si ça se libère » (règle 9, MODIFIÉE) — sur un match COMPLET, jusqu'à H-1 : le joueur est prévenu (push + dans l'app, jamais de SMS) quand une place se libère,
     premier arrivé premier servi. L'alerte se consomme à l'envoi ; elle disparaît aussi quand le joueur s'inscrit. Un match privé, annulé, joué ou déjà verrouillé : refusé. */
  async function loadWatchable(matchId: string, userId: string) {
    const m = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirst();
    if (!m) throw notFound('Match introuvable.');
    return { m, joined: await db.selectFrom('match_players').select('user_id').where('match_id', '=', matchId).where('user_id', '=', userId).where('status', '=', 'JOINED').executeTakeFirst() };
  }

  app.get<{ Params: { id: string } }>('/matches/:id/watch', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const row = await db.selectFrom('match_watchers').select('user_id').where('match_id', '=', req.params.id).where('user_id', '=', req.auth!.userId).executeTakeFirst();
    return reply.send({ watching: row !== undefined });
  });

  app.put<{ Params: { id: string } }>('/matches/:id/watch', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const { m, joined } = await loadWatchable(req.params.id, req.auth!.userId);
    if (m.visibility === 'PRIVATE') throw new ApiError(403, 'FORBIDDEN', 'Ce match est privé.');
    if (m.status === 'CANCELLED' || m.status === 'PLAYED' || m.status === 'LOCKED') throw new ApiError(409, 'MATCH_CLOSED', 'Ce match n’accepte plus d’inscription.');
    if (joined) throw new ApiError(409, 'ALREADY_JOINED', 'Tu es déjà inscrit à ce match.');
    if (m.status !== 'FULL') throw new ApiError(409, 'NOT_FULL', 'Ce match a encore de la place : rejoins-le.');
    await db.insertInto('match_watchers').values({ match_id: m.id, user_id: req.auth!.userId }).onConflict((oc) => oc.doNothing()).execute();
    return reply.send({ watching: true });
  });

  app.delete<{ Params: { id: string } }>('/matches/:id/watch', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    await db.deleteFrom('match_watchers').where('match_id', '=', req.params.id).where('user_id', '=', req.auth!.userId).execute();
    return reply.send({ watching: false });
  });

  /* « M'alerter si un match est créé » (Explorer, un jour sans match) : une alerte par (jour d'Alger, sport facultatif) ; au plus 10 en cours par joueur ; consommée quand un match OUVERT
     est créé ce jour-là (notifyDayAlerts). Un jour passé ou à plus de 60 jours : refusé. */
  const DAY_ALERTS_MAX = 10;
  function parseDayAlert(body: { day?: unknown; sport?: unknown } | undefined, now: number): { day: string; sport: 'FOOTBALL' | 'PADEL' | null } {
    const day = typeof body?.day === 'string' ? body.day : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw badRequest('Jour attendu au format AAAA-MM-JJ.', 'BAD_DAY');
    if (day < algiersDateOf(now) || day > algiersDateOf(now + 60 * 86_400_000)) throw badRequest('Choisis un jour des 60 prochains jours.', 'BAD_DAY');
    const sport = body?.sport === undefined || body.sport === null ? null : body.sport;
    if (sport !== null && sport !== 'FOOTBALL' && sport !== 'PADEL') throw badRequest('Sport inconnu.', 'BAD_SPORT');
    return { day, sport };
  }

  app.get<{ Querystring: { day?: string } }>('/me/day-alerts', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    let q = db.selectFrom('day_alerts').select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), 'sport']).where('user_id', '=', req.auth!.userId).where('day', '>=', algiersDateOf(Date.now()) as never).orderBy('day');
    if (req.query.day !== undefined) q = q.where('day', '=', req.query.day as never);
    const rows = await q.execute();
    return reply.send({ alerts: rows.map((r) => ({ day: r.day, sport: r.sport })) });
  });

  app.put<{ Body: { day?: unknown; sport?: unknown } }>('/me/day-alerts', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const { day, sport } = parseDayAlert(req.body, Date.now());
    const mine = await db.selectFrom('day_alerts').select('id').where('user_id', '=', req.auth!.userId).where('day', '>=', algiersDateOf(Date.now()) as never).execute();
    if (mine.length >= DAY_ALERTS_MAX) throw new ApiError(409, 'TOO_MANY_ALERTS', 'Tu as déjà 10 alertes en cours : attends qu’une se déclenche, ou retire-en une.');
    await db.insertInto('day_alerts').values({ user_id: req.auth!.userId, day: day as never, sport }).onConflict((oc) => oc.doNothing()).execute();
    return reply.send({ day, sport, active: true });
  });

  app.delete<{ Body: { day?: unknown; sport?: unknown } }>('/me/day-alerts', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const { day, sport } = parseDayAlert(req.body, Date.now());
    let q = db.deleteFrom('day_alerts').where('user_id', '=', req.auth!.userId).where('day', '=', day as never);
    q = sport === null ? q.where('sport', 'is', null) : q.where('sport', '=', sport);
    await q.execute();
    return reply.send({ day, sport, active: false });
  });

  /* `ids` omis ou vide : tout marquer lu (« Tout lire ») — même contrat que
     markRead(core), qui accepte déjà une liste d'ids optionnelle pour la
     même distinction. Toujours borné à l'appelant (where user_id), jamais
     un id d'autrui à marquer lu même si l'id est deviné. */
  app.post<{ Body: { ids?: string[] } }>('/me/notifications/read',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const ids = req.body?.ids;
      let q = db.updateTable('notifications').set({ read_at: new Date() })
        .where('user_id', '=', req.auth!.userId)
        .where('read_at', 'is', null);
      if (ids !== undefined && ids.length > 0) q = q.where('id', 'in', ids);
      await q.execute();
      return reply.send({ ok: true });
    });
}
