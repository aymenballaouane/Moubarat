import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { validateDisplayName, validatePlayerPseudo } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { Guards } from '../../auth/guards.js';
import { ApiError, must } from '../../lib/http.js';
import { isNameTakenViolation, nameTaken, nameKeyOf } from '../../lib/display-name.js';
import { checkRateLimit, type RateLimiter } from '../../lib/rate-limit.js';
import { carryRestrictionOnDeletion } from '../absences/service.js';

interface Deps {
  db: Db; guards: Guards;
  /** Changements de nom (et tentatives) par joueur et par heure — chaque essai révèle si un nom est pris. Absent (tests, scripts) : aucune limite. */
  nameLimiter?: RateLimiter;
}

/* Refonte app joueur, lot "Fondations" (règle 34, 22/10/2026) — mêmes listes que le CHECK de
   la migration 0031 et l'enum `sport` du schéma gelé. Pas d'export runtime de ces listes côté
   @moubarat/core (seulement des types TS, qui n'existent plus une fois compilés) : la liste
   vit ici, ce qui la valide est la contrainte CHECK de la base, jamais réimplémenté ailleurs. */
const CITIES = ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF', 'AUTRE'] as const;
const GENDERS = ['HOMME', 'FEMME'] as const;
const SPORTS = ['FOOTBALL', 'PADEL', 'BASKET'] as const;
type ProfileBody = { city?: string | null; gender?: string | null; sports?: string[]; level?: string | null; firstName?: string; lastName?: string };

/* Chantier iOS (04/09/2026) — suppression de compte, exigée par Apple
   (5.1.1(v) : toute app avec création de compte doit permettre sa
   suppression depuis l'app). Décision d'Aymen : ANONYMISATION, pas
   effacement dur — l'historique de caisse des centres (bookings, payments,
   résultats, notes données) garde ses lignes et ses clés ; c'est l'IDENTITÉ
   qui disparaît : nom, numéro de téléphone, profil, sessions, appareils,
   boîte de notifications, appartenances d'équipe.

   Préconditions (409 HAS_UPCOMING_COMMITMENTS) : un joueur avec une
   réservation à venir, un match à venir qu'il organise ou a rejoint, ou un
   brassard de capitaine, doit d'abord les régler par les actions existantes
   (annuler / se désinscrire / transférer le brassard). Supprimer en silence
   un compte qui a un créneau réservé demain laisserait un centre avec une
   réservation sans personne à appeler — ni le centre ni le joueur n'y
   gagnent. Le message dit exactement ce qui bloque.

   Le numéro libéré (`deleted:<id>`, jamais un format E.164, donc jamais
   joignable par l'OTP) permet à la même personne de recréer un compte plus
   tard : elle repart de zéro, comme Apple l'exige. */

export const DELETED_NAME = 'Joueur supprimé';

