import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { ApiError, badRequest, notFound } from '../../lib/http.js';

/* Audit final 26/10/2026 (P1-10, STO-2), GO d'Aymen 27/10/2026 — « Signaler » un joueur ou un match, envoyé au support Moubarat.
   Exigence des stores (Apple 1.2, Google) : l'app expose des noms libres, un « mot aux joueurs » et un lien de groupe WhatsApp.
   - Côté JOUEUR : `POST /reports` (compte requis). Ni soi-même, ni une cible inexistante ou supprimée (404 indiscernable). Un seul
     signalement OUVERT par (signalant, cible) : le renvoyer répond 200 `duplicate: true` sans rien créer. Plafond `REPORT_MAX_PER_HOUR`
     par signalant (anti-spam), 429 au-delà.
   - Côté CONSOLE (superadmin seul) : liste, compteur des ouverts, « marquer traité ». Le support y voit le nom ET le numéro du signalant
     (pour le recontacter) — jamais exposé à un joueur. Aucune action automatique sur la cible : c'est un humain qui décide (suspendre,
     contacter, ne rien faire), avec les outils existants de la console. */

interface Deps { db: Db; guards: Guards; platformGuards: PlatformGuards }

export const REPORT_REASONS = ['INAPPROPRIATE', 'HARASSMENT', 'FAKE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_MAX_PER_HOUR = 10;
export const REPORT_NOTE_MAX = 500;

export async function registerReportRoutes(app: FastifyInstance, { db, guards, platformGuards }: Deps): Promise<void> {

  app.post<{ Body: { targetType?: string; targetId?: string; reason?: string; note?: string } }>('/reports',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const userId = req.auth!.userId;
      const targetType = String(req.body?.targetType ?? '');
      const targetId = String(req.body?.targetId ?? '');
      const reason = String(req.body?.reason ?? '') as ReportReason;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (targetType !== 'PLAYER' && targetType !== 'MATCH') throw badRequest('Cible invalide : PLAYER ou MATCH.', 'REPORT_INVALID');
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) throw notFound('Introuvable.');
      if (!REPORT_REASONS.includes(reason)) throw badRequest('Motif invalide.', 'REPORT_INVALID');
      if (note.length > REPORT_NOTE_MAX) throw badRequest(`Ton message est trop long (${REPORT_NOTE_MAX} signes au plus).`, 'REPORT_INVALID');
      if (reason === 'OTHER' && note.length < 3) throw badRequest('Explique en quelques mots ce qui ne va pas.', 'REPORT_NOTE_REQUIRED');

      const outcome = await db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${'report:' + userId}))`.execute(trx);
        if (targetType === 'PLAYER') {
          if (targetId === userId) throw badRequest('Tu ne peux pas te signaler toi-même.', 'REPORT_SELF');
          const target = await trx.selectFrom('users').select('id').where('id', '=', targetId).where('deleted_at', 'is', null).executeTakeFirst();
          if (!target) throw notFound('Joueur introuvable.');
        } else {
          const match = await trx.selectFrom('matches').select('id').where('id', '=', targetId).executeTakeFirst();
          if (!match) throw notFound('Match introuvable.');
        }
        const existing = await trx.selectFrom('reports').select('id')
          .where('reporter_id', '=', userId).where('target_type', '=', targetType).where('status', '=', 'OPEN')
          .where(targetType === 'PLAYER' ? 'target_user_id' : 'target_match_id', '=', targetId).executeTakeFirst();
        if (existing) return { duplicate: true };
        const recent = await trx.selectFrom('reports').select(trx.fn.countAll<string>().as('n'))
          .where('reporter_id', '=', userId).where('created_at', '>', new Date(Date.now() - 3_600_000)).executeTakeFirstOrThrow();
        if (Number(recent.n) >= REPORT_MAX_PER_HOUR) {
          throw new ApiError(429, 'RATE_LIMITED', 'Trop de signalements en peu de temps. Réessaie plus tard.');
        }
        await trx.insertInto('reports').values({
          reporter_id: userId, target_type: targetType, reason, note: note === '' ? null : note,
          target_user_id: targetType === 'PLAYER' ? targetId : null,
          target_match_id: targetType === 'MATCH' ? targetId : null,
        }).execute();
        return { duplicate: false };
      });
      return reply.send({ ok: true, duplicate: outcome.duplicate });
    });

  app.get<{ Querystring: { status?: string } }>('/platform/reports',
    { preHandler: (req) => platformGuards.requireSuperadmin(req) }, async (req, reply) => {
      const status = req.query.status === 'HANDLED' ? 'HANDLED' : 'OPEN';
      const rows = await db.selectFrom('reports')
        .innerJoin('users as reporter', 'reporter.id', 'reports.reporter_id')
        .leftJoin('users as tu', 'tu.id', 'reports.target_user_id')
        .leftJoin('matches as tm', 'tm.id', 'reports.target_match_id')
        .leftJoin('venues as tv', 'tv.id', 'tm.venue_id')
        .select([
          'reports.id as id', 'reports.target_type as target_type', 'reports.reason as reason', 'reports.note as note', 'reports.status as status',
          'reports.created_at as created_at', 'reports.handled_at as handled_at',
          'reporter.id as reporter_id', 'reporter.name as reporter_name', 'reporter.phone as reporter_phone',
          'tu.id as target_user_id', 'tu.name as target_user_name', 'tu.status as target_user_status',
          'tm.id as target_match_id', 'tm.title as target_match_title', 'tv.name as target_venue_name',
        ])
        .where('reports.status', '=', status)
        .orderBy('reports.created_at', status === 'OPEN' ? 'asc' : 'desc')
        .limit(200)
        .execute();
      return reply.send({
        reports: rows.map((r) => ({
          id: r.id, targetType: r.target_type, reason: r.reason, note: r.note, status: r.status,
          createdAt: r.created_at, handledAt: r.handled_at,
          reporter: { id: r.reporter_id, name: r.reporter_name, phone: r.reporter_phone },
          target: r.target_type === 'PLAYER'
            ? { type: 'PLAYER' as const, id: r.target_user_id, name: r.target_user_name, status: r.target_user_status }
            : { type: 'MATCH' as const, id: r.target_match_id, title: r.target_match_title, venueName: r.target_venue_name },
        })),
      });
    });

  app.get('/platform/reports/count',
    { preHandler: (req) => platformGuards.requireSuperadmin(req) }, async (_req, reply) => {
      const row = await db.selectFrom('reports').select(db.fn.countAll<string>().as('n')).where('status', '=', 'OPEN').executeTakeFirstOrThrow();
      return reply.send({ open: Number(row.n) });
    });

  app.post<{ Params: { id: string } }>('/platform/reports/:id/handle',
    { preHandler: (req) => platformGuards.requireSuperadmin(req) }, async (req, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Signalement introuvable.');
      const res = await db.updateTable('reports')
        .set({ status: 'HANDLED', handled_at: new Date(), handled_by: req.platformAuth!.accountId })
        .where('id', '=', req.params.id).where('status', '=', 'OPEN').executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        const exists = await db.selectFrom('reports').select('id').where('id', '=', req.params.id).executeTakeFirst();
        if (!exists) throw notFound('Signalement introuvable.');
      }
      return reply.send({ ok: true });
    });
}
