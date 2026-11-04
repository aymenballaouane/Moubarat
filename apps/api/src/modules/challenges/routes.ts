import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  FORMAT_CAPACITY, MIN, RECIPIENTS, acceptChallenge, challengeMatchTitle, canRespond, cancelChallenge,
  canSendChallenge, newChallenge, rejectChallenge, validateCapacity,
  type Field, type MatchFormat, type Sport, type TeamMember,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { writeNotifications } from '../../notifications/write.js';
import { withCommittedPush } from '../../notifications/push.js';
import { algiersDateOf, dayStartMs } from '../../lib/algiers.js';
import { toPgRange } from '../../lib/pgrange.js';
import { ApiError, badRequest, must, notFound, toApiError } from '../../lib/http.js';
import { isActiveMember, loadMembers, loadTeamForUpdate, rowToTeamMember } from '../teams/service.js';
import { createBooking, rowToBooking } from '../bookings/service.js';
import {
  activeCaptainOf, loadChallenge, loadChallengeForUpdate, publicChallenge, rowToChallenge,
  type ChallengeRow,
} from './service.js';

interface Deps { db: Db; guards: Guards; }

const SPORTS = ['FOOTBALL', 'PADEL', 'BASKET'] as const;
const STAKE_KINDS = ['AMICAL', 'CLASSEMENT'] as const;

