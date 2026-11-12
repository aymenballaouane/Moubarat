import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import {
  canRequestOtp, newOtpChallenge, normalizeAlgerianMobile, validateDisplayName, validatePlayerPassword,
  validatePlayerPseudo,
  OTP_SEND_WINDOW_MS,
} from '@moubarat/core';
import type { Db } from '../db/client.js';
import { checkOtpChallenge } from './otp-check.js';
import { ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE, type Guards } from './guards.js';
import type { SmsProvider } from '../lib/sms.js';
import { hashPassword, newOtpCode, newSessionToken, sha256, verifyPassword } from '../lib/crypto.js';
import { ApiError, badRequest, must } from '../lib/http.js';
import { checkLoginThrottle, clearLoginThrottle, clearLoginThrottleForKeys, foldedName, ipFingerprint, recordLoginFailure, throttleKey } from '../lib/login-throttle.js';
import { checkRateLimit, type RateLimiter } from '../lib/rate-limit.js';
import { needsLegalConsent, recordLegalConsent, recordAgeConsent } from '../modules/legal/service.js';
import { isNameTakenViolation, nameKeyOf, nameTaken } from '../lib/display-name.js';

interface Deps {
  db: Db; guards: Guards; sms: SmsProvider;
  /** Audit 07-09/09/2026 (S12) : compteurs additionnels au quota par numéro
      du core — par IP appelante et global (coût SMS total). Optionnels : un
      test qui ne les fournit pas garde l'ancien comportement (quota par
      numéro seul), pour ne jamais faire dépendre une assertion de
      concurrence sur un numéro d'une limite conçue pour un tout autre axe. */
  otpIpLimiter?: RateLimiter;
  /** Plafonds de COÛT (mise à l'échelle L2) : SMS réellement envoyés, par heure et par jour d'Alger. */
  otpSendHourLimiter?: RateLimiter; otpSendDayLimiter?: RateLimiter;
  /** Audit final 26/10/2026 (P1-6) : connexions joueur par IP (une connexion réussie est rendue au compteur). */
  playerLoginIpLimiter?: RateLimiter;
}

/** MS-001 : les accès (pseudo + mot de passe) sont déjà posés — un changement passe par POST /me/password. */
function accessAlreadySet(): ApiError {
  return new ApiError(409, 'ACCESS_ALREADY_SET', 'Ton compte a déjà un mot de passe. Pour le changer, passe par Profil › Mot de passe.');
}

