import type { FastifyInstance } from 'fastify';
import {
  cancellationKind, clientReliabilityV1, matchLeaveKind, normalizeAlgerianMobile,
  validatePlayerPassword,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { checkOtpChallenge } from '../../auth/otp-check.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { ApiError, badRequest, must } from '../../lib/http.js';
import { checkLoginThrottle, clearLoginThrottle, ipFingerprint, recordLoginFailure, throttleKey } from '../../lib/login-throttle.js';
import { algiersDateOf } from '../../lib/algiers.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { myPlayedMatchIds } from '../matches/service.js';

/* Refonte app joueur, lot 10 (Profil et données, 26/10/2026) — ce que l'écran Profil lit et change : résumé (statistiques, fiabilité, terrains,
   « tes potes »), accords retirables (règles 30 et 32), changement de numéro par SMS et de mot de passe (règle 28). Les règles restent celles du core
   (fiabilité `clientReliabilityV1`, formule UNIQUE du CRM — règle 26 ; mot de passe `validatePlayerPassword` ; verrou `canAttemptLogin`). */

interface Deps { db: Db; guards: Guards }

const MATES_MAX = 5;
const VENUES_MAX = 6;

export async function registerProfileRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Le résumé du Profil, en UN appel.
     - JOUÉS : mes matchs passés à l'état PLAYED (organisés ou rejoints) ; ORGANISÉS : ceux d'entre eux que j'organisais ; CE MOIS : joués ce mois-ci
       (mois d'Alger, comme le reste de l'app).
     - TES TERRAINS : les centres où j'ai le plus joué (règle 40 de la liste — « Tes terrains » du Profil), nombre de matchs par centre.
     - TES POTES (règle 40) : les joueurs avec qui j'ai le plus joué, rien d'autre — pas de système d'amis. Les comptes supprimés n'y figurent pas.
     - FIABILITÉ (règles 26, 27) : la formule du CRM (core \`clientReliabilityV1\`, +1 / 0 / −0,5 / −2 sur 100) sur TOUS les centres ; les départs
       d'un match comptent comme les annulations d'une réservation (règle 4 modifiée : libre avant H-2 = 0, de H-2 à H-1 = demi-absence, −0,5).
       Seuls le joueur et les centres la voient : jamais servie par une route qui prend l'identifiant d'un autre joueur. Sous le seuil du core, \`visible: false\`. */
  app.get('/me/profile-summary', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const now = Date.now();

    const profile = await db.selectFrom('profiles')
      .select(['city', 'gender', 'sports', 'level', 'phone_visible', 'promo_opt_in', 'avatar_url', 'first_name', 'last_name'])
      .where('user_id', '=', userId).executeTakeFirst();

    const me = await db.selectFrom('users').select(['name', 'phone']).where('id', '=', userId).executeTakeFirstOrThrow();
    const playedIds = await myPlayedMatchIds(db, userId);
    const played = playedIds.length === 0 ? [] : await db.selectFrom('matches')
      .innerJoin('venues', 'venues.id', 'matches.venue_id')
      .select(['matches.id as id', 'matches.sport as sport', 'matches.organizer_id as organizer_id', 'matches.time_range as time_range',
        'venues.id as venue_id', 'venues.name as venue_name'])
      .where('matches.id', 'in', playedIds).execute();
    const thisMonth = algiersDateOf(now).slice(0, 7);
    const stats = {
      played: played.length,
      organized: played.filter((m) => m.organizer_id === userId).length,
      thisMonth: played.filter((m) => algiersDateOf(fromPgRange(m.time_range).start).slice(0, 7) === thisMonth).length,
    };

    const byVenue = new Map<string, { venueId: string; name: string; sport: string; matches: number; lastStart: number }>();
    for (const m of played) {
      const start = fromPgRange(m.time_range).start;
      const cur = byVenue.get(m.venue_id);
      if (!cur) byVenue.set(m.venue_id, { venueId: m.venue_id, name: m.venue_name, sport: m.sport, matches: 1, lastStart: start });
      else { cur.matches += 1; if (start > cur.lastStart) { cur.lastStart = start; cur.sport = m.sport; } }
    }
    const venues = [...byVenue.values()].sort((a, b) => b.matches - a.matches || b.lastStart - a.lastStart).slice(0, VENUES_MAX)
      .map(({ lastStart: _l, ...v }) => v);

    const mateRows = playedIds.length === 0 ? [] : await db.selectFrom('match_players')
      .innerJoin('users', 'users.id', 'match_players.user_id')
      .select(['users.id as user_id', 'users.name as name'])
      .where('match_players.match_id', 'in', playedIds).where('match_players.status', '=', 'JOINED')
      .where('match_players.user_id', '<>', userId).where('users.deleted_at', 'is', null).execute();
    const mateCount = new Map<string, { userId: string; name: string; matches: number }>();
    for (const r of mateRows) {
      const cur = mateCount.get(r.user_id);
      if (cur) cur.matches += 1; else mateCount.set(r.user_id, { userId: r.user_id, name: r.name, matches: 1 });
    }
    const mates = [...mateCount.values()].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name, 'fr')).slice(0, MATES_MAX);

    const bookingRows = await db.selectFrom('bookings')
      .select(['status', 'time_range', 'cancelled_at', 'cancel_reason'])
      .where('by_user_id', '=', userId).execute();
    let honored = 0, paid = 0, cancelledEarly = 0, cancelledLate = 0, noShow = 0;
    for (const r of bookingRows) {
      if (r.status === 'CANCELLED' && r.cancel_reason === 'STAFF_ERROR') continue;   // l'erreur du centre n'est pas la sienne (même règle que le CRM)
      if (r.status === 'HONORED') honored++;
      else if (r.status === 'PAID') paid++;
      else if (r.status === 'NO_SHOW') noShow++;
      else if (r.status === 'CANCELLED') {
        const kind = r.cancelled_at ? cancellationKind(fromPgRange(r.time_range).start, r.cancelled_at.getTime()) : 'EARLY';
        if (kind === 'LATE') cancelledLate++; else cancelledEarly++;
      }
    }
    const leaves = await db.selectFrom('match_players')
      .innerJoin('matches', 'matches.id', 'match_players.match_id')
      .select(['match_players.left_at as left_at', 'matches.time_range as time_range'])
      .where('match_players.user_id', '=', userId).where('match_players.status', '=', 'LEFT')
      .where('match_players.left_at', 'is not', null).where('matches.organizer_id', '<>', userId).execute();
    for (const l of leaves) {
      if (matchLeaveKind({ range: fromPgRange(l.time_range) }, l.left_at!.getTime()) === 'LATE') cancelledLate++; else cancelledEarly++;
    }
    const reliability = clientReliabilityV1({ honored, paid, cancelledEarly, cancelledLate, noShow });

    return reply.send({
      // Son propre pseudo et son propre numéro (jamais ceux d'un autre : la route ne prend aucun identifiant).
      me: { name: me.name, phone: me.phone },
      profile: {
        firstName: profile?.first_name ?? null, lastName: profile?.last_name ?? null,
        city: profile?.city ?? null, gender: profile?.gender ?? null, sports: profile?.sports ?? [], level: profile?.level ?? null,
        phoneVisible: profile?.phone_visible ?? false, promoOptIn: profile?.promo_opt_in ?? false, avatarUrl: profile?.avatar_url ?? null,
      },
      stats, venues, mates,
      reliability: { visible: reliability.visible, score: reliability.score },
    });
  });

  /* « Mes accords » (règles 30 et 32) : seuls deux accords se retirent — « numéro visible » et « bons plans ». Les conditions d'utilisation et
     « 18 ans ou plus » ne se retirent qu'en supprimant le compte. Retirer « numéro visible » n'enlève rien de ce qui est déjà pris (inscriptions,
     réservations) : il ferme seulement rejoindre et réserver (garde `PHONE_VISIBLE_OFF`, Lot 9). Champ omis = inchangé. */
  app.patch<{ Body: { phoneVisible?: unknown; promoOptIn?: unknown } }>('/me/consents', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const body = req.body ?? {};
    const fields: { phone_visible?: boolean; promo_opt_in?: boolean } = {};
    if (body.phoneVisible !== undefined) {
      if (typeof body.phoneVisible !== 'boolean') throw badRequest('phoneVisible attendu : vrai ou faux.');
      fields.phone_visible = body.phoneVisible;
    }
    if (body.promoOptIn !== undefined) {
      if (typeof body.promoOptIn !== 'boolean') throw badRequest('promoOptIn attendu : vrai ou faux.');
      fields.promo_opt_in = body.promoOptIn;
    }
    if (Object.keys(fields).length === 0) throw badRequest('Aucun accord à changer.');
    // `profiles` peut ne pas avoir de ligne (compte jamais passé par la passerelle d'accès) : upsert, jamais un UPDATE muet.
    await db.insertInto('profiles')
      .values({ user_id: userId, position: null, strong_foot: null, availability: null, avatar_url: null, city: null, gender: null, level: null, sports: [], ...fields })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(fields))
      .execute();
    const row = await db.selectFrom('profiles').select(['phone_visible', 'promo_opt_in']).where('user_id', '=', userId).executeTakeFirstOrThrow();
    return reply.send({ phoneVisible: row.phone_visible, promoOptIn: row.promo_opt_in });
  });

  /* Changer son numéro (règle 28 : un SMS pour un changement de numéro). Le code part du NOUVEAU numéro par la route habituelle
     (\`POST /auth/otp/request\` : mêmes plafonds et même coût SMS que partout), puis le joueur le prouve ici. Le numéro est l'identifiant de
     connexion : un numéro déjà pris par un autre compte est refusé (409 PHONE_TAKEN, posé par la contrainte d'unicité). Les sessions ne sont pas
     révoquées : le numéro n'est pas un secret revérifié à chaque requête (même décision que le changement fait par le superadmin, SA-1).
     Audit final 26/10/2026 (P1-7, AUT-1) : le MOT DE PASSE ACTUEL est désormais exigé (même verrou que la connexion, 403 jamais 401) et les AUTRES
     sessions sont fermées — le numéro est le point de récupération (« mot de passe oublié » part par SMS vers lui) : une session volée qui pouvait le
     changer sans mot de passe suffisait à prendre le compte. */
  app.post<{ Body: { phone?: string; code?: string; currentPassword?: string } }>('/me/phone', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);
    const input = String(req.body?.code ?? '');
    const current = String(req.body?.currentPassword ?? '');
    if (!current) throw badRequest('Indique ton mot de passe actuel.', 'PASSWORD_INVALID');
    const now = Date.now();

    const outcome = await db.transaction().execute(async (trx) => {
      const passwordError = await checkCurrentPassword(trx, userId, current, now, req.ip);
      if (passwordError) return { ok: false as const, error: passwordError };
      const checked = await checkOtpChallenge(trx, norm.e164, input, now);
      if (!checked.ok) return { ok: false as const, error: checked.error };
      await trx.updateTable('otp_challenges').set({ verified_at: new Date(now) }).where('id', '=', checked.challengeId).execute();
      try {
        const row = await trx.updateTable('users').set({ phone: norm.e164 })
          .where('id', '=', userId).where('deleted_at', 'is', null)
          .returning(['id', 'name', 'phone', 'role']).executeTakeFirst();
        if (!row) return { ok: false as const, error: new ApiError(404, 'NOT_FOUND', 'Compte introuvable.') };
        await trx.updateTable('sessions').set({ revoked_at: new Date(now) })
          .where('user_id', '=', userId).where('id', '<>', req.auth!.sessionId).where('revoked_at', 'is', null).execute();
        return { ok: true as const, user: row };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          return { ok: false as const, error: new ApiError(409, 'PHONE_TAKEN', 'Ce numéro est déjà utilisé par un autre compte.') };
        }
        throw e;
      }
    });
    if (!outcome.ok) throw outcome.error;
    return reply.send({ user: outcome.user });
  });

  /* Changer son mot de passe : l'actuel, puis le nouveau (règle 29 : 8 signes, 1 chiffre, 1 majuscule). Le mot de passe actuel faux compte pour le
     MÊME verrou que la connexion (5 essais, 15 min) — sans lui cette route serait un moyen de deviner le mot de passe d'une session volée. Refus
     en 403 (jamais 401 : l'app déconnecterait le joueur pour une simple faute de frappe). Les AUTRES sessions sont fermées, la courante reste. */
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/me/password', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');
    if (!current) throw badRequest('Indique ton mot de passe actuel.', 'PASSWORD_INVALID');
    must(validatePlayerPassword(next));
    const now = Date.now();

    const outcome = await db.transaction().execute(async (trx) => {
      const passwordError = await checkCurrentPassword(trx, userId, current, now, req.ip);
      if (passwordError) return { ok: false as const, error: passwordError };
      await trx.updateTable('users').set({ password_hash: await hashPassword(next), failed_login_attempts: 0, locked_until: null })
        .where('id', '=', userId).execute();
      await trx.updateTable('sessions').set({ revoked_at: new Date(now) })
        .where('user_id', '=', userId).where('id', '<>', req.auth!.sessionId).where('revoked_at', 'is', null).execute();
      return { ok: true as const };
    });
    if (!outcome.ok) throw outcome.error;
    return reply.send({ ok: true });
  });
}

/** Vérifie le mot de passe ACTUEL d'un joueur connecté, sous verrou de ligne. Même RALENTISSEMENT progressif que la connexion (décision d'Aymen, 27/10/2026 —
    lib/login-throttle.ts), clé = ce joueur + l'adresse de l'appelant : une session volée qui devine le mot de passe se ralentit, sans jamais bloquer le vrai joueur.
    Rend `null` si le mot de passe est bon, sinon l'erreur à lever : 403 `PASSWORD_INVALID` (jamais 401 : l'app déconnecterait le joueur pour une simple faute de
    frappe), 429 `LOGIN_SLOWDOWN`, ou 409 `NEEDS_ACCESS_SETUP` (aucun mot de passe posé). */
async function checkCurrentPassword(trx: Db, userId: string, current: string, now: number, ip: string): Promise<ApiError | null> {
  const user = await trx.selectFrom('users').selectAll().where('id', '=', userId).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
  if (!user || user.password_hash === null) return new ApiError(409, 'NEEDS_ACCESS_SETUP', 'Choisis d’abord un mot de passe.');
  const key = throttleKey('uid', userId);
  const ipHash = ipFingerprint(ip);
  const slow = await checkLoginThrottle(trx, key, ipHash, now);
  if (slow) return slow;
  if (!(await verifyPassword(current, user.password_hash))) {
    await recordLoginFailure(trx, key, ipHash, now);
    return new ApiError(403, 'PASSWORD_INVALID', 'Mot de passe actuel incorrect.');
  }
  await clearLoginThrottle(trx, key, ipHash);
  return null;
}
