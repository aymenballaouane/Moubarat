import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { ApiError } from './http.js';

/* Ralentissement progressif des connexions joueur (décision d'Aymen, 27/10/2026) — remplace le verrou de 15 minutes après 5 essais.

   Pourquoi : avec un verrou PAR COMPTE, n'importe qui connaissant un pseudo (public : listes d'inscrits) pouvait l'empêcher de se connecter en tapant 5 faux
   mots de passe. Ici le compteur est par (identifiant tapé, ADRESSE de l'appelant) : celui qui s'acharne ne ralentit que lui-même ; le joueur légitime, qui écrit
   d'une autre adresse, repart de zéro. Le plafond par adresse (PLAYER_LOGIN_IP_MAX_PER_HOUR) reste le garde-fou contre la pulvérisation sur beaucoup de pseudos.

   Barème : 2 essais ratés sans pénalité (faute de frappe) ; au 3e échec, 2 s ; puis le délai DOUBLE à chaque échec (4, 8, 16, 32 s…), plafonné à 15 minutes.
   Un compteur laissé tranquille plus d'une heure repart de zéro. Un mot de passe juste efface le compteur. L'identifiant inconnu est ralenti exactement
   comme un identifiant réel (clé = empreinte de ce qui est TAPÉ) : aucun oracle d'existence de compte. Jamais d'adresse ni d'identifiant en clair en base. */

export const FREE_FAILURES = 2;
export const FIRST_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 15 * 60_000;
export const FORGET_AFTER_MS = 3_600_000;

/** Délai imposé APRÈS le n-ième échec consécutif (0 tant que n ≤ 2, puis 2 s, 4 s, 8 s… plafonné). Pure. */
export function loginDelayMs(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  const exp = Math.min(failures - FREE_FAILURES - 1, 20);
  return Math.min(FIRST_DELAY_MS * 2 ** exp, MAX_DELAY_MS);
}

export function throttleKey(kind: 'id' | 'uid', value: string): string {
  return createHash('sha256').update(`login:${kind}:${value}`).digest('hex');
}
export function ipFingerprint(ip: string): string {
  return createHash('sha256').update(`login-ip:${ip}`).digest('hex');
}

/** La clé de comparaison d'un pseudo/nom telle que la base la calcule (`display_name_key` : casse, espaces, accents) — pour que « Aymen.B », « aymen.b » et « AYMEN.B » partagent le MÊME ralentissement. */
export async function foldedName(db: Db, value: string): Promise<string> {
  const { rows } = await sql<{ k: string }>`SELECT display_name_key(${value}) AS k`.execute(db);
  return rows[0]!.k;
}

/** « Réessaie dans 8 secondes » / « 2 minutes ». */
export function waitLabel(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} seconde${s > 1 ? 's' : ''}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m > 1 ? 's' : ''}`;
}

/** À appeler DANS une transaction, AVANT de regarder le compte : sérialise les essais d'une même (clé, adresse) et rend l'erreur 429 à lever si le délai court encore. */
export async function checkLoginThrottle(trx: Db, key: string, ipHash: string, now: number): Promise<ApiError | null> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'login-throttle:' + key + ipHash}))`.execute(trx);
  const row = await trx.selectFrom('login_throttle').select('next_allowed_at').where('key', '=', key).where('ip_hash', '=', ipHash).executeTakeFirst();
  if (!row || row.next_allowed_at.getTime() <= now) return null;
  const remaining = row.next_allowed_at.getTime() - now;
  return new ApiError(429, 'LOGIN_SLOWDOWN', `Trop d’essais. Réessaie dans ${waitLabel(remaining)}.`, { retryAfterSec: Math.ceil(remaining / 1000) });
}

/** Un échec de plus : compteur +1 (ou 1 si le précédent date de plus d'une heure) et nouveau délai. */
export async function recordLoginFailure(trx: Db, key: string, ipHash: string, now: number): Promise<void> {
  const row = await trx.selectFrom('login_throttle').select(['failures', 'updated_at']).where('key', '=', key).where('ip_hash', '=', ipHash).executeTakeFirst();
  const previous = row && now - row.updated_at.getTime() <= FORGET_AFTER_MS ? row.failures : 0;
  const failures = previous + 1;
  const next = new Date(now + loginDelayMs(failures));
  await trx.insertInto('login_throttle')
    .values({ key, ip_hash: ipHash, failures, next_allowed_at: next, updated_at: new Date(now) })
    .onConflict((oc) => oc.columns(['key', 'ip_hash']).doUpdateSet({ failures, next_allowed_at: next, updated_at: new Date(now) }))
    .execute();
  if (Math.random() < 0.01) {
    // Purge opportuniste : plus rien d'utile après une journée (la mémoire du barème est d'une heure).
    void trx.deleteFrom('login_throttle').where('updated_at', '<', new Date(now - 86_400_000)).execute().catch(() => {});
  }
}

/** Mot de passe juste : le compteur de CETTE (clé, adresse) repart de zéro. */
export async function clearLoginThrottle(trx: Db, key: string, ipHash: string): Promise<void> {
  await trx.deleteFrom('login_throttle').where('key', '=', key).where('ip_hash', '=', ipHash).execute();
}

/** Preuve de possession du numéro (SMS « mot de passe oublié ») : tous les ralentissements visant CE compte sont levés, quelle que soit l'adresse. */
export async function clearLoginThrottleForKeys(db: Db, keys: string[]): Promise<void> {
  if (keys.length > 0) await db.deleteFrom('login_throttle').where('key', 'in', keys).execute();
}