export async function registerAuthRoutes(
  app: FastifyInstance, { db, guards, sms, otpIpLimiter, otpSendHourLimiter, otpSendDayLimiter, playerLoginIpLimiter }: Deps,
): Promise<void> {

  /* Demande d'un code OTP. Cooldown 60 s + quota 3/15 min = règles core.
     Lot 3C : le code en clair ne quitte plus jamais cette fonction vers le
     client HTTP — `sms.send()` est l'unique destinataire (voir lib/sms.ts :
     console en dev, aucune livraison réelle tant qu'aucun fournisseur n'est
     choisi, mais jamais un retour au client dans les deux cas). Avant ce
     correctif, un mode dev mal configuré en pilote aurait permis à
     n'importe qui de lire le code de n'importe quel numéro dans la réponse
     JSON — faille de sécurité totale, pas un détail. */
  app.post<{ Body: { phone?: string } }>('/auth/otp/request', async (req, reply) => {
    // Audit 07-09/09/2026 (S12) : le quota par numéro (ci-dessous) ne borne
    // rien pour qui vise des numéros DIFFÉRENTS — un script qui énumère le
    // plan de numérotation algérien restait libre. Garde-fou par IP appelante,
    // évalué AVANT toute lecture en base (compteur partagé entre instances,
    // mise à l'échelle L2). Le plafond GLOBAL, lui, compte des SMS réellement
    // envoyés et se vérifie plus bas, dans la transaction qui insère le code.
    await checkRateLimit(otpIpLimiter, req.ip, 'RATE_LIMITED', 'Trop de demandes depuis cette adresse. Réessayez plus tard.');

    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);

    // Règle 28 (corrections d'Aymen, 24/10/2026) : un compte qui a déjà un mot de passe ne reçoit
    // PLUS AUCUN SMS de connexion — ni le cooldown/quota ci-dessous ni l'envoi réel ne doivent
    // être atteints, jamais seulement le refus à la vérification du code (ce que ce lot faisait
    // d'abord, à tort). L'app propose la connexion par mot de passe ("mot de passe oublié ?" à
    // la place). Le SMS continue de partir pour : un numéro sans compte (inscription), un compte
    // SANS mot de passe (passerelle d'accès), /auth/password/forgot et le changement de numéro.
    const existing = await db.selectFrom('users').select('password_hash')
      .where('phone', '=', norm.e164).where('deleted_at', 'is', null).executeTakeFirst();
    if (existing && existing.password_hash !== null) {
      throw new ApiError(403, 'PASSWORD_LOGIN_REQUIRED', 'Ce compte a déjà un mot de passe. Connecte-toi avec ton pseudo ou ton numéro et ton mot de passe.');
    }

    const now = Date.now();
    const code = newOtpCode();
    // Le type core porte la valeur comparée ; en base, uniquement le hash.
    // `ch.expiresAt` est un calcul pur (aucun accès base) : peut être fait
    // hors de la transaction ci-dessous.
    const ch = newOtpChallenge('', norm.e164, sha256(code), now);

    // Audit 07-09/09/2026 (T2) : lecture du quota et insertion DE LA MÊME
    // transaction, sérialisées par un verrou consultatif sur CE numéro
    // (même mécanisme que reminders.ts:42) — sans lui, une rafale de
    // requêtes sur le même numéro lisait toutes zéro envoi récent avant
    // qu'aucune n'écrive, et le plafond de 3 SMS/15 min se comptait en
    // vagues parallèles, pas en envois réels.
    let insertedId: string;
    await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${norm.e164}))`.execute(trx);
      const recent = await trx.selectFrom('otp_challenges').select('created_at')
        .where('phone', '=', norm.e164)
        .where('created_at', '>', new Date(now - OTP_SEND_WINDOW_MS))
        .execute();
      must(canRequestOtp(recent.map((r) => r.created_at.getTime()), now));
      // Mise à l'échelle L2 (25/09/2026) — plafonds de COÛT globaux, comptés ICI et non à l'entrée de la route : un
      // renvoi bloqué par le délai de 60 s, un numéro invalide ou un quota par numéro n'envoient aucun SMS et ne
      // consomment donc rien. Dans la transaction : un refus (429) annule l'insertion ET le comptage. L'ordre heure →
      // jour est fixe (jamais d'inter-blocage entre deux demandes) ; sous les deux lignes de compteur, les demandes
      // se sérialisent quelques millisecondes — sans conséquence à quelques envois par seconde.
      await checkRateLimit(otpSendHourLimiter, 'global', 'RATE_LIMITED', 'Trop de demandes de code en ce moment. Réessayez plus tard.', trx);
      await checkRateLimit(otpSendDayLimiter, 'global', 'RATE_LIMITED', 'Trop de demandes de code en ce moment. Réessayez plus tard.', trx);
      const row = await trx.insertInto('otp_challenges').values({
        phone: ch.phone, code_hash: ch.code, expires_at: new Date(ch.expiresAt),
      }).returning('id').executeTakeFirstOrThrow();
      insertedId = row.id;
    });

    // Lot 3C (smssak) : un échec d'envoi réel ne doit JAMAIS se traduire par
    // un `{ok:true}` silencieux — l'utilisateur doit savoir explicitement
    // que le SMS n'est pas parti, pas seulement attendre un code qui
    // n'arrivera jamais. ConsoleSmsProvider/NullSmsProvider ne jettent
    // jamais (comportement inchangé) ; seul un vrai fournisseur (smssak) le
    // peut, sur une panne réseau ou un refus de leur API.
    try {
      await sms.send({ e164: norm.e164, national: norm.national }, code);
    } catch (e) {
      // Audit 07-09/09/2026 (T10) : un envoi qui n'a jamais eu lieu ne doit
      // rien coûter au quota — la ligne tout juste insérée est retirée
      // avant de faire remonter l'échec, pour que « Réessayez » (ci-dessous)
      // soit une invite honnête, pas un piège vers OTP_COOLDOWN puis OTP_QUOTA.
      await db.deleteFrom('otp_challenges').where('id', '=', insertedId!).execute();
      // Même principe pour le coût : un envoi qui n'a pas eu lieu rend son unité aux deux plafonds (au mieux — un
      // échec de restitution ne doit jamais masquer l'échec d'envoi que l'appelant doit voir).
      await Promise.allSettled([otpSendHourLimiter?.release('global'), otpSendDayLimiter?.release('global')]);
      throw new ApiError(502, 'SMS_DELIVERY_FAILED', e instanceof Error ? e.message : 'Envoi du SMS impossible pour le moment. Réessayez.');
    }
    return reply.send({ ok: true });
  });

  /* Vérification du code. Nouveau numéro → `name` obligatoire (core validateDisplayName). */
  app.post<{ Body: { phone?: string; code?: string; name?: string; consent?: boolean } }>('/auth/otp/verify', async (req, reply) => {
    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);
    const input = String(req.body?.code ?? '');
    const now = Date.now();

    // Verrou de ligne (FOR UPDATE) : sans lui, des vérifications concurrentes
    // liraient toutes le même `attempts` avant qu'aucune n'écrive — le plafond
    // de 5 essais du core serait contournable par un simple burst de requêtes.
    // On décide sous verrou, mais on ne jette qu'après le commit (jeter dans
    // trx.execute() annulerait aussi l'incrément qu'on veut justement garder).
    const outcome = await db.transaction().execute((trx) => checkOtpChallenge(trx, norm.e164, input, now));
    if (!outcome.ok) throw outcome.error;
    const row = { id: outcome.challengeId };

    let user = await db.selectFrom('users').selectAll().where('phone', '=', norm.e164).executeTakeFirst();
    // Audit produit JO6/JO7 (22/09/2026, décision Aymen 22/09) : le code part comme pour tout numéro (aucun
    // oracle avant le bon code : « ce numéro est suspendu » ne se lit que sur le téléphone qui reçoit le SMS).
    // Le bon code est CONSOMMÉ (usage unique) mais n'ouvre AUCUNE session — l'app affiche « compte suspendu »
    // au lieu d'un jeton qui échouerait ensuite en 401 à chaque appel.
    if (user && user.status === 'SUSPENDED') {
      await db.updateTable('otp_challenges').set({ verified_at: new Date(now) }).where('id', '=', row.id).execute();
      throw new ApiError(403, ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE);
    }
    // Règle 28 (corrections d'Aymen, 24/10/2026) : une fois qu'un compte a un mot de passe, le
    // code SMS ne lui ouvre plus de session — il ne sert plus qu'à l'inscription (ci-dessous),
    // au mot de passe oublié (/auth/password/reset) et au changement de numéro (lot à venir).
    // Code CONSOMMÉ (il était juste) mais aucune session : même discipline que SUSPENDED ci-dessus.
    if (user && user.password_hash !== null) {
      await db.updateTable('otp_challenges').set({ verified_at: new Date(now) }).where('id', '=', row.id).execute();
      throw new ApiError(403, 'PASSWORD_LOGIN_REQUIRED', 'Ce compte a déjà un mot de passe. Connecte-toi avec ton pseudo ou ton numéro et ton mot de passe.');
    }
    let isNew = false;
    if (!user) {
      const name = String(req.body?.name ?? '').trim();
      // Le code n'est PAS consommé : l'app demande le nom puis renvoie le même code.
      if (!name) throw badRequest('Première connexion : indiquez votre nom pour créer le profil.', 'NEEDS_PROFILE');
      must(validateDisplayName(name));
      // C7 (audit produit 21/09/2026) : un compte joueur ne se crée plus sans consentement explicite
      // aux CGU/politique de confidentialité — même écran que la saisie du nom (AuthFlow.tsx, étape
      // "profile"), jamais un geste séparé après coup.
      if (req.body?.consent !== true) {
        throw badRequest('L’acceptation des conditions générales et de la politique de confidentialité est requise.', 'CONSENT_REQUIRED');
      }
      // Unicité du nom (migration 0030) : l'index refuse le doublon, atomiquement — jamais une vérification préalable
      // qu'une inscription simultanée pourrait déjouer. Le code n'est PAS consommé : l'app redemande un nom et
      // renvoie le même code, comme pour NEEDS_PROFILE.
      try {
        user = await db.insertInto('users').values({ phone: norm.e164, name })
          .returningAll().executeTakeFirstOrThrow();
      } catch (e) {
        if (isNameTakenViolation(e)) throw nameTaken();
        throw e;
      }
      isNew = true;
      await recordLegalConsent(db, 'PLAYER', user.id, req.ip);
    }
    await db.updateTable('otp_challenges').set({ verified_at: new Date(now) })
      .where('id', '=', row.id).execute();

    const token = newSessionToken();
    await db.insertInto('sessions').values({ user_id: user.id, token_hash: sha256(token) }).execute();
    return reply.send({
      token, isNew,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      needsLegalConsent: isNew ? false : await needsLegalConsent(db, 'PLAYER', user.id),
      // Doublon de nom hérité d'avant l'unicité : l'app demande un autre nom avant tout (écran non contournable).
      needsNameChange: user.name_change_required,
      // Règles 28-30 (24/10/2026) : pseudo + mot de passe + nouveaux accords, pas encore
      // posés pour un compte antérieur à ce lot (`password_hash` reste NULL) — vrai pour un
      // compte tout juste créé par cette même requête aussi bien que pour un ancien compte.
      needsAccessSetup: user.password_hash === null,
    });
  });

  app.post('/auth/logout', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    await db.updateTable('sessions').set({ revoked_at: new Date() })
      .where('id', '=', req.auth!.sessionId).execute();
    return reply.send({ ok: true });
  });

  app.get('/auth/me', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const { userId, name, phone, role, nameChangeRequired, needsAccessSetup } = req.auth!;
    // `profiles` : aucune ligne tant que le joueur n'a jamais rien écrit (upsert, PATCH /me
    // ci-dessous) — jamais une 404, le profil "jeu" reste simplement vide.
    const profile = await db.selectFrom('profiles')
      .select(['city', 'gender', 'sports', 'level'])
      .where('user_id', '=', userId).executeTakeFirst();
    return reply.send({
      user: { id: userId, name, phone, role },
      profile: { city: profile?.city ?? null, gender: profile?.gender ?? null, sports: profile?.sports ?? [], level: profile?.level ?? null },
      needsLegalConsent: await needsLegalConsent(db, 'PLAYER', userId),
      needsNameChange: nameChangeRequired,
      needsAccessSetup,
    });
  });

  /* Règle 28 — connexion par numéro OU pseudo + mot de passe. Même anti-oracle, même verrou
     anti-bruteforce (5 essais, 15 min) que /platform/auth/login (platform/auth/routes.ts) —
     mécanisme déjà générique (packages/core/src/rules/platform-auth.ts), jamais dupliqué. */
  app.post<{ Body: { identifier?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const identifier = String(req.body?.identifier ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!identifier || !password) throw badRequest('Indique ton identifiant et ton mot de passe.', 'LOGIN_INVALID');

    const invalidCredentials = () => new ApiError(401, 'LOGIN_INVALID', 'Identifiant ou mot de passe incorrect.');
    const norm = normalizeAlgerianMobile(identifier);
    /* Audit final 26/10/2026 (P1-6, AUT-2) : plafond PAR ADRESSE, comme la connexion plateforme — sans lui, un mot de passe courant
       pouvait être essayé sur tous les pseudos (publics dans les listes d'inscrits) : le verrou par compte ne compte que par compte.
       La tentative est comptée AVANT le travail ; une connexion réussie la rend (seuls les échecs pèsent). */
    await checkRateLimit(playerLoginIpLimiter, req.ip, 'RATE_LIMITED', 'Trop de tentatives de connexion depuis cette adresse. Réessaie plus tard.');

    /* Décision d'Aymen (27/10/2026) : plus de verrou de compte — un ralentissement progressif PAR (identifiant tapé, adresse) : voir lib/login-throttle.ts.
       La clé vient de ce qui est TAPÉ (numéro normalisé ou pseudo replié), qu'il existe ou non : aucun oracle d'existence. */
    const tKey = throttleKey('id', norm.ok ? norm.e164 : await foldedName(db, identifier));
    const ipHash = ipFingerprint(req.ip);

    const outcome = await db.transaction().execute(async (trx) => {
      const now = Date.now();
      const slow = await checkLoginThrottle(trx, tKey, ipHash, now);
      if (slow) return { ok: false as const, error: slow };

      const user = norm.ok
        ? await trx.selectFrom('users').selectAll().where('phone', '=', norm.e164).where('deleted_at', 'is', null).executeTakeFirst()
        : await trx.selectFrom('users').selectAll()
            .where(sql<boolean>`display_name_key(name) = ${nameKeyOf(identifier)}`)
            .where('deleted_at', 'is', null).executeTakeFirst();
      if (!user || user.password_hash === null) {
        await recordLoginFailure(trx, tKey, ipHash, now);
        return { ok: false as const, error: invalidCredentials() };
      }

      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) {
        await recordLoginFailure(trx, tKey, ipHash, now);
        return { ok: false as const, error: invalidCredentials() };
      }
      // Suspension révélée SEULEMENT après un mot de passe prouvé juste (même discipline que
      // l'OTP, JO6/JO7) — jamais un oracle pour qui n'a pas le mot de passe.
      if (user.status === 'SUSPENDED') {
        return { ok: false as const, error: new ApiError(403, ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE) };
      }

      await clearLoginThrottle(trx, tKey, ipHash);
      return { ok: true as const, user };
    });
    if (!outcome.ok) throw outcome.error;
    const { user } = outcome;
    await playerLoginIpLimiter?.release(req.ip);   // connexion réussie : elle ne compte pas contre l'adresse

    const token = newSessionToken();
    await db.insertInto('sessions').values({ user_id: user.id, token_hash: sha256(token) }).execute();
    return reply.send({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      needsLegalConsent: await needsLegalConsent(db, 'PLAYER', user.id),
      needsNameChange: user.name_change_required,
      needsAccessSetup: user.password_hash === null,
    });
  });

  /* Règle 28 — "un SMS seulement pour un mot de passe oublié". Même code OTP et même quota que
     /auth/otp/request (newOtpCode/canRequestOtp/sha256) : un mot de passe oublié n'est pas un
     second mécanisme, seulement une autre FINALITÉ pour le même code à 6 chiffres. */
  app.post<{ Body: { phone?: string } }>('/auth/password/forgot', async (req, reply) => {
    await checkRateLimit(otpIpLimiter, req.ip, 'RATE_LIMITED', 'Trop de demandes depuis cette adresse. Réessayez plus tard.');
    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);
    const now = Date.now();
    const code = newOtpCode();
    const ch = newOtpChallenge('', norm.e164, sha256(code), now);

    let insertedId: string;
    await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${norm.e164}))`.execute(trx);
      const recent = await trx.selectFrom('otp_challenges').select('created_at')
        .where('phone', '=', norm.e164)
        .where('created_at', '>', new Date(now - OTP_SEND_WINDOW_MS))
        .execute();
      must(canRequestOtp(recent.map((r) => r.created_at.getTime()), now));
      await checkRateLimit(otpSendHourLimiter, 'global', 'RATE_LIMITED', 'Trop de demandes de code en ce moment. Réessayez plus tard.', trx);
      await checkRateLimit(otpSendDayLimiter, 'global', 'RATE_LIMITED', 'Trop de demandes de code en ce moment. Réessayez plus tard.', trx);
      const row = await trx.insertInto('otp_challenges').values({
        phone: ch.phone, code_hash: ch.code, expires_at: new Date(ch.expiresAt),
      }).returning('id').executeTakeFirstOrThrow();
      insertedId = row.id;
    });
    // Jamais d'oracle sur l'existence d'un compte : le SMS "part" (si le numéro existe vraiment,
    // smssak l'envoie) que ce numéro ait un compte ou non — identique à /auth/otp/request.
    try {
      await sms.send({ e164: norm.e164, national: norm.national }, code);
    } catch (e) {
      await db.deleteFrom('otp_challenges').where('id', '=', insertedId!).execute();
      await Promise.allSettled([otpSendHourLimiter?.release('global'), otpSendDayLimiter?.release('global')]);
      throw new ApiError(502, 'SMS_DELIVERY_FAILED', e instanceof Error ? e.message : 'Envoi du SMS impossible pour le moment. Réessayez.');
    }
    return reply.send({ ok: true });
  });

  app.post<{ Body: { phone?: string; code?: string; newPassword?: string } }>('/auth/password/reset', async (req, reply) => {
    const norm = normalizeAlgerianMobile(String(req.body?.phone ?? ''));
    if (!norm.ok) throw badRequest(norm.message, norm.code);
    const input = String(req.body?.code ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    must(validatePlayerPassword(newPassword));
    const now = Date.now();

    const outcome = await db.transaction().execute(async (trx) => {
      const checked = await checkOtpChallenge(trx, norm.e164, input, now);
      if (!checked.ok) return { ok: false as const, error: checked.error };
      await trx.updateTable('otp_challenges').set({ verified_at: new Date(now) }).where('id', '=', checked.challengeId).execute();

      const hash = await hashPassword(newPassword);
      /* Audit final 26/10/2026 (P1-5, CPT-1) : un compte SANS mot de passe n'a pas fini la passerelle d'accès (« 18 ans », « numéro
         visible », pseudo, mot de passe — règles 28 à 30) : lui poser un mot de passe ici faisait tomber `needsAccessSetup` et
         l'envoyait dans l'app sans les accords (numéro visible par défaut, aucune attestation d'âge). Son code SMS prouve qu'il est
         bien le titulaire : on ouvre sa session, mais le mot de passe reste vide — la passerelle s'affiche et le lui demande. */
      const current = await trx.selectFrom('users').select('password_hash')
        .where('phone', '=', norm.e164).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      // Un mot de passe réinitialisé par SMS efface aussi le verrou anti-bruteforce et révoque
      // les AUTRES sessions (même téléphone = même personne, mais un appareil volé qui avait
      // encore une session active ne doit pas la garder après ce geste de récupération).
      const updated = await trx.updateTable('users')
        .set({ password_hash: current && current.password_hash === null ? null : hash, failed_login_attempts: 0, locked_until: null })
        .where('phone', '=', norm.e164).where('deleted_at', 'is', null)
        .returningAll().executeTakeFirst();
      if (!updated) return { ok: false as const, error: badRequest('Aucun compte avec ce numéro.', 'NOT_FOUND') };
      await trx.updateTable('sessions').set({ revoked_at: new Date(now) })
        .where('user_id', '=', updated.id).where('revoked_at', 'is', null).execute();
      // La preuve par SMS vaut déblocage : les ralentissements visant ce numéro ou ce pseudo sont levés (toute adresse).
      await clearLoginThrottleForKeys(trx, [throttleKey('id', updated.phone), throttleKey('id', await foldedName(trx, updated.name))]);
      return { ok: true as const, user: updated };
    });
    if (!outcome.ok) throw outcome.error;
    const { user } = outcome;

    const token = newSessionToken();
    await db.insertInto('sessions').values({ user_id: user.id, token_hash: sha256(token) }).execute();
    return reply.send({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      needsAccessSetup: user.password_hash === null,
    });
  });

  /* Règles 28-30 — passerelle d'accès : pseudo + mot de passe + "18 ans ou plus"/"numéro
     visible" (obligatoires)/"bons plans" (facultatif). SERT AUX DEUX CAS : un compte tout juste
     créé par /auth/otp/verify (password_hash encore NULL) ET un compte antérieur à ce lot —
     même route, même condition de garde (`needsAccessSetup`), jamais deux mécanismes. Le pseudo
     réutilise exactement PATCH /me (même validateur, même refus NAME_TAKEN) : un joueur qui
     garde son nom actuel comme pseudo n'a qu'à soumettre la même valeur. */
  app.post<{ Body: {
    pseudo?: string; password?: string; firstName?: string; lastName?: string;
    ageConfirmed?: boolean; phoneVisible?: boolean; promoOptIn?: boolean;
  } }>(
    '/me/access-setup', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const userId = req.auth!.userId;
      /* Audit final, MS-001 (12/11/2026) : la mise en place des accès ne sert qu'UNE fois, tant que le compte n'a pas de
         mot de passe. Avant, une session (vol, appareil prêté) suffisait à remplacer pseudo et mot de passe sans
         l'actuel ; un changement passe désormais par POST /me/password, qui l'exige. */
      if (!req.auth!.needsAccessSetup) throw accessAlreadySet();
      const pseudo = String(req.body?.pseudo ?? '').trim();
      const password = String(req.body?.password ?? '');
      // "Comment tu t'appelles ?" (OnboardingAcces.dc.html) — affichage, jamais unique, jamais
      // validé par validateDisplayName (c'est le pseudo, ci-dessous, qui porte l'unicité).
      const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() || null : null;
      const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() || null : null;
      if (req.body?.ageConfirmed !== true) {
        throw badRequest('Confirme que tu as 18 ans ou plus.', 'AGE_CONFIRMATION_REQUIRED');
      }
      if (req.body?.phoneVisible !== true) {
        throw badRequest('L’accord « numéro visible » est obligatoire pour continuer.', 'PHONE_VISIBLE_REQUIRED');
      }
      if (!pseudo) throw badRequest('Choisis un pseudo.', 'NAME_REQUIRED');
      must(validatePlayerPseudo(pseudo));
      must(validatePlayerPassword(password));

      const hash = await hashPassword(password);
      const promoOptIn = req.body?.promoOptIn === true;
      /* MS-001 : une seule transaction, et l'écriture n'a lieu que si le mot de passe est ENCORE vide (deux envois
         simultanés, ou un mot de passe posé entre-temps : le second est refusé, rien n'est écrit à moitié). */
      await db.transaction().execute(async (trx) => {
        let updated: bigint;
        try {
          const res = await trx.updateTable('users')
            .set({ name: pseudo, name_change_required: false, password_hash: hash })
            .where('id', '=', userId).where('deleted_at', 'is', null).where('password_hash', 'is', null)
            .executeTakeFirst();
          updated = res.numUpdatedRows;
        } catch (e) {
          if (isNameTakenViolation(e)) throw nameTaken();
          throw e;
        }
        if (updated === 0n) throw accessAlreadySet();
        await recordAgeConsent(trx, userId, req.ip);
        await trx.insertInto('profiles')
          .values({
            user_id: userId, position: null, strong_foot: null, availability: null, avatar_url: null,
            city: null, gender: null, level: null, sports: [], first_name: firstName, last_name: lastName,
            phone_visible: true, promo_opt_in: promoOptIn,
          })
          .onConflict((oc) => oc.column('user_id').doUpdateSet({ first_name: firstName, last_name: lastName, phone_visible: true, promo_opt_in: promoOptIn }))
          .execute();
      });

      const user = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
      return reply.send({
        user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
        needsAccessSetup: false,
      });
    },
  );
}
