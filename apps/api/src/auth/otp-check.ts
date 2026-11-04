import type { Transaction } from 'kysely';
import { verifyOtp, type OtpChallenge } from '@moubarat/core';
import type { Database } from '../db/types.js';
import { sha256 } from '../lib/crypto.js';
import { ApiError, badRequest, toApiError } from '../lib/http.js';

/* Vérification d'un code OTP — UNE seule implémentation, partagée par la connexion/inscription (/auth/otp/verify), le mot de passe oublié
   (/auth/password/reset) et le changement de numéro (POST /me/phone, règle 28 : « un SMS seulement pour un mot de passe oublié ou un changement de
   numéro »). Lit le DERNIER code du numéro SOUS VERROU DE LIGNE (FOR UPDATE) : sans lui, des vérifications concurrentes liraient toutes le même
   `attempts` avant qu'aucune n'écrive, et le plafond d'essais du core serait contournable par un simple burst. Un mauvais code incrémente `attempts`
   (dans la transaction de l'appelant : la décision se prend sous verrou, mais l'appelant ne jette qu'après le commit pour garder l'incrément).
   Ne marque PAS le code comme consommé (`verified_at`) : chaque appelant le fait au moment qui lui convient (l'inscription attend d'avoir le nom). */
export async function checkOtpChallenge(
  trx: Transaction<Database>, e164: string, input: string, now: number,
): Promise<{ ok: true; challengeId: string } | { ok: false; error: ApiError }> {
  const row = await trx.selectFrom('otp_challenges').selectAll()
    .where('phone', '=', e164)
    .orderBy('created_at', 'desc').limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return { ok: false, error: badRequest('Demandez d’abord un code.', 'OTP_EXPIRED') };

  const ch: OtpChallenge = {
    id: row.id, phone: row.phone, code: row.code_hash,
    createdAt: row.created_at.getTime(), expiresAt: row.expires_at.getTime(),
    attempts: row.attempts,
    ...(row.verified_at ? { verifiedAt: row.verified_at.getTime() } : {}),
  };
  const res = verifyOtp(ch, sha256(input), now);
  if (!res.ok) {
    // Le core délègue l'incrément du compteur d'essais à l'appelant.
    if (res.code === 'OTP_WRONG') {
      await trx.updateTable('otp_challenges').set((eb) => ({ attempts: eb('attempts', '+', 1) }))
        .where('id', '=', row.id).execute();
    }
    return { ok: false, error: toApiError(res) };
  }
  return { ok: true, challengeId: row.id };
}
