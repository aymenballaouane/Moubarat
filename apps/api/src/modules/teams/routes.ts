import type { FastifyInstance } from 'fastify';
import {
  RECIPIENTS, createTeam, invitePlayer, leaveTeam, removeMember,
  respondInvite, transferCaptaincy,
} from '@moubarat/core';
import { sql } from 'kysely';
import { nameKeyOf } from '../../lib/display-name.js';
import { writeNotifications } from '../../notifications/write.js';
import { withCommittedPush } from '../../notifications/push.js';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { checkRateLimit, type RateLimiter } from '../../lib/rate-limit.js';
import {
  loadMembers, loadTeam, loadTeamForUpdate, publicMember, publicTeam, rowToTeamMember,
} from './service.js';

interface Deps { db: Db; guards: Guards; /** Invitations par joueur et par heure (P0-6). Absent (tests, scripts) : aucune limite. */ inviteLimiter?: RateLimiter; }

/** Le vestiaire affiché = actifs + invités en attente. Un membre LEFT reste en
    base (historique jamais effacé, cohérent avec le reste du produit) mais
    ne fait plus partie de l'équipe vue par ses membres. Le numéro de téléphone
    n'est JAMAIS lu ici (25/09/2026, audit P0-6 — décision d'Aymen : aucun joueur
    n'obtient le numéro d'un autre joueur, sans exception) : la colonne n'est même
    pas sélectionnée. */
async function membersWithNames(db: Db, teamId: string) {
  const rows = (await loadMembers(db, teamId)).filter((r) => r.status !== 'LEFT');
  if (rows.length === 0) return [];
  const users = await db.selectFrom('users').select(['id', 'name'])
    .where('id', 'in', rows.map((r) => r.user_id)).execute();
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => publicMember(r, byId.get(r.user_id) ?? '?'));
}

