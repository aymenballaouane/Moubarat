import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import {
  RECIPIENTS, matchLeaveKind, activePlayers, canCancelBooking, canOrganizerAct, canTransition, changeTeam, createMatch, defaultTeam, joinMatch, leaveMatch,
  removePlayer, MATCH_TRANSITIONS, MATCH_TEAMS,
  type MatchFormat, type MatchTeam, type SkillLevel,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { writeNotifications } from '../../notifications/write.js';
import { assertNotRestricted, recordAbsence } from '../absences/service.js';
import { notifyDayAlerts, notifyFilling, notifySpotFreed } from '../notifications/alerts.js';
import { withCommittedPush } from '../../notifications/push.js';
import { sweepMatchReminders } from '../notifications/reminders.js';
import { toPgRange } from '../../lib/pgrange.js';
import { decodeCursor, isoMicros, pageLimit, pageOf } from '../../lib/cursor.js';
import { algiersDateOf, dayStartMs } from '../../lib/algiers.js';
import { feedConditions, feedDayCounts, parseFeedFilters, type FeedQuery } from './feed.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { rowToBooking } from '../bookings/service.js';
import {
  friendsUpcomingMatches, loadMatchForUpdate, markEndedMatchesPlayed, loadMatch, loadPlayers, publicMatch, rowToMatch, rowToMatchPlayer,
  syncMatchLifecycle, userCommitments, withRosterCounts, describeConflict, assertPhoneVisible,
} from './service.js';

interface Deps { db: Db; guards: Guards; }

const SKILL_LEVELS = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'] as const;
const SPORTS = ['FOOTBALL', 'PADEL', 'BASKET'] as const;

async function playersWithNames(db: Db, matchId: string) {
  const rows = await loadPlayers(db, matchId);
  // « Inscrit » = la définition core (activePlayers), jamais un filtre local
  // réécrit à côté — même si le prédicat est trivial (status === 'JOINED').
  const active = activePlayers(rows.map(rowToMatchPlayer));
  if (active.length === 0) return [];
  const users = await db.selectFrom('users').select(['id', 'name'])
    .where('id', 'in', active.map((p) => p.userId)).execute();
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return active.map((p) => ({ userId: p.userId, name: byId.get(p.userId) ?? '?', joinedAt: p.joinedAt, team: p.team ?? null }));
}

/** Règle 3 : inscrits par équipe, SANS un seul nom — de quoi montrer à un visiteur les places libres de chaque équipe. */
async function teamCountsOf(db: Db, matchId: string): Promise<{ A: number; B: number }> {
  const rows = await db.selectFrom('match_players').select(['team', (eb) => eb.fn.countAll<string>().as('n')])
    .where('match_id', '=', matchId).where('status', '=', 'JOINED').where('team', 'is not', null).groupBy('team').execute();
  const counts = { A: 0, B: 0 };
  for (const r of rows) if (r.team === 'A' || r.team === 'B') counts[r.team] = Number(r.n);
  return counts;
}

/** Règle 3 : « team » du corps — absente = l'équipe qui a le plus de places (choisie d'office par l'app aussi) ; sinon A ou B. */
function parseTeam(raw: unknown): MatchTeam | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && (MATCH_TEAMS as readonly string[]).includes(raw)) return raw as MatchTeam;
  throw badRequest('Équipe invalide : A ou B.', 'BAD_TEAM');
}

/** Le mot de l'organisateur : texte brut, rogné, 280 signes au plus (maquette MotAuxJoueurs « 139 / 280 »), vide = pas de mot. */
export const NOTE_MAX = 280;
function parseNote(raw: unknown): string {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw badRequest('note doit être un texte.');
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note.length > NOTE_MAX) throw badRequest('Le mot aux joueurs est limité à ' + NOTE_MAX + ' signes.', 'NOTE_TOO_LONG');
  return note;
}

/** Lien d'invitation d'un groupe WhatsApp (règle 10) : https://chat.whatsapp.com/<code> — rien d'autre n'est enregistré. */
const WHATSAPP_GROUP_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]{10,40}$/;

/** Nombre d'inscrits (« Inscrit » = la définition core, `activePlayers` : status JOINED) SANS lire un seul nom — de quoi
    afficher les places restantes à un visiteur (audit du 25/09/2026, P0-5). */
