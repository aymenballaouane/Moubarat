import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validatePlayerPassword } from '@moubarat/core';
import type { Db } from '../db/client.js';
import type { Guards } from './guards.js';
import { hashPassword } from '../lib/crypto.js';
import { ApiError, badRequest, must } from '../lib/http.js';
import { isNameTakenViolation } from '../lib/display-name.js';
import { recordAgeConsent } from '../modules/legal/service.js';

/* Lot B, phase 2 (18/11/2026, GO d'Aymen ; maquettes 03_Prenom et 04_Tu_joues_et_alertes) — l'inscription courte d'un INVITÉ, arrivé par
   le lien d'un match. Après « Ton numéro » (les accords, inchangés) et « Ton code », un seul écran : « Comment tu t'appelles ? ». Le
   prénom suffit ; le pseudo est généré à partir de lui (modifiable dans le profil) ; aucun mot de passe : le compte se reconnecte par
   code SMS (« Mot de passe oublié »), et « Choisir un mot de passe » reste proposé, facultatif, après avoir rejoint le match.
   La passerelle d'accès normale (/me/access-setup, pseudo + mot de passe) ne change pas ; les deux marquent `users.access_setup_at`
   (migration 0052). Le sport et la ville sont repris du match ; le genre et le niveau se complètent plus tard, sans rien bloquer. */

const SPORTS = ['FOOTBALL', 'PADEL'] as const;
const CITIES = ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF', 'AUTRE'] as const;

/** Un prénom : 2 à 30 signes, au moins une lettre (toutes écritures), espaces resserrés. */
export function cleanFirstName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  if (v.length < 2 || v.length > 30 || !/\p{L}/u.test(v) || /[<>{}\\]/.test(v)) return null;
  return v;
}

/** La base du pseudo (règle 28 : minuscules, chiffres, point, underscore) : « Karim » → « karim », « Aïcha » → « aicha » ; un prénom en
    lettres arabes (aucune lettre latine) → « joueur ». */
export function pseudoBase(firstName: string): string {
  const latin = firstName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');
  return (latin.length >= 2 ? latin : 'joueur').slice(0, 20);
}

/** « karim.b27 » (maquette 03_Prenom) : la base, un point, une lettre et deux chiffres tirés au hasard. */
export function pseudoCandidate(base: string): string {
  const letter = String.fromCharCode(97 + randomInt(26));
  return `${base}.${letter}${String(randomInt(100)).padStart(2, '0')}`;
}

/** Le pseudo montré à l'écran (« karim.b27 ») est repris tel quel s'il a exactement cette forme pour ce prénom. */
export function acceptedHint(base: string, hint: unknown): string | null {
  if (typeof hint !== 'string' || !hint.startsWith(`${base}.`)) return null;
  return /^[a-z]\d{2}$/.test(hint.slice(base.length + 1)) ? hint : null;
}

export async function registerGuestRoutes(app: FastifyInstance, deps: { db: Db; guards: Guards }): Promise<void> {
  const { db, guards } = deps;

  app.post<{ Body: { firstName?: unknown; pseudo?: unknown; ageConfirmed?: unknown; phoneVisible?: unknown; promoOptIn?: unknown; sport?: unknown; city?: unknown } }>(
    '/me/guest-setup', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const userId = req.auth!.userId;
      if (!req.auth!.needsAccessSetup) throw new ApiError(409, 'ACCESS_ALREADY_SET', 'Ton compte est déjà prêt.');
      const firstName = cleanFirstName(req.body?.firstName);
      if (!firstName) throw badRequest('Indique ton prénom (2 à 30 lettres).', 'FIRST_NAME_INVALID');
      if (req.body?.ageConfirmed !== true) throw badRequest('Confirme que tu as 18 ans ou plus.', 'AGE_CONFIRMATION_REQUIRED');
      if (req.body?.phoneVisible !== true) throw badRequest('L’accord « numéro visible » est obligatoire pour continuer.', 'PHONE_VISIBLE_REQUIRED');
      const sport = typeof req.body?.sport === 'string' && (SPORTS as readonly string[]).includes(req.body.sport) ? (req.body.sport as (typeof SPORTS)[number]) : null;
      const city = typeof req.body?.city === 'string' && (CITIES as readonly string[]).includes(req.body.city) ? (req.body.city as (typeof CITIES)[number]) : null;
      const promoOptIn = req.body?.promoOptIn === true;
      const base = pseudoBase(firstName);
      const hint = acceptedHint(base, req.body?.pseudo);

      // Le pseudo est unique (index de la base) : quelques tirages, chacun dans sa propre transaction.
      for (let attempt = 0; attempt < 8; attempt++) {
        const pseudo = attempt === 0 && hint ? hint : pseudoCandidate(base);
        try {
          const done = await db.transaction().execute(async (trx) => {
            const res = await trx.updateTable('users')
              .set({ name: pseudo, name_change_required: false, access_setup_at: new Date() })
              .where('id', '=', userId).where('deleted_at', 'is', null)
              .where('password_hash', 'is', null).where('access_setup_at', 'is', null)
              .executeTakeFirst();
            if (res.numUpdatedRows === 0n) return false;
            await recordAgeConsent(trx, userId, req.ip);
            await trx.insertInto('profiles')
              .values({
                user_id: userId, position: null, strong_foot: null, availability: null, avatar_url: null,
                city, gender: null, level: null, sports: sport ? [sport] : [], first_name: firstName, last_name: null,
                phone_visible: true, promo_opt_in: promoOptIn,
              })
              .onConflict((oc) => oc.column('user_id').doUpdateSet({ first_name: firstName, phone_visible: true, promo_opt_in: promoOptIn }))
              .execute();
            return true;
          });
          if (!done) throw new ApiError(409, 'ACCESS_ALREADY_SET', 'Ton compte est déjà prêt.');
          const user = await db.selectFrom('users').select(['id', 'name', 'phone', 'role']).where('id', '=', userId).executeTakeFirstOrThrow();
          return reply.send({ user, firstName, needsAccessSetup: false });
        } catch (e) {
          if (isNameTakenViolation(e)) continue;
          throw e;
        }
      }
      throw new ApiError(503, 'PSEUDO_UNAVAILABLE', 'Impossible de créer ton pseudo pour le moment. Réessaie.');
    },
  );

  /* « Choisir un mot de passe » (facultatif, après avoir rejoint le match) : seulement pour un compte qui n'en a JAMAIS eu (invité). Un
     compte qui a déjà un mot de passe passe par POST /me/password, qui exige l'actuel (MS-001). Le titulaire peut de toute façon
     reprendre la main par code SMS. */
  app.post<{ Body: { password?: unknown } }>('/me/password/initial', { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    must(validatePlayerPassword(password));
    const hash = await hashPassword(password);
    const res = await db.updateTable('users').set({ password_hash: hash })
      .where('id', '=', req.auth!.userId).where('deleted_at', 'is', null)
      .where('password_hash', 'is', null).where('access_setup_at', 'is not', null)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new ApiError(409, 'PASSWORD_ALREADY_SET', 'Ton compte a déjà un mot de passe : change-le depuis ton profil.');
    return reply.send({ ok: true });
  });
}