export async function registerTeamRoutes(app: FastifyInstance, { db, guards, inviteLimiter }: Deps): Promise<void> {

  /* Création — le créateur devient capitaine actif d'office (une équipe n'est
     jamais sans capitaine, invariant aussi tenu par l'index unique en base). */
  app.post<{ Body: { name?: string } }>('/teams',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const name = String(req.body?.name ?? '');
      const created = await db.transaction().execute(async (trx) => {
        const result = createTeam('', name, req.auth!.userId, Date.now());
        must(result.result);
        const team = await trx.insertInto('teams')
          .values({ name: result.team!.name, created_by: req.auth!.userId })
          .returningAll().executeTakeFirstOrThrow();
        await trx.insertInto('team_members').values({
          team_id: team.id, user_id: req.auth!.userId, role: 'CAPTAIN', status: 'ACTIVE',
          joined_at: new Date(),
        }).execute();
        return team;
      });
      return reply.code(201).send({ team: publicTeam(created) });
    });

  /* Connexion requise (faille de la revue sécurité : route publique). Les membres sont identifiés par leur NOM
     d'affichage, jamais par un numéro : plus aucun téléphone n'est servi, à personne, membre ou non. */
  app.get<{ Params: { id: string } }>('/teams/:id',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const team = await loadTeam(db, req.params.id);
      const members = await membersWithNames(db, team.id);
      return reply.send({ team: { ...publicTeam(team), members } });
    });

  /* Mes équipes — celles où je suis membre actif. */
  app.get('/me/teams', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const rows = await db.selectFrom('team_members')
      .innerJoin('teams', 'teams.id', 'team_members.team_id')
      .selectAll('teams').select('team_members.role as my_role')
      .where('team_members.user_id', '=', req.auth!.userId)
      .where('team_members.status', '=', 'ACTIVE')
      .execute();
    return reply.send({ teams: rows.map((r) => ({ ...publicTeam(r), myRole: r.my_role })) });
  });

  /* Invitation — le capitaine seul, par NOM D'AFFICHAGE en recherche exacte (décision d'Aymen, 25/09/2026 : le nom
     d'affichage existant sert à chercher et inviter un joueur — vrai nom ou pseudo, au choix du joueur ; jamais un numéro de
     téléphone, jamais un SMS pour cette action). « Exacte » : le nom COMPLET (sans casse ni espaces superflus), jamais un préfixe. */
  app.post<{ Params: { id: string }; Body: { name?: string } }>('/teams/:id/invite',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      /* Audit juridique et technique du 25/09/2026, P0-6 — cette route répondait « Aucun joueur Moubarat avec ce
         numéro » ou rendait l'identité du joueur trouvé AVANT de vérifier que l'appelant était le capitaine : tout
         joueur connecté (créer une équipe suffit) pouvait sonder quels numéros ont un compte, sans limite. Deux
         garde-fous : (1) un plafond par joueur et par heure, compté à CHAQUE appel — refusé ou non ; (2) le rôle de
         l'appelant est vérifié AVANT toute recherche du numéro : un non-capitaine reçoit la même réponse que le
         numéro existe ou non. Un capitaine peut encore savoir si un numéro est inscrit (l'invitation en a besoin),
         dans la limite du plafond. */
      await checkRateLimit(inviteLimiter, req.auth!.userId, 'RATE_LIMITED', 'Trop d’invitations envoyées. Réessayez plus tard.');
      const typed = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (typed.length < 2 || typed.length > 40) throw badRequest('Indiquez le nom d’affichage exact du joueur à inviter.', 'NAME_REQUIRED');
      const invited = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        await loadTeamForUpdate(trx, req.params.id);
        const members = (await loadMembers(trx, req.params.id)).map(rowToTeamMember);
        const isCaptain = members.some((m) => m.userId === req.auth!.userId && m.role === 'CAPTAIN' && m.status === 'ACTIVE');
        // Même code et même statut que la règle du core (`invitePlayer`, NOT_CAPTAIN → 400), jamais un autre message.
        if (!isCaptain) throw new ApiError(400, 'NOT_CAPTAIN', 'Seul le capitaine invite des joueurs.');
        // Recherche EXACTE par la clé de comparaison de la base (`display_name_key` : casse et espaces ignorés — la
        // même fonction que l'index d'unicité, migration 0030). Un nom désigne AU PLUS UN joueur : l'index
        // `users_display_name_uq` couvre exactement les comptes actifs dont le nom n'est pas marqué « à changer »,
        // et ce sont les seuls que cette recherche voit. Un compte supprimé (anonymisé) ou marqué (doublon hérité :
        // l'ancien détenteur du nom est celui qu'on trouve) n'est jamais invitable — même réponse qu'un nom inconnu.
        const target = await trx.selectFrom('users').select(['id', 'name'])
          .where(sql<boolean>`display_name_key(name) = ${nameKeyOf(typed)}`)
          .where('deleted_at', 'is', null).where('name_change_required', '=', false)
          .executeTakeFirst();
        if (!target) throw notFound('Aucun joueur ne porte ce nom.');
        const result = invitePlayer(members, req.params.id, req.auth!.userId, target.id);
        must(result.result);
        // Upsert : le core (`memberOf`) ignore délibérément les membres LEFT —
        // un ancien membre reparti reste réinvitable. Sa ligne (clé composite
        // team_id+user_id) existe déjà en base ; on la réutilise plutôt que
        // de la dupliquer (elle le refuserait).
        await trx.insertInto('team_members').values({
          team_id: req.params.id, user_id: target.id, role: 'PLAYER', status: 'INVITED',
          invited_by: req.auth!.userId,
        }).onConflict((oc) => oc.columns(['team_id', 'user_id']).doUpdateSet({
          role: 'PLAYER', status: 'INVITED', invited_by: req.auth!.userId, joined_at: null,
        })).execute();
        // Notification IN-APP de l'invité (25/09/2026, décision d'Aymen : « in-app uniquement — jamais de SMS pour cette
        // action »). Dans la même transaction que l'invitation : jamais une invitation sans notification, ni l'inverse. Le
        // push automatique est exclu par type (notifications/push.ts, PUSH_POLICY).
        await writeNotifications(trx, RECIPIENTS.teamInvited(target.id), 'TEAM_INVITED', req.params.id, Date.now());
        return target;
      }));
      return reply.code(201).send({ ok: true, invited: { id: invited.id, name: invited.name } });
    });

  /* Réponse — l'invité seul répond, personne d'autre ne peut accepter à sa place. */
  app.post<{ Params: { id: string }; Body: { accept?: boolean } }>('/teams/:id/respond',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const accept = req.body?.accept === true;
      const now = Date.now();
      await db.transaction().execute(async (trx) => {
        await loadTeamForUpdate(trx, req.params.id);
        const members = (await loadMembers(trx, req.params.id)).map(rowToTeamMember);
        const result = respondInvite(members, req.params.id, req.auth!.userId, accept, now);
        must(result.result);
        if (accept) {
          await trx.updateTable('team_members').set({ status: 'ACTIVE', joined_at: new Date(now) })
            .where('team_id', '=', req.params.id).where('user_id', '=', req.auth!.userId)
            .where('status', '=', 'INVITED').execute();
        } else {
          await trx.deleteFrom('team_members')
            .where('team_id', '=', req.params.id).where('user_id', '=', req.auth!.userId)
            .where('status', '=', 'INVITED').execute();
        }
      });
      return reply.send({ ok: true, status: accept ? 'ACTIVE' : 'REFUSED' });
    });

  /* Départ — le capitaine ne part pas sans transmettre le brassard d'abord. */
  app.post<{ Params: { id: string } }>('/teams/:id/leave',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      await db.transaction().execute(async (trx) => {
        await loadTeamForUpdate(trx, req.params.id);
        const members = (await loadMembers(trx, req.params.id)).map(rowToTeamMember);
        const result = leaveTeam(members, req.params.id, req.auth!.userId);
        must(result.result);
        await trx.updateTable('team_members').set({ status: 'LEFT' })
          .where('team_id', '=', req.params.id).where('user_id', '=', req.auth!.userId).execute();
      });
      return reply.send({ ok: true });
    });

  /* Retrait — le capitaine seul, jamais lui-même. Une invitation en attente
     s'annule (suppression) ; un membre actif part (LEFT), historique conservé. */
  app.post<{ Params: { id: string; userId: string } }>('/teams/:id/members/:userId/remove',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      await db.transaction().execute(async (trx) => {
        await loadTeamForUpdate(trx, req.params.id);
        const rows = await loadMembers(trx, req.params.id);
        const members = rows.map(rowToTeamMember);
        const result = removeMember(members, req.params.id, req.auth!.userId, req.params.userId);
        must(result.result);
        const target = rows.find((r) => r.user_id === req.params.userId)!;
        if (target.status === 'INVITED') {
          await trx.deleteFrom('team_members')
            .where('team_id', '=', req.params.id).where('user_id', '=', req.params.userId).execute();
        } else {
          await trx.updateTable('team_members').set({ status: 'LEFT' })
            .where('team_id', '=', req.params.id).where('user_id', '=', req.params.userId).execute();
        }
      });
      return reply.send({ ok: true });
    });

  /* Transfert du brassard — l'invariant « un seul capitaine » tient par la
     base (index unique partiel) ET par ce verrou d'agrégat. */
  app.post<{ Params: { id: string }; Body: { targetUserId?: string } }>('/teams/:id/transfer-captaincy',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const targetUserId = String(req.body?.targetUserId ?? '');
      await db.transaction().execute(async (trx) => {
        await loadTeamForUpdate(trx, req.params.id);
        const members = (await loadMembers(trx, req.params.id)).map(rowToTeamMember);
        const result = transferCaptaincy(members, req.params.id, req.auth!.userId, targetUserId);
        must(result.result);
        await trx.updateTable('team_members').set({ role: 'PLAYER' })
          .where('team_id', '=', req.params.id).where('user_id', '=', req.auth!.userId).execute();
        await trx.updateTable('team_members').set({ role: 'CAPTAIN' })
          .where('team_id', '=', req.params.id).where('user_id', '=', targetUserId).execute();
      });
      return reply.send({ ok: true });
    });
}
