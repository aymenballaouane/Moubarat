import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import {
  activePlayers, cancellationKind, canCancelBooking, canCenterAct, recurringOccurrence, setBookingStatus,
  checkBookingLimits, validateDisplayName, weekdayOfDayStart, type BookingStatus,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { algiersDateOf, algiersHHMM, dayStartMs, operatingDateOf, operatingDayWindow } from '../../lib/algiers.js';
import { fromPgRange, toPgRange } from '../../lib/pgrange.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import { accentInsensitiveRegex } from '../../lib/search.js';
import { containsLike, phoneSearchPatterns } from '../../lib/phone-search.js';
import { ApiError, badRequest, must, notFound, unauthorized } from '../../lib/http.js';
import { createBooking, getBookingWithVenue, rowToBooking, type BookingRow } from './service.js';
import { computeReschedule, parseRescheduleQuery } from './reschedule.js';
import { cancelLinkedMatch, notifiedLabel, notifyBookerOfCenterCancel, type LinkedMatchCancelled } from './cascade.js';
import { withCommittedPush } from '../../notifications/push.js';
import { assertNotRestricted, recordAbsence } from '../absences/service.js';
import { attachClaim } from '../claims/service.js';
import { assertPhoneVisible, describeConflict, rowToMatchPlayer, type MatchRow } from '../matches/service.js';
import { rowToRecurringBooking } from '../recurring-bookings/service.js';

/* CRM Auth V1 : ce module mélange deux identités — le joueur (guards, Player)
   pour créer/annuler SA réservation, et le centre (platformGuards, plateforme)
   pour créer une résa comptoir ou faire vivre une réservation existante.
   POST /bookings décide selon `source` laquelle des deux s'applique (voir
   plus bas) — jamais les deux à la fois sur la même requête. */
/** BUG-4 (c), 27/09/2026 — garde-fous des réservations posées par un joueur (voir env.ts). Absents (scripts) : aucun. */
export interface BookingLimits { bookingHorizonDays: number; phoneDeclarationsMaxLive: number; bookingMaxPerDay: number; bookingMaxUpcoming: number;
  /** Règle 23 : refuser une réservation qui chevauche un autre engagement du joueur. Toujours vrai en production (server.ts) ; les tests qui posent des
      réservations chevauchantes comme données le relâchent (tests/helpers.ts). */
  forbidOverlap: boolean }

interface Deps { db: Db; guards: Guards; platformGuards: PlatformGuards; limits?: BookingLimits; }

function publicBooking(row: BookingRow): Record<string, unknown> {
  const range = fromPgRange(row.time_range);
  return {
    id: row.id,
    reference: row.reference,
    fieldId: row.field_id,
    start: range.start,
    end: range.end,
    status: row.status,
    source: row.source,
    verifiedByCenter: row.verified_by_center,
    reservationName: row.reservation_name,
    customerPhone: row.customer_phone,
    claimStatus: row.claim_status,
    totalDa: row.price_total_da,
    promoCodeId: row.promo_code_id,
    discountDa: row.discount_da,
    createdAt: row.created_at.getTime(),
    matchId: row.match_id,
    format: row.format,
  };
}

export async function registerBookingRoutes(app: FastifyInstance, { db, guards, platformGuards, limits }: Deps): Promise<void> {

  /* Création — le seul chemin (core prepareBooking) pour les trois sources :
     MOUBARAT (app), PHONE (déclarée par le joueur OU créée depuis le CRM —
     voir plus bas, deux chemins bien distincts —, à vérifier par le centre
     dans le premier cas), WALK_IN (comptoir — réservé au staff, audité).
     Lot 3 (15/09/2026, demande d'Aymen) : le CRM peut désormais créer une
     réservation Téléphone (case « case libre » du Planning, canal Téléphone)
     — jusqu'ici PHONE n'était accessible qu'à un joueur déclarant lui-même
     avoir appelé. */
  app.post<{
    Body: {
      fieldId?: string; date?: string; startMin?: number; durationMin?: number;
      source?: string; reservationName?: string; customerPhone?: string; promoCode?: string; format?: string;
    };
  }>('/bookings', { preHandler: (req) => guards.tryAuth(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const fieldId = String(b.fieldId ?? '');
    if (!fieldId) throw badRequest('fieldId manquant.');
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
    const source = (b.source ?? 'MOUBARAT') as 'MOUBARAT' | 'PHONE' | 'WALK_IN';
    if (!['MOUBARAT', 'PHONE', 'WALK_IN'].includes(source)) {
      throw badRequest('Source invalide : MOUBARAT, PHONE ou WALK_IN.');
    }

    // MOUBARAT et PHONE déclaré par un joueur : identité Player exigée.
    // WALK_IN (comptoir) et PHONE créé depuis le CRM (le staff a le client au
    // bout du fil, exigence n°3 d'Aymen) : identité plateforme exigée, même
    // permission CREATE_BOOKING, reservationName obligatoire (pas de
    // req.auth.name à défaut, un compte plateforme n'en a pas). Distingués
    // par la présence de req.auth (Player), jamais un champ client déclaratif
    // du genre « créé par le staff » — l'identité résolue par le serveur
    // fait foi, jamais une affirmation du corps de requête.
    const staffCreated = source === 'WALK_IN' || (source === 'PHONE' && !req.auth);
    let byUserId: string;
    let reservationName: string;
    let staffRole: 'OWNER' | 'MANAGER' | 'RECEPTION' | 'STAFF' | null = null;
    if (staffCreated) {
      const field = await db.selectFrom('fields').select('venue_id')
        .where('id', '=', fieldId).executeTakeFirst();
      if (!field) throw notFound('Terrain introuvable.');
      staffRole = await platformGuards.requireCenterAction(req, field.venue_id, 'CREATE_BOOKING');
      byUserId = req.platformAuth!.accountId;
      if (!b.reservationName) {
        throw badRequest(`reservationName requis pour une réservation ${source === 'WALK_IN' ? 'comptoir' : 'téléphonique'}.`);
      }
      reservationName = String(b.reservationName).trim();
    } else {
      if (!req.auth) throw unauthorized();
      byUserId = req.auth.userId;
      reservationName = String(b.reservationName ?? req.auth.name).trim();
      /* BUG-4 (c), audit pré-lancement (27/09/2026) — deux garde-fous réservés aux réservations posées par un JOUEUR
         (le comptoir et le téléphone saisi au CRM ne sont pas concernés) :
         - horizon : pas de réservation au-delà de `bookingHorizonDays` (un créneau à 400 jours bloquait l'inventaire
           sans que rien ne l'interdise) ;
         - déclarations téléphoniques : au plus `phoneDeclarationsMaxLive` déclarations NON confirmées et à venir par
           joueur — chacune bloque un créneau que le centre n'a encore jamais vu (sondes ADV-3/ADV-6 de l'audit :
           12 déclarations acceptées, réservation à +400 jours acceptée). */
      if (limits && dayStart > Date.now() + limits.bookingHorizonDays * 86_400_000) {
        throw badRequest(`Les réservations sont ouvertes jusqu’à ${limits.bookingHorizonDays} jours à l’avance.`, 'BOOKING_TOO_FAR');
      }
      if (limits && source === 'PHONE') {
        const live = await db.selectFrom('bookings').select((eb) => eb.fn.countAll<string>().as('n'))
          .where('by_user_id', '=', byUserId).where('source', '=', 'PHONE').where('verified_by_center', '=', false)
          .where('status', '=', 'RESERVED').where(sql<boolean>`upper(time_range) > now()`)
          .executeTakeFirstOrThrow();
        if (Number(live.n) >= limits.phoneDeclarationsMaxLive) {
          const n = limits.phoneDeclarationsMaxLive;
          throw new ApiError(
            409, 'PHONE_DECLARATIONS_LIMIT',
            `Tu as déjà ${n} réservation${n > 1 ? 's' : ''} téléphonique${n > 1 ? 's' : ''} en attente de confirmation par le centre — attends qu’il les confirme, ou annule-en une, avant d’en déclarer une autre.`,
          );
        }
      }
    }
    /* Règle 23 (Lot 9, 26/10/2026) : au plus `bookingMaxPerDay` réservations par jour et `bookingMaxUpcoming` à venir, jamais deux qui se
       chevauchent (matchs rejoints compris) — pour une réservation posée par un JOUEUR seulement. Règle 32 : sans l'accord « numéro visible »,
       pas de nouvelle réservation. Posé en `playerGuard` : appelé par createBooking APRÈS la validation du créneau par le core, pour que
       SLOT_TAKEN / centre fermé / format inconnu gardent la priorité. Verrou consultatif par joueur le temps de la lecture seulement. */
    const playerGuard = !staffCreated && limits
      ? async (range: { start: number; end: number }) => {
        await db.transaction().execute(async (trx) => {
          await sql`select pg_advisory_xact_lock(hashtext(${'booking-limits:' + byUserId}))`.execute(trx);
          await assertPhoneVisible(trx, byUserId);
          await assertNotRestricted(trx, byUserId, Date.now());   // règle 25
          const mine = await trx.selectFrom('bookings').select(['time_range', 'status']).where('by_user_id', '=', byUserId)
            .where('status', '=', 'RESERVED').where(sql<boolean>`upper(time_range) > now()`).execute();
          const verdict = checkBookingLimits({
            candidate: range, now: Date.now(), dayOf: algiersDateOf,
            mine: mine.map((m) => ({ range: fromPgRange(m.time_range), status: m.status })),
            maxPerDay: limits.bookingMaxPerDay, maxUpcoming: limits.bookingMaxUpcoming,
          });
          if (!verdict.ok) {
            // `max` : la valeur réellement appliquée — l'app n'écrit « 2 » ou « 4 » dans sa fenêtre que si c'est la valeur de la règle.
            throw new ApiError(409, verdict.code, verdict.message, { max: verdict.code === 'BOOKING_LIMIT_DAY' ? limits.bookingMaxPerDay : limits.bookingMaxUpcoming });
          }
          const conflict = limits.forbidOverlap ? await describeConflict(trx, byUserId, range) : null;
          if (conflict) {
            throw new ApiError(409, 'SCHEDULE_CONFLICT', 'Tu as déjà un match ou une réservation sur ce créneau.', conflict);
          }
        });
      }
      : undefined;
    must(validateDisplayName(reservationName));

    // customerPhone : texte libre, jamais lié à un compte joueur (décision
    // Aymen) — n'a de sens que pour une réservation créée par le staff
    // (WALK_IN/PHONE-CRM) ; ignoré silencieusement pour MOUBARAT/PHONE-joueur
    // (qui ont déjà leur propre compte, pas un second numéro parallèle).
    const customerPhone = staffCreated && b.customerPhone !== undefined
      ? String(b.customerPhone).trim() || undefined : undefined;

    const promoCode = b.promoCode !== undefined ? String(b.promoCode).trim() || undefined : undefined;
    // Lot 3 : PHONE créé depuis le CRM = vérifié d'office (le staff EST la
    // source, comme WALK_IN) — jamais le parcours « à vérifier » du joueur
    // qui déclare avoir appelé. Posé ici, jamais dans prepareBooking (core,
    // gelé) : voir forceVerified, bookings/service.ts.
    const staffPhoneCreate = staffCreated && source === 'PHONE';
    const format = b.format !== undefined ? String(b.format).trim() || undefined : undefined;
    const created = await createBooking(db, {
      fieldId, dayStart, startMin, durationMin, source,
      byUserId, reservationName, now: Date.now(),
      ...(promoCode ? { promoCode } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(staffPhoneCreate ? { forceVerified: true } : {}),
      ...(format ? { format } : {}),
      ...(playerGuard ? { playerGuard } : {}),
    });

    /* Règle 21 : une réservation SAISIE PAR LE CENTRE avec un numéro qui est celui d'un compte joueur s'y rattache, EN ATTENTE de sa réponse « C'est bien toi ? »
       (notification toujours envoyée, règle 38). Sans compte à ce numéro, rien ne change : le numéro reste un simple texte de comptoir. */
    const claimedUserId = staffCreated && created.row.customer_phone
      ? await withCommittedPush(() => db.transaction().execute((trx) => attachClaim(trx, created.row, Date.now())))
      : null;

    if (source === 'WALK_IN' && staffRole) {
      await writeAudit(db, {
        venueId: created.venue.id, actorId: byUserId, actorRole: staffRole,
        action: 'BOOKING_CREATED', objectType: 'booking', objectId: created.row.id,
        summary: `a créé la réservation comptoir ${created.row.reference} (${reservationName}, ${created.row.price_total_da} DA)`,
      });
    } else if (staffPhoneCreate && staffRole) {
      await writeAudit(db, {
        venueId: created.venue.id, actorId: byUserId, actorRole: staffRole,
        action: 'BOOKING_CREATED', objectType: 'booking', objectId: created.row.id,
        summary: `a créé la réservation téléphonique ${created.row.reference} (${reservationName}, ${created.row.price_total_da} DA) — vérifiée d'office`,
      });
    }

    return reply.code(201).send({
      booking: { ...publicBooking(created.row), claimStatus: claimedUserId !== null ? 'PENDING' : null },
      quote: {
        totalDa: created.quote.total.amount,
        bands: created.quote.bands.map((band) => ({
          fromMin: band.fromMin, toMin: band.toMin,
          rateDaPerHour: band.rate.amount, amountDa: band.amount,
        })),
      },
      centerNotified: created.notifyCenter,
    });
  });

  /* Mes réservations (app joueur). Pagination par curseur (mise à l'échelle L3, 25/09/2026 — contrat :
     lib/cursor.ts) : `limit` absent = 50, l'ancien plafond ; réponse = les mêmes `bookings` plus `nextCursor`. */
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/me/bookings',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const limit = pageLimit(req.query.limit, { def: 50, max: 100 });
    const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
    let query = db.selectFrom('bookings')
      .innerJoin('fields', 'fields.id', 'bookings.field_id')
      .innerJoin('venues', 'venues.id', 'fields.venue_id')
      .selectAll('bookings')
      .select(['fields.name as field_name', 'venues.name as venue_name', 'venues.id as venue_id'])
      .select(isoMicros(sql.ref('bookings.created_at')).as('created_at_cursor'))
      .where('bookings.by_user_id', '=', req.auth!.userId)
      .orderBy('bookings.created_at', 'desc').orderBy('bookings.id', 'desc')
      .limit(limit + 1);
    if (cursor) query = query.where(sql<boolean>`(bookings.created_at, bookings.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
    const page = pageOf(await query.execute(), limit, (r) => [r.created_at_cursor, r.id]);
    return reply.send({
      nextCursor: page.nextCursor,
      bookings: page.items.map((r) => ({
        ...publicBooking(r),
        field: r.field_name,
        venue: { id: r.venue_id, name: r.venue_name },
      })),
    });
  });

  /* Annulation joueur — gratuite jusqu'à H-2 ; après, elle reste possible mais compte comme une
     demi-absence (§18 modifiée, §19 nouvelle, GO d'Aymen 25/10/2026 : canCancelBooking, core, ne
     bloque plus — cancellationKind dit juste si CETTE annulation est EARLY ou LATE).
     Verrou de ligne : deux annulations/mutations concurrentes sur la même
     réservation se sérialisent au lieu de se marcher dessus (lost update). */
  app.post<{ Params: { id: string } }>('/bookings/:id/cancel',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      // BUG-1 (26/09/2026) : la cascade vers le match écrit des notifications — push différé après le commit réel
      // (withCommittedPush), comme toute route qui notifie.
      const { cascade, late } = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const { row } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        if (row.by_user_id !== req.auth!.userId) {
          throw new ApiError(403, 'FORBIDDEN', 'Cette réservation n’est pas la vôtre.');
        }
        const booking = rowToBooking(row);
        must(canCancelBooking(booking, now));
        // cancelled_at : horodatage nécessaire à cancellationKind (core, ops.ts) pour la fiabilité
        // pondérée (EARLY >2h / LATE <2h, §18/§19) — absent du schéma gelé, ajouté par migration
        // additive (Analytics, module Clients, docs/DECISIONS.md).
        // cancel_reason (15/09/2026) : toujours CLIENT ici, jamais un choix
        // du joueur — un joueur qui annule sa propre réservation n'est
        // jamais une erreur du centre. STAFF_ERROR n'existe que côté
        // annulation staff (POST /bookings/:id/status, plus bas).
        await trx.updateTable('bookings').set({ status: 'CANCELLED', cancelled_at: new Date(now), cancel_reason: 'CLIENT' })
          .where('id', '=', row.id).execute();
        // Le match posé sur cette réservation s'annule avec elle (cascade.ts) — le joueur qui annule en est
        // l'organisateur : les autres inscrits sont prévenus, pas lui. Un refus plus haut (transition invalide,
        // ex. déjà HONORED) a déjà levé : ni la réservation ni le match ne bougent alors.
        const cascadeResult = await cancelLinkedMatch(trx, row, { kind: 'PLAYER', userId: req.auth!.userId }, now);
        const isLate = cancellationKind(booking.range.start, now) === 'LATE';
        // Règles 18, 19, 25 : une annulation tardive est une DEMI-absence (deux valent une absence pour la restriction).
        if (isLate) await recordAbsence(trx, { userId: req.auth!.userId, kind: 'HALF', source: 'LATE_CANCEL', bookingId: row.id, matchId: row.match_id, now });
        return { cascade: cascadeResult, late: isLate };
      }));
      const base = late
        ? 'Annulée. À moins de 2 h du créneau, elle compte comme une demi-absence.'
        : 'Annulée sans frais.';
      return reply.send({
        ok: true,
        matchCancelled: cascade !== null,
        message: cascade === null
          ? `${base} Le créneau est libéré.`
          : `${base} Le créneau est libéré et ton match « ${cascade.title} » est annulé — ${notifiedLabel(cascade.notified)}.`,
      });
    });

  /* Confirmation d'une réservation téléphonique par le centre —
     LA SOURCE NE S'ÉCRASE JAMAIS : seul verified_by_center change (§25). */
  app.post<{ Params: { id: string } }>('/bookings/:id/verify',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      /* Audit 07/09/2026 (T3) : la garde centre s'évalue AVANT la transaction,
         sur une lecture sans verrou. Elle travaille sur le pool racine (pas sur
         `trx`) : appelée à l'intérieur du bloc, elle empruntait une DEUXIÈME
         connexion pendant que la transaction détenait déjà la sienne et le
         verrou de ligne — avec un pool de 10, dix confirmations simultanées
         figeaient toute l'API. Le centre d'une réservation ne change jamais
         (field_id n'est jamais réécrit), la relecture verrouillée le revérifie
         quand même : jamais une garde évaluée sur une prémisse non contrôlée. */
      const pre = await getBookingWithVenue(db, req.params.id);
      const role = await platformGuards.requireCenterAction(req, pre.venue.id, 'CONFIRM_EXTERNAL');
      const outcome = await db.transaction().execute(async (trx) => {
        const { row, venue } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        if (venue.id !== pre.venue.id) throw new ApiError(409, 'INVALID_TARGET', 'La réservation a changé de centre entre-temps.');
        if (row.source !== 'PHONE') throw badRequest('Seule une réservation téléphonique se confirme.', 'INVALID_TARGET');
        if (row.verified_by_center) throw badRequest('Déjà confirmée.', 'INVALID_TRANSITION');
        // Rien à confirmer sur une résa qui n'est plus vivante (ex. annulée
        // entre-temps par le joueur) — le geste du gérant n'aurait plus de sens.
        if (row.status !== 'RESERVED') {
          throw badRequest(`Cette réservation est « ${row.status} » — plus rien à confirmer.`, 'INVALID_TRANSITION');
        }
        await trx.updateTable('bookings').set({ verified_by_center: true })
          .where('id', '=', row.id).execute();
        await writeAudit(trx, {
          venueId: venue.id, actorId: req.platformAuth!.accountId, actorRole: role,
          action: 'EXTERNAL_CONFIRMED', objectType: 'booking', objectId: row.id,
          summary: `a confirmé la réservation téléphonique ${row.reference ?? row.id} — origine conservée : Téléphone`,
          before: 'verified=false', after: 'verified=true',
        });
        return { source: row.source };
      });
      return reply.send({ ok: true, source: outcome.source, verifiedByCenter: true });
    });

  /* Cycle cash côté centre : RESERVED → HONORED → PAID / NO_SHOW, ou annulation (CRM-4, 27/09/2026 :
     Réception+ — avant Manager+, GO d'Aymen). Transitions gardées par la table du core, auditées, verrouillées. */
  app.post<{ Params: { id: string }; Body: { status?: string; reason?: string } }>('/bookings/:id/status',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      const to = String(req.body?.status ?? '') as BookingStatus;
      if (!['HONORED', 'PAID', 'NO_SHOW', 'CANCELLED'].includes(to)) {
        throw badRequest('Statut cible invalide : HONORED, PAID, NO_SHOW ou CANCELLED.');
      }
      // Motif d'annulation (15/09/2026, prérequis avant le premier centre
      // réel) : obligatoire pour TOUTE annulation, quel que soit le rôle qui
      // annule (Réception depuis CRM-4, 27/09/2026) — jamais un défaut
      // silencieux (CLIENT par défaut aurait maquillé une vraie erreur de
      // saisie en annulation cliente, faussant CA perdu ET fiabilité dans
      // l'autre sens). L'UI (CRM Réservations) force déjà un choix actif,
      // sans présélection — cette validation est le filet côté serveur.
      const reason = String(req.body?.reason ?? '');
      if (to === 'CANCELLED' && reason !== 'STAFF_ERROR' && reason !== 'CLIENT') {
        throw badRequest('Motif d’annulation requis : STAFF_ERROR ou CLIENT.', 'CANCEL_REASON_REQUIRED');
      }
      // Même correctif que /verify (audit T3) : garde hors transaction, sur le
      // centre lu sans verrou, revérifié sous verrou.
      const pre = await getBookingWithVenue(db, req.params.id);
      const role = await platformGuards.requireCenterAction(req, pre.venue.id,
        to === 'CANCELLED' ? 'CANCEL_BOOKING' : 'SET_CASH_STATUS');
      const now = Date.now();
      // BUG-1 (26/09/2026) : une annulation par le centre notifie des joueurs — push différé après le commit réel.
      const outcome = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const { row, venue } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        if (venue.id !== pre.venue.id) throw new ApiError(409, 'INVALID_TARGET', 'La réservation a changé de centre entre-temps.');
        must(setBookingStatus(rowToBooking(row), to));
        /* Audit final 26/10/2026 (P1-3, CRM-1) : un « no-show » est une ABSENCE pour le joueur (règle 25) — jamais posée avant que le
           créneau ait commencé (un clic sur une réservation de la semaine prochaine sanctionnait un joueur qui n'avait encore rien manqué). */
        if (to === 'NO_SHOW' && now < fromPgRange(row.time_range).start) {
          throw badRequest('Le créneau n’a pas encore commencé : impossible de le marquer no-show.', 'BOOKING_NOT_STARTED');
        }
        await trx.updateTable('bookings')
          .set({
            status: to,
            ...(to === 'CANCELLED' ? { cancelled_at: new Date(now), cancel_reason: reason as 'STAFF_ERROR' | 'CLIENT' } : {}),
          })
          .where('id', '=', row.id).execute();
        /* Cascade (cascade.ts) : le match posé sur la réservation s'annule avec elle et TOUS ses inscrits sont
           prévenus, organisateur compris (MATCH_CANCELLED_BY_CENTER — le centre n'est pas un joueur). Sans match
           vivant, c'est le réservant qui est prévenu (BOOKING_CANCELLED_BY_CENTER), s'il est un compte joueur —
           quel que soit le motif : une erreur de saisie du centre sur une résa App fait aussi disparaître le
           créneau du joueur. HONORED/PAID/NO_SHOW ne touchent jamais au match. */
        // Règle 25 : un « no-show » posé par le centre est l'ABSENCE du titulaire de la réservation — si c'est un compte joueur (jamais un compte du comptoir),
        // une seule fois par réservation (ou par match si elle en porte un).
        if (to === 'NO_SHOW') {
          const holder = await trx.selectFrom('users').select('id').where('id', '=', row.by_user_id).where('deleted_at', 'is', null).executeTakeFirst();
          if (holder) {
            await recordAbsence(trx, { userId: holder.id, kind: 'FULL', source: 'CENTER', bookingId: row.id, matchId: row.match_id, declaredBy: req.platformAuth!.accountId, now });
          }
        }
        let cascade: LinkedMatchCancelled | null = null;
        let bookerNotified = false;
        if (to === 'CANCELLED') {
          cascade = await cancelLinkedMatch(trx, row, { kind: 'CENTER' }, now);
          if (cascade === null) bookerNotified = await notifyBookerOfCenterCancel(trx, row, now);
        }
        const cascadeSummary = cascade !== null
          ? ` — match « ${cascade.title} » annulé, ${notifiedLabel(cascade.notified)}`
          : bookerNotified ? ' — réservant prévenu dans l’app' : '';
        await writeAudit(trx, {
          venueId: venue.id, actorId: req.platformAuth!.accountId, actorRole: role,
          action: to === 'CANCELLED' ? 'BOOKING_CANCELLED' : 'BOOKING_CASH_STATUS',
          objectType: 'booking', objectId: row.id,
          summary: to === 'CANCELLED'
            ? (reason === 'STAFF_ERROR'
              ? `a annulé la réservation ${row.reference ?? row.id} (erreur de saisie du centre — ${row.price_total_da} DA, non compté en CA perdu)${cascadeSummary}`
              : `a annulé la réservation ${row.reference ?? row.id} (client — ${row.price_total_da} DA retirés du CA engagé)${cascadeSummary}`)
            : `a passé ${row.reference ?? row.id} en ${to} (${row.price_total_da} DA)`,
          before: row.status, after: to,
        });
        return { cascade, bookerNotified };
      }));
      return reply.send({
        ok: true, status: to,
        ...(to === 'CANCELLED' ? {
          matchCancelled: outcome.cascade !== null,
          matchTitle: outcome.cascade?.title ?? null,
          // Joueurs réellement prévenus : les inscrits du match, ou le seul réservant.
          notifiedPlayers: outcome.cascade !== null ? outcome.cascade.notified : (outcome.bookerNotified ? 1 : 0),
        } : {}),
      });
    });

  /* Corriger un « no-show » posé par erreur (audit final 26/10/2026, P1-3, GO d'Aymen) — Manager et propriétaire seulement (REVERT_NO_SHOW).
     La réservation redevient « Réservée » (le centre choisit ensuite : honorée, ou no-show pour de bon), l'absence que ce no-show avait
     créée pour le titulaire est EFFACÉE, et la restriction qu'elle avait déclenchée (posée dans la même transaction, même instant) est
     levée. Tracé au Journal du centre avec le vrai rôle. Aucune autre voie ne supprime une absence : c'est le seul chemin. */
  app.post<{ Params: { id: string } }>('/bookings/:id/revert-no-show',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      const pre = await getBookingWithVenue(db, req.params.id);
      const role = await platformGuards.requireCenterAction(req, pre.venue.id, 'REVERT_NO_SHOW');
      const now = Date.now();
      const out = await db.transaction().execute(async (trx) => {
        const { row, venue } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        if (venue.id !== pre.venue.id) throw new ApiError(409, 'INVALID_TARGET', 'La réservation a changé de centre entre-temps.');
        if (row.status !== 'NO_SHOW') throw badRequest('Cette réservation n’est pas marquée no-show.', 'INVALID_TRANSITION');
        await trx.updateTable('bookings').set({ status: 'RESERVED' }).where('id', '=', row.id).execute();
        let absenceRemoved = false;
        const holder = row.by_user_id;
        if (holder) {
          await sql`SELECT pg_advisory_xact_lock(hashtext(${'absences:' + holder}))`.execute(trx);
          const abs = await trx.selectFrom('absences').select(['id', 'created_at'])
            .where('user_id', '=', holder).where('booking_id', '=', row.id).where('source', '=', 'CENTER').executeTakeFirst();
          if (abs) {
            await trx.deleteFrom('absences').where('id', '=', abs.id).execute();
            absenceRemoved = true;
            await trx.updateTable('player_restrictions').set({ lifted_at: new Date(now), lifted_by: req.platformAuth!.accountId })
              .where('user_id', '=', holder).where('starts_at', '=', abs.created_at).where('lifted_at', 'is', null).execute();
          }
        }
        await writeAudit(trx, {
          venueId: venue.id, actorId: req.platformAuth!.accountId, actorRole: role,
          action: 'BOOKING_NO_SHOW_REVERTED', objectType: 'booking', objectId: row.id,
          summary: `a annulé le no-show de la réservation ${row.reference ?? row.id}${absenceRemoved ? ' — l’absence du joueur est effacée' : ''}`,
          before: 'NO_SHOW', after: 'RESERVED',
        });
        return { absenceRemoved };
      });
      return reply.send({ ok: true, status: 'RESERVED', absenceRemoved: out.absenceRemoved });
    });

  /* Modifier une réservation (16/09/2026, demande d'Aymen) — règle finale,
     volontairement simple : terrain/heure/durée modifiables SEULEMENT si
     `match_id IS NULL` (voir reschedule.ts, computeReschedule — c'est la
     toute première vérification, avant tout autre garde). Dès qu'un match
     existe, même sans aucun inscrit, la résa est verrouillée intégralement —
     seule Annuler reste possible (annule résa + match, déjà existant,
     inchangé). Permission MODIFY_BOOKING (core, Réception+, déjà définie,
     jamais câblée avant ce lot). Preview en lecture seule (aucune écriture,
     même verrou de ligne) — sert le devis live du formulaire CRM ; le commit
     réévalue tout sous verrou avant d'écrire, une preview n'étant pas une
     réservation du nouveau créneau (un autre poste a pu le prendre). */
  app.get<{
    Params: { id: string };
    Querystring: { fieldId?: string; date?: string; startMin?: string; durationMin?: string };
  }>('/bookings/:id/reschedule/preview',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      const { row, venue } = await getBookingWithVenue(db, req.params.id);
      const role = await platformGuards.requireCenterAction(req, venue.id, 'MODIFY_BOOKING');
      let dayStart: number;
      try { dayStart = dayStartMs(String(req.query.date ?? '')); }
      catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }
      const { fieldId, startMin, durationMin } = parseRescheduleQuery(req.query);
      const c = await computeReschedule(db, row, { fieldId, dayStart, startMin, durationMin }, role, venue.id);
      return reply.send({
        old: { fieldId: c.oldFieldId, fieldName: c.oldFieldName, start: c.oldStart, end: c.oldEnd, totalDa: c.oldPriceTotalDa },
        new: { fieldId: c.newFieldId, fieldName: c.newFieldName, start: c.newStart, end: c.newEnd, totalDa: c.totalDa, discountDa: c.discountDa },
        promoDropped: c.promoDropped,
        quote: {
          totalDa: c.quote.total.amount,
          bands: c.quote.bands.map((b) => ({ fromMin: b.fromMin, toMin: b.toMin, rateDaPerHour: b.rate.amount, amountDa: b.amount })),
        },
      });
    });

  app.post<{
    Params: { id: string };
    Body: { fieldId?: string; date?: string; startMin?: number; durationMin?: number };
  }>('/bookings/:id/reschedule',
    { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      // Même correctif que /verify et /status (audit T3) : garde évaluée hors
      // transaction, sur une lecture sans verrou ; revérifiée sous verrou plus bas.
      const pre = await getBookingWithVenue(db, req.params.id);
      const role = await platformGuards.requireCenterAction(req, pre.venue.id, 'MODIFY_BOOKING');
      let dayStart: number;
      try { dayStart = dayStartMs(String(req.body?.date ?? '')); }
      catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }
      const { fieldId, startMin, durationMin } = parseRescheduleQuery({
        ...(req.body?.fieldId !== undefined ? { fieldId: req.body.fieldId } : {}),
        ...(req.body?.startMin !== undefined ? { startMin: req.body.startMin } : {}),
        ...(req.body?.durationMin !== undefined ? { durationMin: req.body.durationMin } : {}),
      });

      const outcome = await db.transaction().execute(async (trx) => {
        const { row, venue } = await getBookingWithVenue(trx, req.params.id, { forUpdate: true });
        if (venue.id !== pre.venue.id) throw new ApiError(409, 'INVALID_TARGET', 'La réservation a changé de centre entre-temps.');
        const c = await computeReschedule(trx, row, { fieldId, dayStart, startMin, durationMin }, role, venue.id);
        /* BUG-1 (26/09/2026) : computeReschedule n'a laissé passer qu'une réservation sans match VIVANT — si `match_id`
           est encore posé, il pointe un match ANNULÉ (reschedule.ts). Il est détaché ici : l'invariant garanti par la
           base (migration 0029, `bookings_venue_guard` — « un match se joue sur le terrain de sa réservation ») refuserait
           sinon tout changement de terrain d'une réservation encore liée à ce match mort (500 venue_isolation_violation).
           Un match annulé ne se relance pas : la réservation redevient une réservation ordinaire, sans lien. */
        await trx.updateTable('bookings').set({
          field_id: c.newFieldId,
          time_range: toPgRange({ start: c.newStart, end: c.newEnd }),
          price_total_da: c.totalDa,
          discount_da: c.discountDa,
          ...(row.match_id !== null ? { match_id: null } : {}),
        }).where('id', '=', row.id).execute();
        // Les deux sens du lien sont détachés : un match annulé encore « posé » sur une réservation déplacée
        // violerait l'invariant terrain de sa réservation (contrôle préalable de la migration 0029).
        if (row.match_id !== null) {
          await trx.updateTable('matches').set({ booking_id: null }).where('id', '=', row.match_id).execute();
        }
        await writeAudit(trx, {
          venueId: venue.id, actorId: req.platformAuth!.accountId, actorRole: role,
          action: 'BOOKING_RESCHEDULED', objectType: 'booking', objectId: row.id,
          summary: `a déplacé la réservation ${row.reference ?? row.id} de `
            + `${c.oldFieldName} ${algiersHHMM(c.oldStart)}→${algiersHHMM(c.oldEnd)} vers `
            + `${c.newFieldName} ${algiersHHMM(c.newStart)}→${algiersHHMM(c.newEnd)} `
            + `(${c.oldPriceTotalDa} DA → ${c.totalDa} DA)`,
        });
        return c;
      });
      return reply.send({
        ok: true,
        booking: { fieldId: outcome.newFieldId, start: outcome.newStart, end: outcome.newEnd, totalDa: outcome.totalDa, discountDa: outcome.discountDa },
        promoDropped: outcome.promoDropped,
      });
    });

  /* Chantier CRM — Planning + Réservations (05/09/2026) : seule route qui
     manquait aux deux écrans (voir docs/DECISIONS.md). `GET /platform/bookings`
     a exactement la forme voulue mais est réservé au superadmin (supervision
     transversale, jamais un accès centre) — celle-ci vérifie une vraie ligne
     `center_staff` pour CE `venueId` (`requireCenterAction`), jamais un simple
     jeton plateforme valide. VIEW_PLANNING est accordée aux 4 rôles (STAFF
     inclus) : les deux écrans restent visibles à tout le personnel, comme en
     démo aujourd'hui.

     Le roster d'un match est porté PAR CETTE ROUTE (jamais par
     GET /matches/:id, qui vérifie une session JOUEUR — un jeton plateforme n'y
     satisferait aucune garde et se verrait même refuser tout match privé issu
     d'un défi, faute de `req.auth`). Un seul contrôle d'accès pour toute la
     réponse, jamais un second chemin plus faible.

     Numéro de téléphone (Lot 3, 15/09/2026) : `bookings.customer_phone`
     (migration 0015) expose désormais un numéro en texte libre pour une
     réservation Comptoir/Téléphone créée depuis le CRM — jamais
     `users.phone` d'un vrai compte joueur, toujours absent pour MOUBARAT/
     PHONE-joueur. Décision d'Aymen du 05/09 revisitée le 15/09 : « pas
     construit » devient « construit, en texte libre, cliquable en tel: »
     dans le panneau de la résa et la fiche. */
  app.get<{ Params: { venueId: string }; Querystring: { date?: string; fieldId?: string } }>(
    '/venues/:venueId/bookings', { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      await platformGuards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
      let dayStart: number;
      try { dayStart = dayStartMs(String(req.query.date ?? '')); }
      catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }
      /* BUG-9 (audit pré-lancement, 27/09/2026) : les réservations du JOUR D'EXPLOITATION (lib/algiers.ts — de 06:00 à
         06:00 le lendemain), par heure de DÉBUT. Avant : recouvrement du jour civil [00:00, 24:00) — une réservation à
         00:00 (+1) n'apparaissait pas sur son jour et ressortait le lendemain à 0 min, avant l'ouverture ; 23:30 → 01:00
         apparaissait deux jours de suite (à −30 min le second) et comptait deux fois dans les totaux du jour. */
      const win = operatingDayWindow(dayStart);

      let query = db.selectFrom('bookings')
        .innerJoin('fields', 'fields.id', 'bookings.field_id')
        .select([
          'bookings.id', 'bookings.time_range', 'bookings.status', 'bookings.source',
          'bookings.verified_by_center', 'bookings.reservation_name', 'bookings.customer_phone', 'bookings.claim_status',
          'bookings.cancel_reason', 'bookings.format',
          'bookings.reference', 'bookings.price_total_da', 'bookings.match_id', 'bookings.created_at',
          'fields.id as field_id', 'fields.name as field_name',
        ])
        .where('fields.venue_id', '=', req.params.venueId)
        .where(sql<boolean>`lower(bookings.time_range) >= ${new Date(win.start)} AND lower(bookings.time_range) < ${new Date(win.end)}`)
        .orderBy('bookings.time_range', 'asc');
      if (req.query.fieldId) query = query.where('fields.id', '=', req.query.fieldId);

      const rows = await query.execute();

      // Roster : trois requêtes AU TOTAL pour toute la journée, jamais une par
      // match — correctif (06/09/2026, relecture Aymen) : la première version
      // batchait bien `matches` (capacity/titre), mais rechargeait
      // `match_players` PUIS `users` séparément À L'INTÉRIEUR d'une boucle sur
      // chaque match — un vrai N+1 malgré le commentaire qui prétendait
      // l'éviter. Sans risque réel à l'échelle du pilote (quelques matchs par
      // jour), mais le commentaire affirmait un batching qui n'existait qu'à
      // moitié — jamais un commentaire qui ment sur ce que fait le code.
      const matchIds = [...new Set(rows.map((r) => r.match_id).filter((id): id is string => id !== null))];
      // `status` (BUG-1, 26/09/2026) : le CRM doit VOIR qu'un match a été annulé par son organisateur alors que la
      // réservation, elle, est toujours vivante — avant, une résa « avec match » et une résa dont le match était mort
      // s'affichaient à l'identique, et la seconde restait non modifiable sans raison visible.
      const matchInfo = new Map<string, { title: string; capacity: number; organizerId: string; status: MatchRow['status'] }>();
      const matchRosters = new Map<string, { userId: string; name: string }[]>();
      if (matchIds.length > 0) {
        const matches = await db.selectFrom('matches').select(['id', 'title', 'capacity', 'organizer_id', 'status']).where('id', 'in', matchIds).execute();
        for (const m of matches) matchInfo.set(m.id, { title: m.title, capacity: m.capacity, organizerId: m.organizer_id, status: m.status });

        const allPlayerRows = await db.selectFrom('match_players').selectAll().where('match_id', 'in', matchIds).execute();
        const activeByMatch = new Map<string, { userId: string }[]>(matchIds.map((id) => [id, []]));
        for (const p of activePlayers(allPlayerRows.map(rowToMatchPlayer))) activeByMatch.get(p.matchId)!.push({ userId: p.userId });

        const allUserIds = [...new Set([...activeByMatch.values()].flatMap((ps) => ps.map((p) => p.userId)))];
        const byId = new Map<string, string>();
        if (allUserIds.length > 0) {
          const users = await db.selectFrom('users').select(['id', 'name']).where('id', 'in', allUserIds).execute();
          for (const u of users) byId.set(u.id, u.name);
        }
        for (const matchId of matchIds) {
          matchRosters.set(matchId, activeByMatch.get(matchId)!.map((p) => ({ userId: p.userId, name: byId.get(p.userId) ?? '?' })));
        }
      }

      // Abonnements — chantier CRM Abonnements (06/09/2026) : projection
      // calculée à la volée à partir de `recurring_bookings`, jamais stockée
      // ni fusionnée dans `bookings` (le core lui-même dit pourquoi : « sans
      // créer 52 réservations à la main » — availability.ts). Séparé du
      // tableau `bookings` plutôt qu'un `kind` polymorphe dedans : aucun
      // risque de faire glisser une occurrence sans prix/statut réel dans les
      // totaux encaissé/engagé/origine déjà en place ailleurs (Dashboard,
      // Analytics) — ceux-ci ne touchent jamais ce nouveau tableau.
      let recurringQuery = db.selectFrom('recurring_bookings')
        .innerJoin('fields', 'fields.id', 'recurring_bookings.field_id')
        .select([
          'recurring_bookings.id', 'recurring_bookings.field_id', 'recurring_bookings.weekday',
          'recurring_bookings.start_min', 'recurring_bookings.duration_min', 'recurring_bookings.holder_name',
          'recurring_bookings.active_from', 'recurring_bookings.active_until', 'recurring_bookings.status',
          'fields.name as field_name',
        ])
        .where('fields.venue_id', '=', req.params.venueId)
        .where('recurring_bookings.status', '=', 'ACTIVE');
      if (req.query.fieldId) recurringQuery = recurringQuery.where('fields.id', '=', req.query.fieldId);
      const recurringRows = await recurringQuery.execute();
      const weekday = weekdayOfDayStart(dayStart);
      const subscriptions = recurringRows.flatMap((r) => {
        const occ = recurringOccurrence(rowToRecurringBooking(r), weekday, dayStart);
        if (!occ) return [];
        return [{
          id: `sub-occ:${r.id}`, recurringBookingId: r.id, holderName: r.holder_name,
          fieldId: r.field_id, fieldName: r.field_name, start: occ.start, end: occ.end,
        }];
      });

      return reply.send({
        bookings: rows.map((r) => {
          const range = fromPgRange(r.time_range);
          const roster = r.match_id ? matchRosters.get(r.match_id) : undefined;
          const info = r.match_id ? matchInfo.get(r.match_id) : undefined;
          return {
            id: r.id, start: range.start, end: range.end, status: r.status, source: r.source,
            verifiedByCenter: r.verified_by_center, reservationName: r.reservation_name,
            customerPhone: r.customer_phone, claimStatus: r.claim_status, cancelReason: r.cancel_reason, format: r.format, reference: r.reference,
            priceTotalDa: r.price_total_da, matchId: r.match_id, createdAt: r.created_at.getTime(),
            fieldId: r.field_id, fieldName: r.field_name,
            // `info` existe pour tout match_id (FK) — jamais un titre ou une capacité inventés à défaut.
            ...(r.match_id && roster && info ? {
              match: {
                title: info.title, capacity: info.capacity, organizerId: info.organizerId, status: info.status,
                joinedCount: roster.length, players: roster,
              },
            } : {}),
          };
        }),
        subscriptions,
      });
    });

  /* CRM-2 (audit pré-lancement, 27/09/2026) — retrouver une réservation sans connaître son jour. L'accueil n'avait
     que les flèches « jour précédent / jour suivant » : un client qui appelle avec sa référence, ou dont on connaît le
     nom ou le numéro, obligeait à feuilleter les jours un à un. Une seule saisie `q` (2 à 80 signes) cherchée à la fois :
     - dans la RÉFÉRENCE (`GRE-001100`, contient, casse ignorée) ;
     - dans le NOM de réservation (sans accents ni casse — le nom du joueur y est copié à la création, toutes sources) ;
     - dans le TÉLÉPHONE, dès 4 chiffres, en comparant des chiffres (lib/phone-search.ts) : le texte libre du comptoir
       (`customer_phone`) pour tous ; le numéro du COMPTE joueur (`users.phone`) seulement pour un rôle qui a VIEW_CLIENTS
       (Réception et au-dessus) — un simple Staff ne voit pas les numéros des clients (écran Clients refusé), une
       recherche par numéro lui rendrait sinon « ce numéro = cette personne ». Jamais le compte plateforme du membre du
       staff qui a saisi une résa comptoir/téléphone (même garde que l'écran Clients).
     Les plus récentes d'abord (heure de début décroissante), paginée par curseur, chaque ligne datée de son JOUR
     D'EXPLOITATION (BUG-9) — c'est la date que le CRM ouvre pour afficher la fiche. Même permission que le planning
     (VIEW_PLANNING), mêmes champs que la liste du jour (sans le roster du match, inutile ici). Un blocage centre n'est pas
     une réservation. Aucun index dédié : la recherche parcourt les réservations DU CENTRE (quelques milliers par an) —
     mesuré acceptable pour le pilote ; à indexer (référence, trigrammes) si un centre dépasse ~100 000 lignes. */
  app.get<{ Params: { venueId: string }; Querystring: { q?: string; limit?: string; cursor?: string } }>(
    '/venues/:venueId/bookings/search', { preHandler: (req) => platformGuards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await platformGuards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
      const q = (req.query.q ?? '').trim();
      if (q.length < 2) throw badRequest('Recherche trop courte (2 caractères au moins).');
      if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
      const limit = pageLimit(req.query.limit, { def: 30, max: 100 });
      const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
      const seesClientPhones = canCenterAct(role, 'VIEW_CLIENTS').ok;
      const nameRe = accentInsensitiveRegex(q);
      const refLike = containsLike(q);
      const phones = phoneSearchPatterns(q);

      const alternatives = [
        sql<boolean>`bookings.reservation_name ~* ${nameRe}`,
        sql<boolean>`bookings.reference ILIKE ${refLike} ESCAPE '\\'`,
      ];
      if (phones) {
        alternatives.push(sql<boolean>`regexp_replace(coalesce(bookings.customer_phone, ''), '\\D', '', 'g') LIKE ANY(${phones}::text[])`);
        if (seesClientPhones) {
          alternatives.push(sql<boolean>`(
            bookings.source <> 'WALK_IN'
            AND NOT EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.id = bookings.by_user_id)
            AND regexp_replace(coalesce(users.phone, ''), '\\D', '', 'g') LIKE ANY(${phones}::text[])
          )`);
        }
      }

      let query = db.selectFrom('bookings')
        .innerJoin('fields', 'fields.id', 'bookings.field_id')
        .leftJoin('users', 'users.id', 'bookings.by_user_id')
        .select([
          'bookings.id', 'bookings.time_range', 'bookings.status', 'bookings.source',
          'bookings.verified_by_center', 'bookings.reservation_name', 'bookings.customer_phone', 'bookings.claim_status',
          'bookings.reference', 'bookings.price_total_da', 'bookings.match_id',
          'fields.id as field_id', 'fields.name as field_name',
        ])
        .select(isoMicros(sql`lower(bookings.time_range)`).as('start_cursor'))
        .where('fields.venue_id', '=', req.params.venueId)
        .where('bookings.source', '!=', 'CENTER')
        .where(sql<boolean>`(${sql.join(alternatives, sql` OR `)})`)
        .orderBy(sql`lower(bookings.time_range)`, 'desc')
        .orderBy('bookings.id', 'desc')
        .limit(limit + 1);
      if (cursor) {
        query = query.where(sql<boolean>`(lower(bookings.time_range), bookings.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
      }
      const rows = await query.execute();
      const page = pageOf(rows, limit, (r) => [r.start_cursor, r.id]);
      return reply.send({
        bookings: page.items.map((r) => {
          const range = fromPgRange(r.time_range);
          return {
            id: r.id, date: operatingDateOf(range.start), start: range.start, end: range.end,
            status: r.status, source: r.source, verifiedByCenter: r.verified_by_center,
            reservationName: r.reservation_name, customerPhone: r.customer_phone, claimStatus: r.claim_status, reference: r.reference,
            priceTotalDa: r.price_total_da, matchId: r.match_id, fieldId: r.field_id, fieldName: r.field_name,
          };
        }),
        nextCursor: page.nextCursor,
      });
    });
}
