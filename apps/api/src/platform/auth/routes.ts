import type { FastifyInstance } from 'fastify';
import {
  canAttemptLogin, recordFailedLogin, resetLoginAttempts, type LoginAttemptState,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { hashPassword, newSessionToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { ApiError, badRequest, must, toApiError } from '../../lib/http.js';
import { checkRateLimit, type RateLimiter } from '../../lib/rate-limit.js';
import { needsLegalConsent } from '../../modules/legal/service.js';
import { writeAudit } from '../../audit/log.js';

interface Deps {
  db: Db; guards: PlatformGuards;
  /** Audit 07-09/09/2026 (S12/Z1) : le verrou anti-bruteforce ci-dessous est
      PAR COMPTE — rien n'empêchait de viser des comptes DIFFÉRENTS depuis la
      même source. Optionnel : un test qui ne le fournit pas garde l'ancien
      comportement. */
  loginIpLimiter?: RateLimiter;
}

/* Partagée entre /login et /me — les deux doivent renvoyer la même forme
   (CRM Auth V1) : un compte CRM valide ses rattachements dès la connexion
   (LoginScreen), pas seulement après un second aller-retour vers /me.
   Abonnement du centre (22/09/2026, C1/CE11) inclus ici plutôt qu'un nouvel appel dédié : le CRM lit
   déjà ce point de passage à chaque connexion pour afficher son bandeau — jamais exposé par
   GET /venues/:id (route PUBLIQUE, sans auth, lue par l'app joueur : un statut de paiement n'a rien
   à y faire). */
async function centerMembershipsFor(db: Db, accountId: string) {
  const rows = await db.selectFrom('center_staff')
    .innerJoin('venues', 'venues.id', 'center_staff.venue_id')
    .select([
      'venues.id as venue_id', 'venues.name as venue_name', 'center_staff.role',
      'venues.subscription_status', 'venues.subscription_due_at',
    ])
    .where('center_staff.user_id', '=', accountId)
    .execute();
  return rows.map((m) => ({
    venueId: m.venue_id, venueName: m.venue_name, role: m.role,
    subscriptionStatus: m.subscription_status, subscriptionDueAt: m.subscription_due_at,
  }));
}

/* SUPERADMIN V1 — auth email + mot de passe, réservée aux comptes plateforme
   (superadmin aujourd'hui ; comptes CRM plus tard, même mécanisme, décision
   Aymen §21.3). Rien ici ne réutilise auth/routes.ts (OTP) : deux systèmes
   volontairement séparés, jamais deux implémentations d'un même système. */
export async function registerPlatformAuthRoutes(app: FastifyInstance, { db, guards, loginIpLimiter }: Deps): Promise<void> {

  app.post<{ Body: { email?: string; password?: string } }>('/platform/auth/login', async (req, reply) => {
    // Audit 07-09/09/2026 (S12/Z1) : le verrou de 5 essais ci-dessous protège
    // UN compte ; il ne dit rien du nombre de comptes DIFFÉRENTS qu'une même
    // source peut essayer. Limite par IP, évaluée avant toute lecture en base.
    await checkRateLimit(loginIpLimiter, req.ip, 'RATE_LIMITED', 'Trop de tentatives de connexion depuis cette adresse. Réessayez plus tard.');

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) throw badRequest('Email et mot de passe requis.');

    // Message générique dans les deux cas (compte inexistant / mauvais mot de
    // passe) — ne jamais révéler si un email existe côté plateforme.
    const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');

    // Audit 07-09/09/2026 (T1) : lecture du compte, décision et incrément du
    // compteur anti-bruteforce sous UN SEUL verrou de ligne (FOR UPDATE) —
    // même discipline que /auth/otp/verify (auth/routes.ts). Sans lui, une
    // rafale de requêtes concurrentes sur le MÊME compte lisait toutes le
    // même compteur avant qu'aucune n'écrive : le plafond de 5 essais se
    // comptait en vagues parallèles, pas en essais réels. Le compte reste
    // verrouillé pendant le calcul du mot de passe (scrypt, coûteux) — c'est
    // précisément ce qui sérialise les tentatives concurrentes visant CE
    // compte. On décide sous verrou, mais on ne jette qu'après le commit
    // (jeter dans trx.execute() annulerait aussi l'incrément à garder).
    const outcome = await db.transaction().execute(async (trx) => {
      const account = await trx.selectFrom('platform_accounts').selectAll()
        .where('email', '=', email).forUpdate().executeTakeFirst();
      if (!account) return { ok: false as const, error: invalidCredentials() };

      const now = Date.now();
      const attemptState: LoginAttemptState = {
        failedAttempts: account.failed_login_attempts,
        lockedUntil: account.locked_until ? account.locked_until.getTime() : null,
      };
      const lockCheck = canAttemptLogin(attemptState, now);
      if (!lockCheck.ok) return { ok: false as const, error: toApiError(lockCheck) };

      const passwordOk = await verifyPassword(password, account.password_hash);
      if (!passwordOk) {
        const next = recordFailedLogin(attemptState, now);
        await trx.updateTable('platform_accounts').set({
          failed_login_attempts: next.failedAttempts,
          locked_until: next.lockedUntil ? new Date(next.lockedUntil) : null,
        }).where('id', '=', account.id).execute();
        return { ok: false as const, error: invalidCredentials() };
      }
      if (account.status !== 'ACTIVE') {
        return { ok: false as const, error: new ApiError(403, 'ACCOUNT_SUSPENDED', 'Ce compte est suspendu.') };
      }

      const reset = resetLoginAttempts();
      await trx.updateTable('platform_accounts').set({
        failed_login_attempts: reset.failedAttempts, locked_until: null,
      }).where('id', '=', account.id).execute();
      return { ok: true as const, account };
    });
    if (!outcome.ok) throw outcome.error;
    const { account } = outcome;

    const token = newSessionToken();
    await db.insertInto('platform_sessions').values({
      account_id: account.id, token_hash: sha256(token),
    }).execute();
    return reply.send({
      token,
      account: { id: account.id, email: account.email, name: account.name, isSuperadmin: account.is_superadmin },
      centerMemberships: await centerMembershipsFor(db, account.id),
      needsLegalConsent: await needsLegalConsent(db, 'PLATFORM_ACCOUNT', account.id),
    });
  });

  app.post('/platform/auth/logout', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    await db.updateTable('platform_sessions').set({ revoked_at: new Date() })
      .where('id', '=', req.platformAuth!.sessionId).execute();
    return reply.send({ ok: true });
  });

  /* CRM Auth V1, étape 3 — un compte CRM a besoin de savoir à quel(s) centre(s)
     il est rattaché et avec quel rôle, en plus de qui il est (déjà suffisant
     pour SUPERADMIN, qui n'a besoin d'aucun rattachement centre). Tableau,
     pas un objet unique : rien n'empêche architecturalement un compte
     d'appartenir à plusieurs centres, même si le pilote V1 n'en a qu'un.
     Les permissions elles-mêmes ne sont jamais renvoyées ici — elles se
     dérivent de `role` via `canCenterAct` (core), déjà ce que fait le CRM
     pour verrouiller ses écrans ; les dupliquer côté réponse serait une
     deuxième source de vérité pour rien. */
  app.get('/platform/auth/me', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const { accountId, name, email, isSuperadmin } = req.platformAuth!;
    return reply.send({
      account: { id: accountId, name, email, isSuperadmin },
      centerMemberships: await centerMembershipsFor(db, accountId),
      needsLegalConsent: await needsLegalConsent(db, 'PLATFORM_ACCOUNT', accountId),
    });
  });

  /* ONB-1 (audit pré-lancement, lot 6, 27/09/2026) — un compte plateforme (gérant, réception, superadmin) change
     LUI-MÊME son mot de passe. Jusqu'ici le seul chemin était la réinitialisation par un tiers (propriétaire ou
     superadmin), avec un mot de passe temporaire dicté à l'oral : un gérant qui recevait son premier accès gardait ce
     mot de passe pour toujours. Règles :
     - le mot de passe ACTUEL est exigé (une session volée ne suffit pas à s'installer durablement) ; une erreur compte
       comme un échec de connexion — même verrou que /login (core `recordFailedLogin`, 5 essais, 15 min), même compteur ;
       refus en 403 `INVALID_CURRENT_PASSWORD` — jamais 401, que les deux clients interprètent comme « session morte » ;
     - le nouveau : ≥ MIN_PLATFORM_PASSWORD_LENGTH (le seul seuil, celui des scripts), différent de l'actuel ;
     - toutes les AUTRES sessions du compte sont fermées (un mot de passe changé parce qu'on le croit connu doit couper
       qui l'utilisait), la session courante reste ouverte ;
     - journalisé UNE FOIS PAR CENTRE rattaché (le gérant le voit dans son Journal, comme une réinitialisation par un
       tiers), sans mot de passe évidemment ; un superadmin sans centre : une ligne plateforme. */
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/platform/me/password', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const current = String(req.body?.currentPassword ?? '');
      const next = String(req.body?.newPassword ?? '');
      if (!current || !next) throw badRequest('Mot de passe actuel et nouveau mot de passe requis.');
      if (next.length < MIN_PLATFORM_PASSWORD_LENGTH) {
        throw new ApiError(400, 'PASSWORD_TOO_SHORT', `Nouveau mot de passe trop court : ${MIN_PLATFORM_PASSWORD_LENGTH} caractères minimum.`);
      }
      if (next === current) throw new ApiError(400, 'PASSWORD_UNCHANGED', 'Le nouveau mot de passe doit être différent de l’actuel.');
      const { accountId, sessionId, isSuperadmin } = req.platformAuth!;

      // Même discipline que /login : décision et compteur sous le verrou de la ligne du compte.
      const outcome = await db.transaction().execute(async (trx) => {
        const account = await trx.selectFrom('platform_accounts').selectAll()
          .where('id', '=', accountId).forUpdate().executeTakeFirstOrThrow();
        const now = Date.now();
        const attemptState: LoginAttemptState = {
          failedAttempts: account.failed_login_attempts,
          lockedUntil: account.locked_until ? account.locked_until.getTime() : null,
        };
        const lockCheck = canAttemptLogin(attemptState, now);
        if (!lockCheck.ok) return { ok: false as const, error: toApiError(lockCheck) };
        if (!(await verifyPassword(current, account.password_hash))) {
          const after = recordFailedLogin(attemptState, now);
          await trx.updateTable('platform_accounts').set({
            failed_login_attempts: after.failedAttempts,
            locked_until: after.lockedUntil ? new Date(after.lockedUntil) : null,
          }).where('id', '=', account.id).execute();
          return { ok: false as const, error: new ApiError(403, 'INVALID_CURRENT_PASSWORD', 'Mot de passe actuel incorrect.') };
        }
        await trx.updateTable('platform_accounts').set({
          password_hash: await hashPassword(next), failed_login_attempts: 0, locked_until: null,
        }).where('id', '=', account.id).execute();
        const revoked = await trx.updateTable('platform_sessions').set({ revoked_at: new Date() })
          .where('account_id', '=', account.id).where('revoked_at', 'is', null).where('id', '!=', sessionId)
          .returning('id').execute();
        return { ok: true as const, revokedSessions: revoked.length, name: account.name };
      });
      if (!outcome.ok) throw outcome.error;

      const n = outcome.revokedSessions;
      const summary = `a changé son mot de passe — ${n === 0 ? 'aucune autre session ouverte' : n === 1 ? '1 autre session fermée' : `${n} autres sessions fermées`}`;
      const memberships = await db.selectFrom('center_staff').select(['venue_id', 'role']).where('user_id', '=', accountId).execute();
      for (const m of memberships) {
        await writeAudit(db, {
          venueId: m.venue_id, actorId: accountId, actorRole: m.role, action: 'PLATFORM_PASSWORD_CHANGED',
          objectType: 'platform_account', objectId: accountId, summary,
        });
      }
      if (memberships.length === 0 && isSuperadmin) {
        await writeAudit(db, {
          actorId: accountId, actorRole: 'SUPERADMIN', action: 'PLATFORM_PASSWORD_CHANGED',
          objectType: 'platform_account', objectId: accountId, summary,
        });
      }
      return reply.send({ ok: true, revokedSessions: n });
    });
}

