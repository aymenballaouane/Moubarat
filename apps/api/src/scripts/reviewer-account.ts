import { normalizeAlgerianMobile, validatePlayerPassword, validatePlayerPseudo } from '@moubarat/core';
import type { Db } from '../db/client.js';
import { hashPassword } from '../lib/crypto.js';
import { needsLegalConsent, recordAgeConsent, recordLegalConsent } from '../modules/legal/service.js';

/* Compte de démonstration pour les VÉRIFICATEURS des stores (Lot 13, décision d'Aymen du 26/10/2026) : « un compte de démonstration avec pseudo et mot de passe, des données de
   démo et aucun SMS nécessaire ». Google Play et l'App Store demandent des identifiants de test ; un vérificateur n'a pas de numéro algérien, donc aucune connexion par code SMS.

   Le compte est un VRAI compte joueur, entièrement configuré : pseudo + mot de passe (connexion par `POST /auth/login`, jamais d'OTP), CGU et confidentialité à la version courante,
   « 18 ans ou plus » attesté, profil rempli (Alger, football et padel). Il ne passe donc par AUCUN écran d'inscription ni de consentement à l'ouverture. Le numéro de téléphone est
   obligatoire en base (`users.phone`) : il vient de l'environnement (`REVIEWER_PHONE`, un numéro que l'entreprise contrôle) — aucun SMS n'y part jamais, le compte ne s'en sert pas.

   Idempotent, comme `ensureSuperadmin` : compte absent → créé ; présent (même numéro) + même pseudo → mot de passe REMIS à la valeur fournie (rotation), sessions fermées, verrou levé ;
   présent avec un AUTRE pseudo → refus (jamais écraser le compte d'un vrai joueur). Le mot de passe n'est jamais affiché. Les « données de démo » sont celles de `pnpm demo:seed` +
   `pnpm demo:catalogue` sur la base de l'environnement de vérification (docs/PASSATION.md, section « Comptes de test pour les vérificateurs ») : ce script ne crée que le compte. */

export type ReviewerOutcome = 'created' | 'password-reset';

export interface ReviewerInput { phone: string; pseudo: string; password: string; firstName?: string | undefined; lastName?: string | undefined }

export async function ensureReviewerAccount(db: Db, p: ReviewerInput): Promise<{ userId: string; outcome: ReviewerOutcome; pseudo: string }> {
  const phone = normalizeAlgerianMobile(p.phone);
  if (!phone.ok) throw new Error(`REVIEWER_PHONE invalide : ${phone.message}`);
  const pseudo = p.pseudo.trim();
  const pseudoCheck = validatePlayerPseudo(pseudo);
  if (!pseudoCheck.ok) throw new Error(`REVIEWER_PSEUDO invalide : ${pseudoCheck.message}`);
  const passwordCheck = validatePlayerPassword(p.password);
  if (!passwordCheck.ok) throw new Error(`REVIEWER_PASSWORD invalide : ${passwordCheck.message}`);
  const hash = await hashPassword(p.password);

  return db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('users').select(['id', 'name', 'deleted_at']).where('phone', '=', phone.e164).forUpdate().executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null || existing.name !== pseudo) {
        throw new Error(`Le numéro ${phone.national} appartient déjà à un autre compte (« ${existing.name} ») : le compte de vérification ne l'écrase jamais. Choisis un autre REVIEWER_PHONE, ou le même REVIEWER_PSEUDO.`);
      }
      await trx.updateTable('users').set({ password_hash: hash, failed_login_attempts: 0, locked_until: null, status: 'ACTIVE', name_change_required: false }).where('id', '=', existing.id).execute();
      await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', existing.id).where('revoked_at', 'is', null).execute();
      if (await needsLegalConsent(trx, 'PLAYER', existing.id)) await recordLegalConsent(trx, 'PLAYER', existing.id, '127.0.0.1');
      return { userId: existing.id, outcome: 'password-reset' as const, pseudo };
    }

    const taken = await trx.selectFrom('users').select('id').where('name', '=', pseudo).executeTakeFirst();
    if (taken) throw new Error(`Le pseudo « ${pseudo} » est déjà pris par un autre compte : choisis un autre REVIEWER_PSEUDO.`);
    const created = await trx.insertInto('users')
      .values({ phone: phone.e164, name: pseudo, password_hash: hash, name_change_required: false })
      .returning('id').executeTakeFirstOrThrow();
    await recordLegalConsent(trx, 'PLAYER', created.id, '127.0.0.1');
    await recordAgeConsent(trx, created.id, '127.0.0.1');
    await trx.insertInto('profiles').values({
      user_id: created.id, position: null, strong_foot: null, availability: null, avatar_url: null, gender: null, level: 'LOISIR',
      city: 'ALGER', sports: ['FOOTBALL', 'PADEL'], first_name: p.firstName?.trim() || 'Compte', last_name: p.lastName?.trim() || 'de vérification',
      phone_visible: true, promo_opt_in: false,
    }).execute();
    return { userId: created.id, outcome: 'created' as const, pseudo };
  });
}