async function joinedCount(db: Db, matchId: string): Promise<number> {
  const row = await db.selectFrom('match_players').select((eb) => eb.fn.countAll<string>().as('n'))
    .where('match_id', '=', matchId).where('status', '=', 'JOINED').executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Seul l'organisateur modifie son match (mot, groupe) — et plus une fois annulé ou joué. */
function assertCanEditOwnMatch(row: { organizer_id: string; status: string }, userId: string): void {
  if (row.organizer_id !== userId) throw new ApiError(403, 'NOT_ORGANIZER', 'Seul l’organisateur peut faire cela.');
  if (row.status === 'CANCELLED' || row.status === 'PLAYED') throw new ApiError(409, 'MATCH_NOT_OPEN', 'Ce match est terminé ou annulé.');
}

export async function registerMatchRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Création — TOUJOURS depuis une réservation déjà posée (chemin B — le
     chemin A « réserver puis créer dans la foulée » s'obtient en enchaînant
     POST /bookings puis POST /matches, mêmes briques). L'organisateur est
     forcément celui qui a réservé — un match n'appartient pas à un tiers. */
  app.post<{
    Body: { bookingId?: string; title?: string; level?: string; capacity?: number; visibility?: string; note?: string };
  }>('/matches', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const bookingId = String(b.bookingId ?? '');
    if (!bookingId) throw badRequest('bookingId manquant.');
    const level = String(b.level ?? 'LOISIR');
    if (!(SKILL_LEVELS as readonly string[]).includes(level)) {
      throw badRequest('Niveau invalide : LOISIR, INTERMEDIAIRE ou COMPETITION.');
    }
    let capacity: number | undefined;
    if (b.capacity !== undefined) {
      capacity = Number(b.capacity);
      if (!Number.isInteger(capacity)) throw badRequest('capacity doit être un entier.');
    }
    const visibility = b.visibility === 'PRIVATE' ? 'PRIVATE' : 'OPEN';
    /* « Un petit mot pour les joueurs » (lot 6) : facultatif, texte brut, 280 signes au plus ; vide = pas de mot. */
    const note = parseNote(b.note);
    const now = Date.now();

    const created = await withCommittedPush(() => db.transaction().execute(async (trx) => {
      const bookingRow = await trx.selectFrom('bookings').selectAll()
        .where('id', '=', bookingId).forUpdate().executeTakeFirst();
      if (!bookingRow) throw notFound('Réservation introuvable.');
      if (bookingRow.by_user_id !== req.auth!.userId) {
        throw new ApiError(403, 'FORBIDDEN', 'Cette réservation n’est pas la vôtre.');
      }
      const field = await trx.selectFrom('fields').select(['id', 'sport', 'formats', 'venue_id'])
        .where('id', '=', bookingRow.field_id).executeTakeFirstOrThrow();

      /* Le format d'un match hérite de celui FIXÉ sur la réservation
         (16/09/2026, demande d'Aymen) — jamais un choix libre de
         l'organisateur, b.format n'est plus lu. Résa historique ou terrain à
         un seul format à l'époque (bookingRow.format NULL) : déduit du
         terrain SI il n'a réellement qu'un seul format aujourd'hui — le refus
         (FORMAT_REQUIRED) ne s'applique que si le terrain en a réellement
         plusieurs et qu'aucun n'est fixé sur la résa (confirmation explicite
         d'Aymen, 16/09/2026, point 1). */
      let matchFormat: MatchFormat;
      if (bookingRow.format !== null) {
        matchFormat = bookingRow.format;
      } else if (field.formats.length === 1) {
        matchFormat = field.formats[0]!;
      } else {
        throw badRequest(
          'Le format de cette réservation n’est pas connu et ce terrain en propose plusieurs — impossible de créer le match automatiquement.',
          'FORMAT_REQUIRED',
        );
      }

      const result = createMatch({
        id: '',
        booking: rowToBooking(bookingRow),
        field: { id: field.id, sport: field.sport, formats: field.formats },
        venueId: field.venue_id,
        title: String(b.title ?? ''),
        format: matchFormat,
        level: level as SkillLevel,
        ...(capacity !== undefined ? { capacity } : {}),
        visibility,
        organizerId: req.auth!.userId,
        now,
      });
      must(result.result);
      const match = result.match!;

      const row = await trx.insertInto('matches').values({
        sport: match.sport, format: match.format, level: match.level, title: match.title,
        venue_id: match.venueId, field_id: match.fieldId, time_range: toPgRange(match.range),
        capacity: match.capacity, price_per_player_da: match.pricePerPlayer.amount,
        visibility: match.visibility, status: match.status, organizer_id: match.organizerId,
        booking_id: match.bookingId ?? null, coordination: 'WHATSAPP', note: note === '' ? null : note,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('match_players').values({
        match_id: row.id, user_id: req.auth!.userId, status: 'JOINED', joined_at: new Date(match.createdAt), team: 'A',
      }).execute();
      await trx.updateTable('bookings').set({ match_id: row.id }).where('id', '=', bookingId).execute();
      // Lot 11 : « M'alerter si un match est créé » — les joueurs qui l'ont demandé pour ce jour-là sont prévenus (push + dans l'app, jamais de SMS).
      await notifyDayAlerts(trx, row, now);
      return row;
    }));

    return reply.code(201).send({ match: publicMatch(created, { group: true, code: true }) });
  });

  /* Un match OPEN se consulte sans compte (l'app doit pouvoir le montrer
     avant inscription, même logique que /venues et /fields/:id/availability
     en Phase 1). Un match PRIVATE (issu d'un défi) est réservé à
     l'organisateur et aux inscrits — faille trouvée en revue sécurité : la
     visibilité déclarée par le core (`Match.visibility`) n'était vérifiée
     nulle part à la lecture directe, seul le listing /matches la respectait. */
  /* Le lien d'un match (LienMatch.dc.html, « app.moubaratsport.com/m/CODE ») : la fiche publique d'un match À PARTIR DE SON CODE — l'invitation elle-même. Valable aussi pour
     un match « sur invitation » (règle 6 : il n'est accessible que par son lien) ; un visiteur sans compte reçoit la fiche sans un nom d'inscrit (P0-5), plus le prénom de
     l'organisateur (« Yanis t'invite à jouer »). */
  app.get<{ Params: { code: string } }>('/matches/by-code/:code',
    { preHandler: (req) => guards.tryAuth(req) }, async (req, reply) => {
      const code = String(req.params.code).trim().toUpperCase();
      if (!/^[A-Z2-9]{4,10}$/.test(code)) throw notFound('Ce lien ne mène à aucun match.');
      const found = await db.selectFrom('matches').selectAll().where('code', '=', code).executeTakeFirst();
      if (!found) throw notFound('Ce lien ne mène à aucun match.');
      const synced = await syncMatchLifecycle(db, found, Date.now());
      const organizer = await db.selectFrom('users').select('name').where('id', '=', synced.organizer_id).executeTakeFirst();
      const organizerName = organizer?.name ?? null;
      // Ce que montre la page du lien à un visiteur (LienMatch) : le centre et le terrain — des informations publiques (GET /venues).
      const place = await db.selectFrom('fields').innerJoin('venues', 'venues.id', 'fields.venue_id')
        .select(['venues.name as venueName', 'fields.name as fieldName']).where('fields.id', '=', synced.field_id).executeTakeFirst();
      if (!req.auth) {
        return reply.send({
          match: { ...publicMatch(synced, { code: true }), joinedCount: await joinedCount(db, synced.id), teamCounts: await teamCountsOf(db, synced.id), players: [], rosterHidden: true },
          organizerName, venueName: place?.venueName ?? null, fieldName: place?.fieldName ?? null,
        });
      }
      const players = await playersWithNames(db, synced.id);
      const seesGroup = req.auth.userId === synced.organizer_id || players.some((p) => p.userId === req.auth!.userId);
      return reply.send({
        match: { ...publicMatch(synced, { group: seesGroup, code: true }), joinedCount: players.length, teamCounts: await teamCountsOf(db, synced.id), players },
        organizerName, venueName: place?.venueName ?? null, fieldName: place?.fieldName ?? null,
      });
    });

  app.get<{ Params: { id: string } }>('/matches/:id',
    { preHandler: (req) => guards.tryAuth(req) }, async (req, reply) => {
      const row = await loadMatch(db, req.params.id);
      if (row.visibility === 'PRIVATE') {
        const allowed = req.auth && (
          req.auth.userId === row.organizer_id
          || await db.selectFrom('match_players').select('user_id')
            .where('match_id', '=', row.id).where('user_id', '=', req.auth.userId)
            .where('status', '=', 'JOINED').executeTakeFirst() !== undefined
        );
        if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'Ce match est privé.');
      }
      const now = Date.now();
      const synced = await syncMatchLifecycle(db, row, now);
      /* Lot P1, point 6 — l'ouverture d'une fiche de match est aussi un
         point de balayage du rappel H-2 (voir notifications/reminders.ts). */
      if (req.auth) await sweepMatchReminders(db, req.auth.userId, now);
      /* Audit juridique et technique du 25/09/2026, P0-5 (décision d'Aymen) — la LISTE NOMINATIVE des inscrits exige un
         compte connecté, même pour un match ouvert : avant, tout visiteur non authentifié lisait le nom complet et
         l'identifiant de chaque inscrit de tout match, sans expiration. Ce qui reste PUBLIC, sans compte, parce que
         c'est ce qui donne envie de s'inscrire : sport, niveau, horaire, lieu, prix, capacité et NOMBRE d'inscrits
         (donc les places restantes). Un visiteur reçoit `players: []` et `rosterHidden: true` : jamais une liste
         vide qui laisserait croire que personne n'est inscrit. */
      if (!req.auth) {
        return reply.send({
          match: { ...publicMatch(synced), joinedCount: await joinedCount(db, synced.id), teamCounts: await teamCountsOf(db, synced.id), players: [], rosterHidden: true },
        });
      }
      const players = await playersWithNames(db, synced.id);
      // Règle 10 : le lien du groupe WhatsApp, seulement pour l'organisateur et les inscrits.
      const seesGroup = req.auth.userId === synced.organizer_id || players.some((p) => p.userId === req.auth!.userId);
      return reply.send({ match: { ...publicMatch(synced, { group: seesGroup, code: seesGroup }), joinedCount: players.length, teamCounts: await teamCountsOf(db, synced.id), players } });
    });

  /* Règle 31 (PRÉCISÉE par Aymen le 26/10/2026 — elle remplace sa décision du 25/09/2026 « aucun numéro entre joueurs ») : « Appeler ».
     Le numéro d'un joueur n'est servi qu'à l'organisateur des matchs que ce joueur a rejoints, et le numéro de l'organisateur aux joueurs
     inscrits à son match — jamais à un tiers, jamais entre deux inscrits, jamais à un visiteur. ET seulement si le joueur dont on sert le
     numéro a l'accord « numéro visible » (règles 30 et 32 : `profiles.phone_visible` explicitement vrai — un compte sans profil n'a rien accordé).
     Un match annulé ou joué ne sert plus rien (on ne coordonne plus). Un joueur parti (LEFT) ou retiré (REMOVED) n'est plus joignable. Aucune
     autre route ne sert un numéro (test balai tests/player-phone-exposure.test.ts). */
  app.get<{ Params: { id: string } }>('/matches/:id/contacts',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const row = await loadMatch(db, req.params.id);
      if (row.status === 'CANCELLED' || row.status === 'PLAYED') return reply.send({ contacts: [] });
      const me = req.auth!.userId;
      const joined = await db.selectFrom('match_players')
        .innerJoin('users', 'users.id', 'match_players.user_id')
        .innerJoin('profiles', 'profiles.user_id', 'users.id')
        .select(['users.id as user_id', 'users.phone as phone'])
        .where('match_players.match_id', '=', row.id).where('match_players.status', '=', 'JOINED')
        .where('profiles.phone_visible', '=', true).where('users.deleted_at', 'is', null)
        .execute();
      let contacts: { userId: string; phone: string }[] = [];
      if (me === row.organizer_id) {
        contacts = joined.filter((j) => j.user_id !== me).map((j) => ({ userId: j.user_id, phone: j.phone }));
      } else {
        const iAmIn = await db.selectFrom('match_players').select('user_id')
          .where('match_id', '=', row.id).where('user_id', '=', me).where('status', '=', 'JOINED').executeTakeFirst();
        if (iAmIn) {
          const organizer = joined.find((j) => j.user_id === row.organizer_id);
          if (organizer) contacts = [{ userId: organizer.user_id, phone: organizer.phone }];
        }
      }
      return reply.send({ contacts });
    });

  /* Explorer — matchs publics ouverts, à venir. tryAuth (best-effort, jamais
     bloquant) : un visiteur anonyme voit la liste comme avant, un appelant
     identifié voit en plus s'il est déjà inscrit à chaque match (viewerJoined,
     via withRosterCounts) — nécessaire à MatchCard côté apps/player, qui ne
     peut pas dériver la jauge/l'état « Inscrit » sans un roster.

     F2 (cadrage multi-centre/scalabilité, 22/09/2026) : `status` est mis à jour
     PARESSEUSEMENT (syncMatchLifecycle, au contact d'UN match précis) — un match
     resté OPEN/FULL en base parce que personne ne l'a rouvert restait dans ce fil
     indéfiniment une fois son horaire passé, triant AVANT les vrais matchs à venir
     (vérifié sur la base pilote : les 5 matchs "ouverts" affichés avaient tous déjà
     eu lieu). Le filtre `upper(time_range) > now` exclut tout match dont l'horaire
     est terminé, indépendamment du statut stocké — jamais besoin d'appeler
     syncMatchLifecycle (coûteux, une écriture par ligne) juste pour afficher un
     fil : la vérité vient de l'horaire réel, le statut stocké reste une
     optimisation d'affichage, corrigée par le rattrapage périodique (palier 2,
     tâche planifiée) quand il existera. Index dédié : migration 0025.

     L3 (mise à l'échelle, 25/09/2026) : FILTRES SERVEUR et curseur — `sport`, `venueId`, `day` (YYYY-MM-DD, jour
     d'Alger), `evening=1` (début à 18 h ou plus tard), `weekend=1`, `q` (titre/format, sans accents ni casse), puis
     `limit` (défaut 50 = l'ancien plafond, max 100) et `cursor`. Réponse : les mêmes `matches` plus `nextCursor`, et
     `total` (nombre de matchs correspondant aux filtres) sur la PREMIÈRE page seulement. Détail : ./feed.ts. */
  app.get<{ Querystring: FeedQuery & { limit?: string; cursor?: string } }>('/matches',
    { preHandler: (req) => guards.tryAuth(req) }, async (req, reply) => {
      const now = new Date();
      const filters = parseFeedFilters(req.query);
      const limit = pageLimit(req.query.limit, { def: 50, max: 100 });
      const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
      const conds = feedConditions(filters, now);

      let query = db.selectFrom('matches').selectAll()
        .select(isoMicros(sql`lower(matches.time_range)`).as('start_cursor'));
      for (const c of conds) query = query.where(c);
      if (cursor) query = query.where(sql<boolean>`(lower(matches.time_range), matches.id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
      const rows = await query
        .orderBy(sql`lower(matches.time_range)`, 'asc').orderBy('matches.id', 'asc')
        .limit(limit + 1).execute();
      const page = pageOf(rows, limit, (r) => [r.start_cursor, r.id]);

      let total: number | undefined;
      if (!cursor) {
        let count = db.selectFrom('matches').select(sql<string>`count(*)::text`.as('n'));
        for (const c of conds) count = count.where(c);
        total = Number((await count.executeTakeFirstOrThrow()).n);
      }
      return reply.send({
        matches: await withRosterCounts(db, page.items, req.auth?.userId),
        nextCursor: page.nextCursor,
        ...(total !== undefined ? { total } : {}),
      });
    });

  /* Décompte des matchs du fil PAR JOUR d'Alger (bandeau de jours de l'Explorer) : `from` (YYYY-MM-DD, défaut
     aujourd'hui), `days` (1 à 62 — le calendrier « Choisis un jour » —, défaut 7), `sport`, `venueId`. Jours sans match absents de `counts`. Public, comme le fil. */
  app.get<{ Querystring: { sport?: string; venueId?: string; from?: string; days?: string } }>('/matches/day-counts', async (req, reply) => {
    const now = new Date();
    const { sport, venueId } = parseFeedFilters(req.query);
    const days = pageLimit(req.query.days, { def: 7, max: 62 });
    let fromStart: number;
    try { fromStart = dayStartMs(req.query.from ?? algiersDateOf(now.getTime())); }
    catch { throw badRequest('Paramètre from attendu au format YYYY-MM-DD.'); }
    const counts = await feedDayCounts(db, { ...(sport ? { sport } : {}), ...(venueId ? { venueId } : {}) }, fromStart, days, now);
    return reply.send({ from: algiersDateOf(fromStart), days, counts });
  });

  /* Mes matchs — organisés ou rejoints. */
  // Audit multi-centre 22/09/2026 (socle 2e centre, cadrage §2) : aucune limite ici jusqu'ici — un joueur
  // très engagé (organisateur/inscrit de centaines de matchs sur la durée) chargeait la table entière à
  // chaque ouverture de l'app. Même plafond que /matches (50) doublé pour ne rien couper en pratique
  // aujourd'hui : un joueur réel n'a jamais 100 matchs à venir + passés simultanément, mais l'app n'a pas
  // encore de pagination (Historique lit cette même route) — 100 laisse de la marge sans être unbounded.
  // L3 (25/09/2026) : curseur — `limit` absent = 100 (l'ancien plafond) ; réponse = les mêmes `matches` plus
  // `nextCursor` ; tri : début le plus récent d'abord, départagé par id (lib/cursor.ts).
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/me/matches',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const limit = pageLimit(req.query.limit, { def: 100, max: 100 });
    const cursor = decodeCursor(req.query.cursor, ['iso', 'uuid']);
    // Audit final 26/10/2026 (P1-1) : un match fini passe PLAYED avant d'être servi — sinon « Mes matchs » le garde dans « À venir » (statut resté LOCKED).
    await markEndedMatchesPlayed(db, Date.now(), req.auth!.userId);
    let query = db.selectFrom('matches')
      .leftJoin('match_players', (join) => join
        .onRef('match_players.match_id', '=', 'matches.id')
        .on('match_players.user_id', '=', req.auth!.userId)
        .on('match_players.status', '=', 'JOINED'))
      .selectAll('matches')
      .select(isoMicros(sql`lower(matches.time_range)`).as('start_cursor'))
      .where((eb) => eb.or([
        eb('matches.organizer_id', '=', req.auth!.userId),
        eb('match_players.user_id', '=', req.auth!.userId),
      ]));
    if (cursor) query = query.where(sql<boolean>`(lower(matches.time_range), matches.id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
    const rows = await query
      .orderBy(sql`lower(matches.time_range)`, 'desc').orderBy('matches.id', 'desc')
      .limit(limit + 1).execute();
    const page = pageOf(rows, limit, (r) => [r.start_cursor, r.id]);
    return reply.send({ matches: await withRosterCounts(db, page.items, req.auth!.userId), nextCursor: page.nextCursor });
  });

  /* Home « Tes amis jouent bientôt » (règle 40, GO d'Aymen 25/10/2026) — lecture seule, hors
     packages/core : voir friendsUpcomingMatches, service.ts. Bornée (10 coéquipiers au plus,
     7 jours), donc pas de curseur ici. */
  app.get('/me/friends-matches', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const matches = await friendsUpcomingMatches(db, req.auth!.userId, new Date());
    return reply.send({ matches });
  });

  /* Rejoindre — conflit d'agenda vérifié contre matchs ET réservations. */
  app.post<{ Params: { id: string }; Body: { team?: string } }>('/matches/:id/join',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const wantedTeam = parseTeam((req.body ?? {}).team);
      // Correctif (05/09/2026, relecture Aymen) : le push déclenché par
      // writeNotifications() ci-dessous n'attend plus rien de moins que
      // cette transaction réellement validée — voir withCommittedPush,
      // notifications/push.ts.
      await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        // Un match ISSU D'UN DÉFI (challenge_id non nul) a un effectif fermé :
        // les deux capitaines, inscrits d'office à l'acceptation — jamais un
        // tiers. Le core ne le vérifie pas lui-même (canJoinMatch ignore
        // visibility) ; sans cette garde, un troisième joueur pourrait s'y
        // inscrire et invaliderait la lecture HOME/AWAY (organisateur vs
        // unique adversaire) utilisée pour le winRate de l'OVR (voir
        // docs/DECISIONS.md). Portée volontairement sur challenge_id, PAS sur
        // visibility === 'PRIVATE' : un match PRIVATE ordinaire (POST /matches
        // avec visibility fourni par l'organisateur, hors défi) reste ouvert
        // aux tiers comme avant cette tranche — visibility ne fait que le
        // masquer du listing public, ce n'était jamais une restriction de
        // rejoint. Régression trouvée en revue (le garde bloquait à tort tout
        // match PRIVATE non issu d'un défi, avec un message d'erreur faux).
        if (row.challenge_id !== null) {
          throw badRequest('Ce match est réservé aux deux équipes du défi.', 'MATCH_PRIVATE');
        }
        await assertPhoneVisible(trx, req.auth!.userId);   // règle 32
        await assertNotRestricted(trx, req.auth!.userId, now);   // règle 25
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        /* Règle 8 / 24 : le joueur retiré par l'organisateur le sait par un code à part (fenêtre PasPossibleRetire), pas par un FORBIDDEN générique. */
        if (players.some((p) => p.userId === req.auth!.userId && p.status === 'REMOVED') && row.status !== 'CANCELLED' && row.status !== 'PLAYED') {
          throw new ApiError(403, 'REMOVED_FROM_MATCH', 'L’organisateur t’a retiré de ce match : tu ne peux plus y reprendre de place.');
        }
        const commitments = await userCommitments(trx, req.auth!.userId, row.id);
        /* Règle 3 : sans équipe demandée, l'équipe qui a le plus de places (A à égalité) — jamais un inscrit sans équipe. */
        const team = wantedTeam ?? defaultTeam(rowToMatch(row), players) ?? undefined;
        const result = joinMatch(rowToMatch(row), players, req.auth!.userId, commitments, now, team);
        if (!result.result.ok && result.result.code === 'SCHEDULE_CONFLICT') {
          const conflict = await describeConflict(trx, req.auth!.userId, rowToMatch(row).range, row.id);
          throw new ApiError(400, 'SCHEDULE_CONFLICT', result.result.message, conflict ?? undefined);
        }
        must(result.result);
        // Upsert : un joueur qui a déjà quitté ce match (LEFT) porte encore
        // une ligne (clé composite match_id+user_id) — le core « ajoute » un
        // nouvel inscrit dans son modèle en mémoire, la base doit RÉUTILISER
        // la ligne existante plutôt que la dupliquer (elle le refuserait).
        await trx.insertInto('match_players').values({
          match_id: row.id, user_id: req.auth!.userId, status: 'JOINED', joined_at: new Date(now), team: team ?? null,
        }).onConflict((oc) => oc.columns(['match_id', 'user_id'])
          .doUpdateSet({ status: 'JOINED', joined_at: new Date(now), team: team ?? null, left_at: null })).execute();
        if (result.status && result.status !== row.status) {
          await trx.updateTable('matches').set({ status: result.status }).where('id', '=', row.id).execute();
        }
        await writeNotifications(trx, RECIPIENTS.playerJoined(row.organizer_id), 'PLAYER_JOINED', row.id, now, undefined, req.auth!.userId);
        // Il a la place : plus besoin de la lui signaler. Puis « Ton match se remplit » (règle 38, une seule fois, à 70 %).
        await trx.deleteFrom('match_watchers').where('match_id', '=', row.id).where('user_id', '=', req.auth!.userId).execute();
        await notifyFilling(trx, row, activePlayers(players).length + 1, now);
      }));
      return reply.send({ ok: true });
    });

  /* Règle 10 — le groupe WhatsApp du match : facultatif, ajouté (ou changé, ou retiré) par l'ORGANISATEUR seul. Seul un lien
     https://chat.whatsapp.com/… est accepté ; `url: null` le retire. Les inscrits le lisent dans GET /matches/:id, jamais dans une liste. */
  app.put<{ Params: { id: string }; Body: { url?: string | null } }>('/matches/:id/whatsapp',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const raw = (req.body ?? {}).url;
      let url: string | null = null;
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== 'string' || !WHATSAPP_GROUP_RE.test(raw.trim())) {
          throw badRequest('Colle le lien d’invitation de ton groupe : https://chat.whatsapp.com/…', 'BAD_WHATSAPP_URL');
        }
        url = raw.trim();
      }
      await db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        assertCanEditOwnMatch(row, req.auth!.userId);
        await trx.updateTable('matches').set({ whatsapp_url: url }).where('id', '=', row.id).execute();
      });
      return reply.send({ ok: true, url });
    });

  /* « Ton mot aux joueurs » (MotAuxJoueurs.dc.html) : l'organisateur le modifie tant que le match n'est ni annulé ni joué. */
  app.put<{ Params: { id: string }; Body: { note?: string | null } }>('/matches/:id/note',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const note = parseNote((req.body ?? {}).note);
      await db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        assertCanEditOwnMatch(row, req.auth!.userId);
        await trx.updateTable('matches').set({ note: note === '' ? null : note }).where('id', '=', row.id).execute();
      });
      return reply.send({ ok: true, note: note === '' ? null : note });
    });

  /* Règle 3 — changer d'équipe tant que les inscriptions sont ouvertes : le core (changeTeam) tranche (inscrit, verrou, place dans
     l'autre équipe) ; la ligne est mise à jour sous le verrou du match, comme rejoindre/quitter. */
  app.post<{ Params: { id: string }; Body: { team?: string } }>('/matches/:id/team',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const team = parseTeam((req.body ?? {}).team);
      if (team === undefined) throw badRequest('Choisis une équipe : A ou B.', 'BAD_TEAM');
      await db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        const result = changeTeam(rowToMatch(row), players, req.auth!.userId, team, now);
        must(result.result);
        await trx.updateTable('match_players').set({ team })
          .where('match_id', '=', row.id).where('user_id', '=', req.auth!.userId).where('status', '=', 'JOINED').execute();
      });
      return reply.send({ ok: true });
    });

  /* Quitter — règle 4 (MODIFIÉE, trois temps) : libre jusqu'à H-2 ; de H-2 à H-1 possible mais c'est une demi-absence (`left_at` en garde la trace, `matchLeaveKind`)
     et la place est reproposée ; à partir de H-1 la composition est figée (400 CANCEL_WINDOW_PASSED). */
  app.post<{ Params: { id: string } }>('/matches/:id/leave',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      // Correctif (05/09/2026) : voir withCommittedPush, notifications/push.ts.
      await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        // Garde API (le core `leaveMatch` ne le distingue pas de tout autre
        // joueur — symétrique de `removePlayer`, qui refuse explicitement
        // que l'organisateur se retire lui-même) : l'organisateur annule,
        // il ne « quitte » pas — sans quoi le match reste orphelin de règles
        // (organizer_id pointerait vers quelqu'un qui n'est plus inscrit).
        if (row.organizer_id === req.auth!.userId) {
          throw new ApiError(400, 'FORBIDDEN', 'L’organisateur ne quitte pas son match — il l’annule.');
        }
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        const result = leaveMatch(rowToMatch(row), players, req.auth!.userId, now);
        must(result.result);
        await trx.updateTable('match_players').set({ status: 'LEFT', left_at: new Date(now) })
          .where('match_id', '=', row.id).where('user_id', '=', req.auth!.userId).execute();
        if (result.status && result.status !== row.status) {
          await trx.updateTable('matches').set({ status: result.status }).where('id', '=', row.id).execute();
        }
        // Règle 4 (trois temps) + règle 25 : partir entre H-2 et H-1 est une DEMI-absence — deux demi-absences valent une absence pour la restriction.
        if (matchLeaveKind({ range: rowToMatch(row).range }, now) === 'LATE') {
          await recordAbsence(trx, { userId: req.auth!.userId, kind: 'HALF', source: 'LATE_LEAVE', matchId: row.id, now });
        }
        if (row.organizer_id !== req.auth!.userId) {
          await writeNotifications(trx, RECIPIENTS.playerLeft(row.organizer_id), 'PLAYER_LEFT', row.id, now, undefined, req.auth!.userId);
        }
        // Lot 11 : la place libérée est annoncée à ceux qui l'ont demandée — et, de H-2 à H-1, aux joueurs de la ville (règle 4 : « la place est reproposée »).
        await notifySpotFreed(trx, row, req.auth!.userId, now);
      }));
      return reply.send({ ok: true });
    });

  /* Retrait par l'organisateur — jamais lui-même, un joueur retiré ne revient pas.
     BUG-5 (audit pré-lancement, 27/09/2026) : le joueur retiré est PRÉVENU (PLAYER_REMOVED, push) — avant, il
     découvrait sur place que sa place « garantie » n'existait plus. Push différé après le commit réel. */
  app.post<{ Params: { id: string; userId: string } }>('/matches/:id/players/:userId/remove',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const row = await loadMatchForUpdate(trx, req.params.id);
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        const result = removePlayer(rowToMatch(row), players, req.auth!.userId, req.params.userId, now);
        must(result.result);
        await trx.updateTable('match_players').set({ status: 'REMOVED' })
          .where('match_id', '=', row.id).where('user_id', '=', req.params.userId).execute();
        if (result.status && result.status !== row.status) {
          await trx.updateTable('matches').set({ status: result.status }).where('id', '=', row.id).execute();
        }
        await writeNotifications(trx, RECIPIENTS.playerRemoved(req.params.userId), 'PLAYER_REMOVED', row.id, now);
        await notifySpotFreed(trx, row, req.params.userId, now);
      }));
      return reply.send({ ok: true });
    });

  /* Fermeture des inscriptions — organisateur seul, verrouille manuellement
     avant l'heure (Lot 3B, étape 3 : mutation déjà réelle côté store local
     du player, ajoutée ici pour ne plus laisser un « faux succès » survivre
     dans OrganizerMatchView à côté d'annuler/retirer, désormais réels). Pas
     de réouverture symétrique : le core n'offre aucune transition
     LOCKED → OPEN/FULL (décision produit déjà actée, DECISIONS.md §13). */
  app.post<{ Params: { id: string } }>('/matches/:id/close-registrations',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      await db.transaction().execute(async (trx) => {
        const row = await syncMatchLifecycle(trx, await loadMatchForUpdate(trx, req.params.id), now);
        must(canOrganizerAct(rowToMatch(row), req.auth!.userId, 'CLOSE_REGISTRATIONS', now));
        // ApiError directe (409), pas badRequest() : badRequest() force TOUJOURS
        // 400 quel que soit le code passé (piège déjà relevé côté audit Lot 3A
        // sur /bookings/:id/verify) — INVALID_TRANSITION doit rester 409,
        // cohérent avec STATUS_BY_CODE/must() partout ailleurs dans ce fichier.
        if (!canTransition(MATCH_TRANSITIONS, row.status, 'LOCKED')) {
          throw new ApiError(409, 'INVALID_TRANSITION', 'Ce match ne peut pas être verrouillé dans son état actuel.');
        }
        await trx.updateTable('matches').set({ status: 'LOCKED' }).where('id', '=', row.id).execute();
      });
      return reply.send({ ok: true, status: 'LOCKED' });
    });

  /* Annulation — organisateur seul ; tous les inscrits sont prévenus (sauf l'annuleur).
     `canOrganizerAct` autorise CANCEL_MATCH depuis OPEN/FULL/LOCKED (states.ts) — sans
     synchronisation préalable, un match réellement terminé mais jamais retouché depuis
     le coup d'envoi resterait LOCKED en base et pourrait être annulé au lieu de passer
     par PLAYED, bloquant définitivement submitResult (MATCH_NOT_OPEN). Trouvé en revue. */
  /* BUG-1 (26/09/2026, décision d'Aymen — option « l'organisateur choisit ») : `cancelBooking: true` annule AUSSI la
     réservation qui porte le match, dans la même transaction, aux conditions d'une annulation joueur (règle core
     canCancelBooking). Depuis le 25/10/2026 (§18/§19), elle reste possible après H-2 — elle compte alors comme une
     demi-absence (cancellationKind, côté fiabilité) plutôt que d'être refusée ; seule une résa déjà close (ex. déjà
     HONORED) fait encore échouer les DEUX (409 INVALID_TRANSITION, l'app propose alors d'annuler seulement le match).
     Sans `cancelBooking`, la réservation reste RESERVED : elle n'est plus verrouillée par
     un match mort (reschedule.ts) et le CRM voit « match annulé » (GET /venues/:id/bookings, match.status).
     Ordre de verrouillage : la ou les réservations rattachées (`bookings.match_id`) D'ABORD, puis le match — le même que
     la cascade inverse (bookings/cascade.ts), sans quoi deux annulations croisées s'interbloqueraient. */
  app.post<{ Params: { id: string }; Body: { cancelBooking?: boolean } }>('/matches/:id/cancel',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const now = Date.now();
      const cancelBooking = req.body?.cancelBooking === true;
      // Correctif (05/09/2026) : voir withCommittedPush, notifications/push.ts.
      const outcome = await withCommittedPush(() => db.transaction().execute(async (trx) => {
        const linked = await trx.selectFrom('bookings').selectAll()
          .where('match_id', '=', req.params.id).orderBy('created_at', 'asc').forUpdate().execute();
        const row = await syncMatchLifecycle(trx, await loadMatchForUpdate(trx, req.params.id), now);
        must(canOrganizerAct(rowToMatch(row), req.auth!.userId, 'CANCEL_MATCH', now));

        const live = linked.filter((b) => b.status === 'RESERVED');
        if (cancelBooking) {
          if (live.length === 0) {
            throw new ApiError(409, 'INVALID_TRANSITION', 'Aucune réservation vivante n’est rattachée à ce match — il n’y a que le match à annuler.');
          }
          for (const b of live) {
            // L'organisateur est toujours le réservant (POST /matches) — garde quand même, jamais une annulation
            // de la réservation d'un tiers par ce chemin.
            if (b.by_user_id !== req.auth!.userId) throw new ApiError(403, 'FORBIDDEN', 'Cette réservation n’est pas la vôtre.');
            must(canCancelBooking(rowToBooking(b), now));
          }
        }

        await trx.updateTable('matches').set({ status: 'CANCELLED' }).where('id', '=', row.id).execute();
        const players = (await loadPlayers(trx, row.id)).map(rowToMatchPlayer);
        const joinedIds = activePlayers(players).map((p) => p.userId);
        await writeNotifications(trx, RECIPIENTS.matchCancelled(joinedIds, req.auth!.userId), 'MATCH_CANCELLED', row.id, now, undefined, req.auth!.userId);

        if (cancelBooking) {
          // Même écriture que POST /bookings/:id/cancel : un joueur qui annule est toujours CLIENT, horodaté pour la fiabilité.
          await trx.updateTable('bookings')
            .set({ status: 'CANCELLED', cancelled_at: new Date(now), cancel_reason: 'CLIENT' })
            .where('id', 'in', live.map((b) => b.id)).execute();
        }
        return { bookingCancelled: cancelBooking, bookingIds: live.map((b) => b.id) };
      }));
      return reply.send({ ok: true, status: 'CANCELLED', bookingCancelled: outcome.bookingCancelled, bookingIds: outcome.bookingIds });
    });
}
