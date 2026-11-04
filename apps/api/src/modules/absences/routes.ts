import type { FastifyInstance } from 'fastify';
import { canDeclareAbsence } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { must, notFound } from '../../lib/http.js';
import { loadMatchForUpdate, loadPlayers, rowToMatch, rowToMatchPlayer } from '../matches/service.js';
import { recordAbsence } from './service.js';

/* Règle 25 (MODIFIÉE, précisions d'Aymen du 26/10/2026) — DÉCLARER une absence. Deux auteurs possibles, jamais le joueur lui-même :
   - l'ORGANISATEUR, après la fin du match (il ne peut pas se déclarer lui-même) ;
   - le CENTRE, dans le CRM, dès le coup d'envoi (un match de SON centre seulement).
   Qui est absent, quand, et le « jamais un joueur retiré » : le core (`canDeclareAbsence`). Une absence ne compte qu'une fois par match, même si les deux la déclarent (`recordAbsence` :
   la seconde est ignorée, `recorded: false`). Un absent n'est pas prévenu ici : c'est la restriction (7 j / 30 j / blocage) qu'il rencontre à sa prochaine tentative. */

interface Deps { db: Db; guards: Guards; platformGuards: PlatformGuards }

export async function registerAbsenceRoutes(app: FastifyInstance, { db, guards, platformGuards }: Deps): Promise<void> {

  app.post<{ Params: { id: string; userId: string } }>('/matches/:id/players/:userId/absence',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const out = await db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        must(canDeclareAbsence({ match: rowToMatch(row), players, targetId: req.params.userId, declarerId: req.auth!.userId, byCenter: false, now }));
        return recordAbsence(trx, { userId: req.params.userId, kind: 'FULL', source: 'ORGANIZER', matchId: row.id, declaredBy: req.auth!.userId, now });
      });
      return reply.send({ recorded: out.recorded, restricted: out.restriction !== null });
    });

  app.post<{ Params: { venueId: string; matchId: string; userId: string } }>('/venues/:venueId/matches/:matchId/players/:userId/absence',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await platformGuards.requireCenterAction(req, req.params.venueId, 'SET_CASH_STATUS');
      const now = Date.now();
      const out = await db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.matchId);
        if (row.venue_id !== req.params.venueId) throw notFound('Match introuvable.');   // un centre ne touche jamais le match d'un autre
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        must(canDeclareAbsence({ match: rowToMatch(row), players, targetId: req.params.userId, declarerId: req.platformAuth!.accountId, byCenter: true, now }));
        const recorded = await recordAbsence(trx, {
          userId: req.params.userId, kind: 'FULL', source: 'CENTER', matchId: row.id, declaredBy: req.platformAuth!.accountId, now,
        });
        if (recorded.recorded) {
          const user = await trx.selectFrom('users').select('name').where('id', '=', req.params.userId).executeTakeFirst();
          await writeAudit(trx, {
            venueId: row.venue_id, actorId: req.platformAuth!.accountId, actorRole: role,
            action: 'PLAYER_ABSENCE_DECLARED', objectType: 'match', objectId: row.id,
            summary: `a déclaré ${user?.name ?? 'un joueur'} absent du match « ${row.title} »`,
          });
        }
        return recorded;
      });
      return reply.send({ recorded: out.recorded, restricted: out.restriction !== null });
    });
}