/** Audit 07-09/09/2026 (Z7) : seul superadmin:create imposait une longueur
    minimale (superadmin.ts, sa propre constante) — create-crm-account.ts
    n'imposait rien. Le mot de passe d'un gérant de centre ouvre la caisse,
    les tarifs, le journal et l'annuaire des clients : même exigence,
    appliquée ici, au seul point de passage — pour ne plus jamais avoir à la
    répéter à chaque nouveau script. superadmin.ts réutilise cette même
    constante (jamais un second seuil qui pourrait diverger). */
export const MIN_PLATFORM_PASSWORD_LENGTH = 12;

/** Utilitaire seed — jamais appelé depuis une route HTTP. */
export async function createPlatformAccount(db: Db, p: {
  email: string; password: string; name: string; isSuperadmin?: boolean;
}): Promise<string> {
  if (p.password.length < MIN_PLATFORM_PASSWORD_LENGTH) {
    throw new Error(`Mot de passe trop court : ${MIN_PLATFORM_PASSWORD_LENGTH} caractères minimum.`);
  }
  const passwordHash = await hashPassword(p.password);
  const row = await db.insertInto('platform_accounts').values({
    email: p.email.trim().toLowerCase(), password_hash: passwordHash, name: p.name,
    is_superadmin: p.isSuperadmin ?? false,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}
