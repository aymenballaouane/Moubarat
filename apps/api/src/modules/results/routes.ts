import type { FastifyInstance } from 'fastify';
import { activePlayers, canRate, confirmResult, disputeResult, submitResult, RECIPIENTS, type Rating } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { writeNotifications } from '../../notifications/write.js';
import { withCommittedPush } from '../../notifications/push.js';
import { loadMatchForUpdate, loadMatch, loadPlayers, myPlayedMatchIds, rowToMatch, rowToMatchPlayer, syncMatchLifecycle } from '../matches/service.js';
import {
  PLAYER_RATING_MIN_COUNT, computeOvrForUser, loadResult, loadResultForUpdate, publicResult,
  ratingSummaryFor, rowToMatchResult, rowToRating, syncResultLifecycle,
} from './service.js';

interface Deps { db: Db; guards: Guards; }

const RATING_TARGETS = ['PLAYER', 'VENUE', 'MATCH'] as const;

async function isJoinedPlayer(db: Db, matchId: string, userId: string): Promise<boolean> {
  const row = await db.selectFrom('match_players').select('user_id')
    .where('match_id', '=', matchId).where('user_id', '=', userId).where('status', '=', 'JOINED')
    .executeTakeFirst();
  return row !== undefined;
}

export async function registerResultRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Saisie — organisateur seul (core `submitResult`), match verrouillé ou
     terminé. Le passage LOCKED/PLAYED est appliqué paresseusement au point
     de contact (`syncMatchLifecycle`) — sans lui, aucun match ne devient
     jamais saisissable, faute de tâche planifiée (voir docs/DECISIONS.md). */
  app.post<{ Params: { id: string }; Body: { homeScore?: number; awayScore?: number } }>(
    '/matches/:id/result', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const homeScore = Number(req.body?.homeScore);
      const awayScore = Number(req.body?.awayScore);
      if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
        throw badRequest('Le score de chaque équipe est un entier positif.', 'INVALID_TARGET');
      }
      const now = Date.now();
      // Correctif (05/09/2026, relecture Aymen) : voir withCommittedPush,
      // notifications/push.ts.
      const created = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await syncMatchLifecycle(trx, await loadMatchForUpdate(trx, req.params.id), now);
        // Le core ne vérifie pas lui-même « un résultat existe-t-il déjà »
        // (submitResult ne connaît pas match_results — délégué à l'appelant,
        // comme ailleurs dans ce package). match_results.match_id est la clé
        // primaire : sans ce contrôle explicite, une seconde soumission
        // violerait la contrainte (23505, non couvert par le filet 22P02) →
        // 500 opaque au lieu d'un refus propre. Trouvé en écrivant les tests.
        if (await loadResult(trx, row.id)) {
          throw badRequest('Un résultat a déjà été saisi pour ce match.', 'RESULT_ALREADY_SUBMITTED');
        }
        const result = submitResult({ match: rowToMatch(row), reporterId: req.auth!.userId, homeScore, awayScore, now });
        must(result.result);
        const mr = result.matchResult!;
        const inserted = await trx.insertInto('match_results').values({
          match_id: mr.matchId, home_score: mr.homeScore, away_score: mr.awayScore,
          reported_by: mr.reportedBy, reported_at: new Date(mr.reportedAt), status: mr.status,
        }).returningAll().executeTakeFirstOrThrow();
        // Lot P1 (03/09/2026), point 4 : RESULT_TO_CONFIRM à « l'autre partie »
        // — même mécanisme que MATCH_CANCELLED (matches/routes.ts). Le core
        // (RECIPIENTS.resultToConfirm) ne connaît qu'UN adversaire (modèle
        // défi, deux capitaines) ; sur un roster libre, quiconque peut
        // confirmer (canConfirmResult : tout inscrit ≠ rapporteur) doit être
        // prévenu — tous les inscrits sauf le rapporteur, jamais lui-même.
        const joined = activePlayers((await loadPlayers(trx, row.id)).map(rowToMatchPlayer)).map((p) => p.userId);
        const toConfirm = joined.filter((u) => u !== mr.reportedBy).flatMap((u) => RECIPIENTS.resultToConfirm(u));
        await writeNotifications(trx, toConfirm, 'RESULT_TO_CONFIRM', row.id, now);
        return inserted;
      }));
      return reply.code(201).send({ result: publicResult(created) });
    });

  /* Même règle de confidentialité que le match lui-même (Phase 1, revue
     sécurité) : un résultat de match PRIVATE suit la visibilité du match. */
  app.get<{ Params: { id: string } }>('/matches/:id/result',
    { preHandler: (req) => guards.tryAuth(req) }, async (req, reply) => {
      const match = await loadMatch(db, req.params.id);
      if (match.visibility === 'PRIVATE') {
        const allowed = req.auth && (
          req.auth.userId === match.organizer_id || await isJoinedPlayer(db, match.id, req.auth.userId)
        );
        if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Ce match est privé.');
      }
      const row = await loadResult(db, req.params.id);
      if (!row) return reply.send({ result: null });
      const synced = await syncResultLifecycle(db, row, Date.now());
      return reply.send({ result: publicResult(synced) });
    });

  /* Confirmation / contestation — le core ne vérifie que « pas le rapporteur »
     (adversaire faible, gap documenté depuis l'audit initial). Ajout API :
     seul un inscrit du match peut répondre — pas n'importe quel utilisateur. */
  app.post<{ Params: { id: string } }>('/matches/:id/result/confirm',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      // Correctif (05/09/2026) : voir withCommittedPush, notifications/push.ts.
      const updated = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadResultForUpdate(trx, req.params.id);
        if (!row) throw notFound('Aucun résultat saisi pour ce match.');
        if (!(await isJoinedPlayer(trx, req.params.id, req.auth!.userId))) {
          throw new ApiError(403, 'FORBIDDEN', 'Seul un joueur inscrit au match peut confirmer le résultat.');
        }
        const result = confirmResult(rowToMatchResult(row), req.auth!.userId, now);
        must(result.result);
        const mr = result.matchResult!;
        const saved = await trx.updateTable('match_results')
          .set({ status: mr.status, confirmed_by: mr.confirmedBy ?? null, confirmed_at: mr.confirmedAt ? new Date(mr.confirmedAt) : null })
          .where('match_id', '=', req.params.id).returningAll().executeTakeFirstOrThrow();
        // Lot P1, point 4 : RESULT_CONFIRMED à celui qui a saisi (core
        // RECIPIENTS.resultConfirmed) — jamais au confirmateur lui-même.
        await writeNotifications(trx, RECIPIENTS.resultConfirmed(mr.reportedBy), 'RESULT_CONFIRMED', req.params.id, now);
        return saved;
      }));
      return reply.send({ result: publicResult(updated) });
    });

  app.post<{ Params: { id: string } }>('/matches/:id/result/dispute',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const updated = await db.transaction().execute(async (trx) => {
        const row = await loadResultForUpdate(trx, req.params.id);
        if (!row) throw notFound('Aucun résultat saisi pour ce match.');
        if (!(await isJoinedPlayer(trx, req.params.id, req.auth!.userId))) {
          throw new ApiError(403, 'FORBIDDEN', 'Seul un joueur inscrit au match peut contester le résultat.');
        }
        const result = disputeResult(rowToMatchResult(row), req.auth!.userId);
        must(result.result);
        return trx.updateTable('match_results').set({ status: result.matchResult!.status })
          .where('match_id', '=', req.params.id).returningAll().executeTakeFirstOrThrow();
      });
      return reply.send({ result: publicResult(updated) });
    });

  /* Notation — joueur, terrain ou match, dans les 72 h suivant le coup
     d'envoi. `applyRating` (core) remplace la note existante dans la
     fenêtre : traduit en upsert sur la contrainte d'unicité de la base. */
  app.post<{
    Params: { id: string };
    Body: { targetType?: string; targetId?: string; stars?: number; comment?: string };
  }>('/matches/:id/ratings', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const targetType = String(req.body?.targetType ?? '');
    if (!(RATING_TARGETS as readonly string[]).includes(targetType)) {
      throw badRequest('targetType invalide : PLAYER, VENUE ou MATCH.');
    }
    const targetId = String(req.body?.targetId ?? '');
    if (!targetId) throw badRequest('targetId manquant.');
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw badRequest('stars doit être un entier entre 1 et 5.');
    const comment = req.body?.comment !== undefined ? String(req.body.comment).trim() || undefined : undefined;
    const now = Date.now();

    const saved = await db.transaction().execute(async (trx) => {
      const row = await syncMatchLifecycle(trx, await loadMatchForUpdate(trx, req.params.id), now);
      const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
      must(canRate({
        match: rowToMatch(row), players, raterId: req.auth!.userId,
        targetType: targetType as Rating['targetType'], targetId, now,
      }));
      return trx.insertInto('ratings').values({
        rater_id: req.auth!.userId, target_type: targetType as Rating['targetType'], target_id: targetId,
        match_id: row.id, stars, comment: comment ?? null,
      }).onConflict((oc) => oc.columns(['rater_id', 'target_type', 'target_id', 'match_id'])
        .doUpdateSet({ stars, comment: comment ?? null })).returningAll().executeTakeFirstOrThrow();
    });
    return reply.code(201).send({ rating: rowToRating(saved) });
  });

  /* Lot 3B, étape 3 (mutations) : aucune route de lecture "mes notes données"
     n'existait — la seule façon de savoir si j'ai déjà noté un match précis
     était de ne pas le savoir du tout après un rechargement (POST /ratings
     renvoie bien la note créée, mais rien ne la relit ensuite). Nécessité
     démontrée : sans cette route, une note fraîchement soumise disparaîtrait
     de l'écran au moindre refresh, ce qu'Aymen a explicitement demandé de
     vérifier. Bornée à raterId=appelant + targetType=MATCH : ne relit jamais
     la note d'un tiers (règle R4 du core sur les notes individuelles). */
  app.get<{ Params: { id: string } }>('/matches/:id/my-rating',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const row = await db.selectFrom('ratings').selectAll()
        .where('match_id', '=', req.params.id)
        .where('rater_id', '=', req.auth!.userId)
        .where('target_type', '=', 'MATCH')
        .where('target_id', '=', req.params.id)
        .executeTakeFirst();
      return reply.send({ rating: row ? rowToRating(row) : null });
    });

  app.get('/me/ovr', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    return reply.send(await computeOvrForUser(db, req.auth!.userId));
  });

  /* F3 (cadrage multi-centre/scalabilité, 22/09/2026) : au démarrage, l'app chargeait le résultat ET
     la note de CHAQUE match joué par un aller-retour séparé — un joueur à 50 matchs déclenchait plus
     de 100 requêtes. Un seul appel, borné aux matchs joués de l'appelant (même prédicat que
     /me/matches, myPlayedMatchIds). syncResultLifecycle reste appliqué par résultat (auto-confirmation
     paresseuse à 24 h, canonique) — un aller-retour HTTP en moins, pas une règle métier en moins. */
  app.get('/me/match-results', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const matchIds = await myPlayedMatchIds(db, req.auth!.userId);
    if (matchIds.length === 0) return reply.send({ results: {}, ratings: {} });

    const now = Date.now();
    const resultRows = await db.selectFrom('match_results').selectAll().where('match_id', 'in', matchIds).execute();
    const results: Record<string, unknown> = {};
    for (const row of resultRows) {
      const synced = await syncResultLifecycle(db, row, now);
      results[synced.match_id] = publicResult(synced);
    }

    const ratingRows = await db.selectFrom('ratings').selectAll()
      .where('match_id', 'in', matchIds).where('rater_id', '=', req.auth!.userId).where('target_type', '=', 'MATCH')
      .execute();
    const ratings: Record<string, unknown> = {};
    for (const row of ratingRows) ratings[row.match_id] = rowToRating(row);

    return reply.send({ results, ratings });
  });

  /* Public : l'OVR se lit sur le badge d'un coéquipier dans un roster, sans
     compte nécessaire pour le consulter (aucune donnée personnelle exposée
     au-delà d'un nombre calculé). */
  app.get<{ Params: { id: string } }>('/users/:id/ovr', async (req, reply) => {
    return reply.send(await computeOvrForUser(db, req.params.id));
  });

  /* Moyenne joueur — jamais une note individuelle exposée (règle R4 du core,
     rating.ts), seulement l'agrégat une fois le seuil de visibilité atteint. */
  app.get<{ Params: { id: string } }>('/users/:id/rating', async (req, reply) => {
    const summary = await ratingSummaryFor(db, 'PLAYER', req.params.id);
    return reply.send({ ...summary, minCount: PLAYER_RATING_MIN_COUNT });
  });
}