export async function registerChallengeRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Envoi — capitaine émetteur seul. La mise en espèces reste désactivée dans
     le core (STAKE_AMOUNT_ENABLED = false) : cette API ne l'expose même pas.
     Terrain obligatoire (contrairement au type core, où il est optionnel) —
     aligné sur le prototype validé (defi-form) et sur `matches.venue_id`/
     `field_id` NOT NULL : un défi accepté doit toujours produire un match
     insérable, jamais un id vide. */
  app.post<{
    Body: {
      fromTeamId?: string; toTeamId?: string; sport?: string; format?: string;
      date?: string; startMin?: number; durationMin?: number;
      venueId?: string; fieldId?: string; stakeKind?: string; message?: string;
    };
  }>('/challenges', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const fromTeamId = String(b.fromTeamId ?? '');
    const toTeamId = String(b.toTeamId ?? '');
    if (!fromTeamId || !toTeamId) throw badRequest('fromTeamId et toTeamId requis.');
    const sport = String(b.sport ?? '');
    if (!(SPORTS as readonly string[]).includes(sport)) throw badRequest('Sport invalide.');
    const venueId = String(b.venueId ?? '');
    const fieldId = String(b.fieldId ?? '');
    if (!venueId || !fieldId) throw badRequest('venueId et fieldId requis.');
    const stakeKind = String(b.stakeKind ?? 'AMICAL');
    if (!(STAKE_KINDS as readonly string[]).includes(stakeKind)) throw badRequest('Enjeu invalide : AMICAL ou CLASSEMENT.');
    const message = b.message !== undefined ? String(b.message).trim() : undefined;
    if (message && message.length > 200) throw badRequest('Message limité à 200 caractères.');

    let dayStart: number;
    try { dayStart = dayStartMs(String(b.date ?? '')); }
    catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }
    const startMin = Number(b.startMin);
    const durationMin = Number(b.durationMin ?? 90);
    if (!Number.isInteger(startMin) || startMin < 0 || startMin >= 2880) {
      throw badRequest('startMin invalide (minutes depuis minuit, 0–2879).');
    }
    if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 360) {
      throw badRequest('Durée invalide : entre 30 et 360 minutes.', 'HOURS_INVALID');
    }
    const proposedRange = { start: dayStart + startMin * MIN, end: dayStart + (startMin + durationMin) * MIN };

    const now = Date.now();
    // Correctif (05/09/2026, relecture Aymen) : voir withCommittedPush,
    // notifications/push.ts — le push n'attend plus rien de moins que
    // cette transaction réellement validée.
    const created = await withCommittedPush(() => db.transaction().execute(async (trx) => {
      await loadTeamForUpdate(trx, fromTeamId);
      const members = (await loadMembers(trx, fromTeamId)).map(rowToTeamMember);
      must(canSendChallenge({ fromTeamId, toTeamId }, req.auth!.userId, members));

      const toTeam = await trx.selectFrom('teams').select('id').where('id', '=', toTeamId).executeTakeFirst();
      if (!toTeam) throw notFound('Équipe adverse introuvable.');
      const field = await trx.selectFrom('fields').select(['id', 'sport', 'formats', 'venue_id'])
        .where('id', '=', fieldId).executeTakeFirst();
      if (!field || field.venue_id !== venueId) throw badRequest('Terrain introuvable pour ce centre.');
      // Ajout de politique API (le core ne le vérifie nulle part : canSendChallenge
      // est agnostique du terrain) — code dédié, jamais celui du core, pour ne
      // pas laisser un client confondre « mauvais sport » et « mauvais format ».
      if (field.sport !== sport) throw badRequest('Ce terrain ne propose pas ce sport.', 'VENUE_SPORT_MISMATCH');
      const rawFormat = String(b.format ?? '');
      // Canon : même garde que match-flow.ts createMatch (validateCapacity),
      // jamais réencodée à la main. La capacité d'un défi est toujours celle
      // du format (acceptChallenge du core ne prend pas d'autre valeur) —
      // FORMAT_CAPACITY[format] fait aussi valider la borne par la même fonction.
      // Le cast `as Field` mime exactement celui déjà fait par le core lui-même
      // (match-flow.ts createMatch, p.field as Field) sur un Pick<Field,...>
      // identique — validateCapacity ne lit jamais que `formats` en pratique.
      const capacity = FORMAT_CAPACITY[rawFormat as MatchFormat];
      const fieldForValidation: Pick<Field, 'id' | 'sport' | 'formats'> = {
        id: field.id, sport: field.sport, formats: field.formats,
      };
      must(validateCapacity(
        { format: rawFormat as MatchFormat, capacity: capacity ?? 0, fieldId },
        fieldForValidation as Field,
      ));
      const format = rawFormat as MatchFormat;
      const validSport = sport as Sport;

      const challenge = newChallenge({
        id: '', fromTeamId, toTeamId, sport: validSport, format,
        proposedRange, venueId, fieldId, stakeKind: stakeKind as 'AMICAL' | 'CLASSEMENT',
        createdAt: now, ...(message ? { message } : {}),
      });
      const row = await trx.insertInto('challenges').values({
        from_team_id: fromTeamId, to_team_id: toTeamId, sport: validSport, format,
        proposed_range: toPgRange(proposedRange), venue_id: venueId, field_id: fieldId,
        stake_kind: stakeKind as 'AMICAL' | 'CLASSEMENT', message: challenge.message ?? null,
        expires_at: new Date(challenge.expiresAt),
      }).returningAll().executeTakeFirstOrThrow();

      const toCaptainId = await activeCaptainOf(trx, toTeamId);
      if (toCaptainId) {
        await writeNotifications(trx, RECIPIENTS.challengeReceived(toCaptainId), 'CHALLENGE_RECEIVED', row.id, now);
      }
      return row;
    }));

    return reply.code(201).send({ challenge: publicChallenge(created, now) });
  });

  /* Un défi contient un message libre entre capitaines et l'agenda d'une
     équipe tierce — restreint aux membres actifs de l'UNE ou l'AUTRE équipe
     (faille trouvée en revue sécurité : la route était accessible sans
     authentification, sans aucune vérification d'appartenance). */
  app.get<{ Params: { id: string } }>('/challenges/:id',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const row = await loadChallenge(db, req.params.id);
      const concerned = await isActiveMember(db, row.from_team_id, req.auth!.userId)
        || await isActiveMember(db, row.to_team_id, req.auth!.userId);
      if (!concerned) throw new ApiError(403, 'FORBIDDEN', 'Ce défi ne concerne pas votre équipe.');
      return reply.send({ challenge: publicChallenge(row, Date.now()) });
    });

  /* Boîte du capitaine — reçus / envoyés (core `challengeInbox`, appliqué en SQL).
     Même faille et même correctif que ci-dessus : restreint aux membres actifs
     de l'équipe demandée. */
  app.get<{ Querystring: { teamId?: string } }>('/challenges/inbox',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const teamId = String(req.query.teamId ?? '');
      if (!teamId) throw badRequest('teamId manquant.');
      if (!(await isActiveMember(db, teamId, req.auth!.userId))) {
        throw new ApiError(403, 'FORBIDDEN', 'Vous ne faites pas partie de cette équipe.');
      }
      const now = Date.now();
      const [received, sent] = await Promise.all([
        db.selectFrom('challenges').selectAll().where('to_team_id', '=', teamId)
          .orderBy('created_at', 'desc').execute(),
        db.selectFrom('challenges').selectAll().where('from_team_id', '=', teamId)
          .orderBy('created_at', 'desc').execute(),
      ]);
      return reply.send({
        received: received.map((r) => publicChallenge(r, now)),
        sent: sent.map((r) => publicChallenge(r, now)),
      });
    });

  /* Acceptation — capitaine défié seul. Produit le match : organisateur =
     capitaine ÉMETTEUR (décision du core, commentaire de challenge.ts), les
     deux capitaines sont inscrits d'office (comme dans le prototype validé). */
  app.post<{ Params: { id: string } }>('/challenges/:id/accept',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const matchId = randomUUID();
      // Décision + écriture d'expiration paresseuse D'ABORD, jamais de throw à
      // l'intérieur de la transaction avant d'être sûr de ne rien vouloir en
      // garder : lever une erreur dans trx.execute() annule TOUT, y compris
      // le passage EXPIRED qu'on veut justement conserver (même piège que le
      // compteur d'essais OTP en Phase 1 — voir docs/DECISIONS.md).
      // Correctif (05/09/2026) : voir withCommittedPush, notifications/push.ts.
      const outcome = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadChallengeForUpdate(trx, req.params.id);
        // Verrou d'agrégat sur l'équipe défiée : sans lui, un transfert de
        // brassard concurrent sur to_team pourrait committer entre la lecture
        // des membres et la décision canRespond, laissant un ex-capitaine
        // répondre sur un instantané périmé (même risque que documenté dans
        // teams/service.ts pour toute mutation du vestiaire).
        await loadTeamForUpdate(trx, row.to_team_id);
        const members = await loadMembers(trx, row.to_team_id);
        const check = await canRespondOrExpire(trx, row, req.auth!.userId, members.map(rowToTeamMember), now);
        if (!check.ok) return { ok: false as const, error: toApiError(check) };

        const fromCaptainId = await activeCaptainOf(trx, row.from_team_id);
        if (!fromCaptainId) return { ok: false as const, error: notFound('L’équipe émettrice n’a plus de capitaine actif.') };

        const challenge = rowToChallenge(row);
        // Terrain/venue toujours renseignés en pratique (POST /challenges les exige,
        // voir commentaire plus haut) — garde explicite plutôt qu'un `!` silencieux :
        // un défi qui échapperait à cette garantie doit échouer proprement ici, pas
        // produire un match avec un terrain vide.
        if (!challenge.fieldId || !challenge.venueId) {
          return { ok: false as const, error: badRequest('Ce défi n’a pas de terrain associé — acceptation impossible.') };
        }
        const [fromTeamRow, toTeamRow] = await Promise.all([
          trx.selectFrom('teams').select('name').where('id', '=', row.from_team_id).executeTakeFirstOrThrow(),
          trx.selectFrom('teams').select('name').where('id', '=', row.to_team_id).executeTakeFirstOrThrow(),
        ]);
        const title = challengeMatchTitle(fromTeamRow.name, toTeamRow.name);

        // Réservation réelle sur le créneau proposé — mêmes garanties que n'importe
        // quel match (canReserve/isBlocking, via prepareBooking à l'intérieur de
        // createBooking — le même chemin que POST /bookings, jamais une seconde
        // implémentation). Le prix par joueur du match en dérivera, plus de 0 DA figé.
        const dayStart = dayStartMs(algiersDateOf(challenge.proposedRange.start));
        const startMin = Math.round((challenge.proposedRange.start - dayStart) / MIN);
        const durationMin = Math.round((challenge.proposedRange.end - challenge.proposedRange.start) / MIN);
        let createdBooking;
        try {
          createdBooking = await createBooking(trx, {
            fieldId: challenge.fieldId, dayStart, startMin, durationMin,
            source: 'MOUBARAT', byUserId: fromCaptainId, reservationName: title, now,
            // Le défi porte déjà son format (16/09/2026) : la résa le fixe, le match en hérite.
            format: challenge.format,
          });
        } catch (err) {
          if (err instanceof ApiError) return { ok: false as const, error: err };
          throw err;
        }
        const booking = rowToBooking(createdBooking.row);

        const { match } = acceptChallenge(challenge, matchId, booking, title, now);
        await trx.insertInto('matches').values({
          id: matchId, sport: match.sport, format: match.format, level: match.level, title: match.title,
          venue_id: match.venueId, field_id: match.fieldId, time_range: toPgRange(match.range),
          capacity: match.capacity, price_per_player_da: match.pricePerPlayer.amount,
          visibility: match.visibility, status: match.status, organizer_id: fromCaptainId,
          booking_id: booking.id, challenge_id: row.id, coordination: 'WHATSAPP',
        }).execute();
        // Un même utilisateur peut être capitaine des DEUX équipes (le core
        // ne l'interdit pas — seul « un capitaine par équipe » est un
        // invariant, pas « un capitaine par personne ») : dédoublonner avant
        // insertion, sinon deux lignes identiques violent la clé composite
        // (match_id, user_id) DANS la même instruction — un ON CONFLICT ne
        // peut pas non plus résoudre un doublon interne à un même INSERT.
        const playerIds = new Set([fromCaptainId, req.auth!.userId]);
        await trx.insertInto('match_players').values(
          // Règle 3 : le capitaine qui défie ouvre l'équipe A, l'adversaire qui accepte l'équipe B.
          [...playerIds].map((userId, i) => ({ match_id: matchId, user_id: userId, status: 'JOINED' as const, joined_at: new Date(now), team: (i === 0 ? 'A' : 'B') as 'A' | 'B' })),
        ).execute();
        await trx.updateTable('challenges').set({ status: 'ACCEPTED', match_id: matchId })
          .where('id', '=', row.id).execute();
        await writeNotifications(trx, RECIPIENTS.challengeAnswered(fromCaptainId), 'CHALLENGE_ACCEPTED', row.id, now);
        return { ok: true as const, matchId };
      }));
      if (!outcome.ok) throw outcome.error;
      return reply.code(201).send({ ok: true, matchId: outcome.matchId });
    });

  /* Refus — capitaine défié seul, aucun match créé. */
  app.post<{ Params: { id: string } }>('/challenges/:id/reject',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      // Correctif (05/09/2026) : voir withCommittedPush, notifications/push.ts.
      const outcome = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadChallengeForUpdate(trx, req.params.id);
        await loadTeamForUpdate(trx, row.to_team_id); // même verrou d'agrégat qu'à l'acceptation
        const members = await loadMembers(trx, row.to_team_id);
        const check = await canRespondOrExpire(trx, row, req.auth!.userId, members.map(rowToTeamMember), now);
        if (!check.ok) return { ok: false as const, error: toApiError(check) };
        const result = rejectChallenge(rowToChallenge(row), req.auth!.userId, members.map(rowToTeamMember), now);
        if (!result.result.ok) return { ok: false as const, error: toApiError(result.result) };
        await trx.updateTable('challenges').set({ status: 'REJECTED' }).where('id', '=', row.id).execute();
        const fromCaptainId = await activeCaptainOf(trx, row.from_team_id);
        if (fromCaptainId) {
          await writeNotifications(trx, RECIPIENTS.challengeAnswered(fromCaptainId), 'CHALLENGE_REJECTED', row.id, now);
        }
        return { ok: true as const };
      }));
      if (!outcome.ok) throw outcome.error;
      return reply.send({ ok: true, status: 'REJECTED' });
    });

  /* Retrait — capitaine émetteur seul, tant que le défi est en attente. */
  app.post<{ Params: { id: string } }>('/challenges/:id/cancel',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      await db.transaction().execute(async (trx) => {
        const row = await loadChallengeForUpdate(trx, req.params.id);
        await loadTeamForUpdate(trx, row.from_team_id); // même verrou d'agrégat qu'à l'envoi/l'acceptation
        const members = (await loadMembers(trx, row.from_team_id)).map(rowToTeamMember);
        const result = cancelChallenge(rowToChallenge(row), req.auth!.userId, members);
        must(result.result);
        await trx.updateTable('challenges').set({ status: 'CANCELLED' }).where('id', '=', row.id).execute();
      });
      return reply.send({ ok: true, status: 'CANCELLED' });
    });
}

/* Expiration paresseuse : si la garde core constate un délai dépassé sur un
   défi encore PENDING en base, on persiste EXPIRED avant de refuser la
   mutation — sans quoi il resterait « en attente » indéfiniment aux yeux du
   prochain lecteur (pas de balayage périodique dans cette tranche, voir
   docs/DECISIONS.md : `expireChallenges` existe côté core, pas encore de tâche
   planifiée côté API). */
async function canRespondOrExpire(
  db: Db, row: ChallengeRow, responderId: string, members: readonly TeamMember[], now: number,
) {
  const res = canRespond(rowToChallenge(row), responderId, members, now);
  if (!res.ok && res.code === 'CHALLENGE_EXPIRED' && row.status === 'PENDING') {
    await db.updateTable('challenges').set({ status: 'EXPIRED' }).where('id', '=', row.id).execute();
  }
  return res;
}