export async function registerAccountRoutes(app: FastifyInstance, { db, guards, nameLimiter }: Deps): Promise<void> {

  /* Changer son nom d'affichage (25/09/2026, décision d'Aymen : vrai nom ou pseudo, unique — migration 0030).
     Sert au joueur marqué « nom à changer » (doublon hérité d'avant l'unicité : écran non contournable de l'app à sa
     prochaine connexion), et à tout joueur qui veut se renommer. Un refus « nom déjà pris » (409 NAME_TAKEN) vient de
     l'index d'unicité lui-même, atomique : deux joueurs qui visent le même nom au même instant, un seul l'obtient.
     Chaque appel compte pour le plafond, refusé ou non : c'est aussi une question « ce nom est-il pris ? ». */
  app.patch<{ Body: { name?: string } }>('/me', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    await checkRateLimit(nameLimiter, req.auth!.userId, 'RATE_LIMITED', 'Trop de changements de nom. Réessayez plus tard.');
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new ApiError(400, 'NAME_REQUIRED', 'Indiquez votre nom.');
    must(validateDisplayName(name));
    try {
      // Efface la marque « nom à changer » dans la MÊME écriture : le compte entre dans l'index avec son nouveau nom,
      // ou l'écriture entière est refusée. `deleted_at IS NULL` : un compte supprimé ne se renomme jamais.
      const row = await db.updateTable('users').set({ name, name_change_required: false })
        .where('id', '=', req.auth!.userId).where('deleted_at', 'is', null)
        .returning(['id', 'name', 'phone', 'role']).executeTakeFirst();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Compte introuvable.');
      return reply.send({ user: { id: row.id, name: row.name, phone: row.phone, role: row.role }, needsNameChange: false });
    } catch (e) {
      if (isNameTakenViolation(e)) throw nameTaken();
      throw e;
    }
  });

  /* Refonte app joueur, lot "Fondations" (règle 34, 22/10/2026) : ville, sexe, sports, niveau.
     Route séparée de PATCH /me (nom) — pas le même rythme d'appel, pas le même limiteur, et un
     joueur qui ne change que sa ville n'a pas à fournir son nom. `profiles` n'a encore AUCUNE
     ligne pour un compte créé par l'API (confirmé en lisant tout le module) : upsert, jamais un
     UPDATE qui échouerait silencieusement faute de ligne. Chaque champ omis (`undefined`,
     distingué de `null`) reste inchangé — un PATCH partiel ne doit jamais effacer les autres. */
  app.patch<{ Body: ProfileBody }>('/me/profile', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const body = req.body ?? {};
    // Typé étroit (pas `string`) une fois chaque valeur vérifiée contre sa liste — jamais un
    // cast en aveugle, Kysely doit voir le même type littéral que les colonnes de la base.
    const fields: {
      city?: (typeof CITIES)[number] | null; gender?: (typeof GENDERS)[number] | null;
      sports?: (typeof SPORTS)[number][]; level?: 'LOISIR' | 'INTERMEDIAIRE' | 'COMPETITION' | null;
      first_name?: string; last_name?: string;
    } = {};

    if ('city' in body) {
      if (body.city !== null && !CITIES.includes(body.city as (typeof CITIES)[number])) throw new ApiError(400, 'INVALID_CITY', 'Ville inconnue.');
      fields.city = body.city as (typeof CITIES)[number] | null;
    }
    if ('gender' in body) {
      if (body.gender !== null && !GENDERS.includes(body.gender as (typeof GENDERS)[number])) throw new ApiError(400, 'INVALID_GENDER', 'Valeur inconnue.');
      fields.gender = body.gender as (typeof GENDERS)[number] | null;
    }
    if ('level' in body) {
      const levels = ['LOISIR', 'INTERMEDIAIRE', 'COMPETITION'] as const;
      if (body.level !== null && !levels.includes(body.level as (typeof levels)[number])) throw new ApiError(400, 'INVALID_LEVEL', 'Niveau inconnu.');
      fields.level = body.level as (typeof levels)[number] | null;
    }
    // « Comment tu t'appelles ? » (ModifierProfil) : prénom et nom d'AFFICHAGE du profil — jamais uniques, jamais le pseudo (users.name).
    for (const [key, col] of [['firstName', 'first_name'], ['lastName', 'last_name']] as const) {
      if (body[key] === undefined) continue;
      const v = typeof body[key] === 'string' ? body[key]!.trim() : '';
      if (v.length < 1 || v.length > 40) throw new ApiError(400, 'INVALID_NAME_PART', 'Indique ton prénom et ton nom (40 signes au plus).');
      fields[col] = v;
    }
    if (body.sports !== undefined) {
      if (!Array.isArray(body.sports) || body.sports.some((s) => !SPORTS.includes(s as (typeof SPORTS)[number]))) {
        throw new ApiError(400, 'INVALID_SPORTS', 'Sport inconnu.');
      }
      fields.sports = [...new Set(body.sports)] as (typeof SPORTS)[number][];
    }

    // `.values()` doit fournir TOUTES les colonnes non générées (Kysely) même si la ligne
    // n'existe pas encore — les champs absents du PATCH restent à leur valeur neutre (null)
    // pour une PREMIÈRE écriture ; `doUpdateSet(fields)` ne touche, lui, que ceux du PATCH.
    await db.insertInto('profiles')
      .values({
        user_id: userId, position: null, strong_foot: null, availability: null, avatar_url: null,
        city: null, gender: null, level: null, sports: [], ...fields,
      })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(fields))
      .execute();

    const profile = await db.selectFrom('profiles').select(['city', 'gender', 'sports', 'level'])
      .where('user_id', '=', userId).executeTakeFirstOrThrow();
    return reply.send({ profile });
  });

  /* Vérification en direct du pseudo pendant la saisie (écran "Tes accès", maquette
     Onboarding.dc.html — demande d'Aymen du 24/10/2026 : "Libre"/"déjà pris" affichés dans
     le champ, sans phrase d'aide figée à côté). Même clé d'unicité que PATCH /me et
     /auth/login (`display_name_key`), jamais recalculée ici. Le compte courant s'exclut
     lui-même : AccessSetupGate pré-remplit le pseudo avec le nom actuel, qui ne doit pas se
     voir refuser son propre nom. Un format invalide répond simplement "indisponible" —
     validatePlayerPseudo porte déjà le message d'erreur, affiché ailleurs qu'ici. */
  app.get<{ Querystring: { pseudo?: string } }>('/me/pseudo-available', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const raw = typeof req.query?.pseudo === 'string' ? req.query.pseudo.trim() : '';
    if (!validatePlayerPseudo(raw).ok) return reply.send({ available: false });
    const taken = await db.selectFrom('users')
      .select('id')
      .where(sql<boolean>`display_name_key(name) = ${nameKeyOf(raw)}`)
      .where('id', '<>', req.auth!.userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return reply.send({ available: !taken });
  });

  app.delete('/me', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const userId = req.auth!.userId;
    const now = new Date();

    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select(['id', 'phone', 'deleted_at'])
        .where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (user.deleted_at !== null) return; // déjà anonymisé (double tap) : idempotent

      const upcomingBookings = await trx.selectFrom('bookings')
        .select(trx.fn.countAll<string>().as('n'))
        .where('by_user_id', '=', userId).where('status', '=', 'RESERVED')
        .where(sql<boolean>`upper(time_range) > ${now}`)
        .executeTakeFirstOrThrow();
      const upcomingOrganized = await trx.selectFrom('matches')
        .select(trx.fn.countAll<string>().as('n'))
        .where('organizer_id', '=', userId).where('status', 'in', ['OPEN', 'FULL', 'LOCKED'])
        .where(sql<boolean>`upper(time_range) > ${now}`)
        .executeTakeFirstOrThrow();
      const upcomingJoined = await trx.selectFrom('match_players')
        .innerJoin('matches', 'matches.id', 'match_players.match_id')
        .select(trx.fn.countAll<string>().as('n'))
        .where('match_players.user_id', '=', userId).where('match_players.status', '=', 'JOINED')
        .where('matches.organizer_id', '<>', userId)
        .where('matches.status', 'in', ['OPEN', 'FULL', 'LOCKED'])
        .where(sql<boolean>`upper(matches.time_range) > ${now}`)
        .executeTakeFirstOrThrow();
      const captaincies = await trx.selectFrom('team_members')
        .select(trx.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId).where('role', '=', 'CAPTAIN').where('status', '=', 'ACTIVE')
        .executeTakeFirstOrThrow();

      const blockers: string[] = [];
      const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
      const nb = Number(upcomingBookings.n), no = Number(upcomingOrganized.n), nj = Number(upcomingJoined.n), nc = Number(captaincies.n);
      if (nb > 0) blockers.push(`${plural(nb, 'réservation à venir', 'réservations à venir')} (à annuler)`);
      if (no > 0) blockers.push(`${plural(no, 'match à venir que tu organises', 'matchs à venir que tu organises')} (à annuler)`);
      if (nj > 0) blockers.push(`${plural(nj, 'match à venir rejoint', 'matchs à venir rejoints')} (à quitter)`);
      if (nc > 0) blockers.push(`${plural(nc, 'brassard de capitaine', 'brassards de capitaine')} (à transférer)`);
      if (blockers.length > 0) {
        throw new ApiError(409, 'HAS_UPCOMING_COMMITMENTS',
          `Avant de supprimer ton compte, règle d’abord : ${blockers.join(' · ')}.`,
          // Le détail chiffré : l'app écrit sa fenêtre d'explication (règle 36) sans relire le texte du serveur.
          { bookings: nb, organized: no, joined: nj, captaincies: nc });
      }

      /* Audit final 26/10/2026 (P1-8, CPT-2/AUT-3) : l'anonymisation laissait le prénom et le nom réels (`profiles.first_name/last_name`), le nom
         écrit sur ses réservations (`bookings.reservation_name` / `customer_phone`), ses alertes, son mot de passe — contraire à la règle 36 (« anciennes
         réservations … sans le nom »), à la notice « Tes données » et à l'article 9 de la politique de confidentialité. Tout ce qui l'identifie part ici ;
         ce que le CENTRE a saisi de lui-même (le nom d'un client du comptoir) reste le fichier du centre. */
      // MS-022 (audit final) : une restriction en cours survit, sous la seule empreinte du numéro, et revient si ce numéro se réinscrit.
      await carryRestrictionOnDeletion(trx, userId, user.phone, now.getTime());
      await trx.updateTable('users')
        .set({ name: DELETED_NAME, phone: `deleted:${userId}`, deleted_at: now, password_hash: null, failed_login_attempts: 0, locked_until: null })
        .where('id', '=', userId).execute();
      // `profiles` est écrite depuis PATCH /me/profile (refonte app joueur, lot "Fondations",
      // 22/10/2026) : ville/sexe/sports/niveau effacés comme promis par le commentaire que ce
      // lot remplace (position/pied fort/disponibilité/avatar restent vides, aucune route ne
      // les écrit encore). `onConflict` : un compte qui n'a jamais rien écrit n'a pas de ligne.
      await trx.insertInto('profiles')
        .values({
          user_id: userId, position: null, strong_foot: null, availability: null, avatar_url: null,
          city: null, gender: null, level: null, sports: [],
        })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({
          city: null, gender: null, level: null, sports: [], first_name: null, last_name: null, avatar_url: null,
          phone_visible: false, promo_opt_in: false,
        }))
        .execute();
      // Ses réservations (faites dans l'app ou déclarées) ne portent plus ni son nom ni le numéro déclaré ; un « C'est bien toi ? » en attente est refermé.
      await trx.updateTable('bookings').set({ reservation_name: DELETED_NAME, customer_phone: null }).where('by_user_id', '=', userId).execute();
      await trx.updateTable('bookings').set({ claimed_user_id: null, claim_status: null }).where('claimed_user_id', '=', userId).execute();
      await trx.deleteFrom('match_watchers').where('user_id', '=', userId).execute();
      await trx.deleteFrom('day_alerts').where('user_id', '=', userId).execute();
      await trx.updateTable('ratings').set({ comment: null }).where('rater_id', '=', userId).execute();
      await trx.updateTable('sessions').set({ revoked_at: now })
        .where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
      await trx.deleteFrom('push_devices').where('user_id', '=', userId).execute();
      await trx.deleteFrom('notifications').where('user_id', '=', userId).execute();
      await trx.deleteFrom('otp_challenges').where('phone', '=', user.phone).execute();
      await trx.updateTable('team_members').set({ status: 'LEFT' })
        .where('user_id', '=', userId).where('status', 'in', ['INVITED', 'ACTIVE']).execute();
    });

    return reply.code(204).send();
  });
}
