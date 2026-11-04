/* =============================================================================
   RÈGLES — AUTHENTIFICATION PLATEFORME (SUPERADMIN V1).
   Email + mot de passe, mécanisme séparé de l'OTP joueur (auth.ts) — même
   principe de verrouillage anti-bruteforce que l'OTP (auth.ts), pas de
   nouvelle philosophie : trop d'échecs → verrouillage temporaire, jamais un
   blocage permanent silencieux.
   ========================================================================== */

import { fail, ok, type RuleResult } from '../result.js';

export const PASSWORD_MAX_ATTEMPTS = 5;
export const PASSWORD_LOCKOUT_MS = 15 * 60_000;

export interface LoginAttemptState {
  failedAttempts: number;
  lockedUntil: number | null;
}

/** Le compte est-il verrouillé maintenant ? À vérifier AVANT de comparer le mot de passe. */
export function canAttemptLogin(state: LoginAttemptState, now: number): RuleResult {
  if (state.lockedUntil != null && state.lockedUntil > now) {
    const m = Math.ceil((state.lockedUntil - now) / 60_000);
    return fail('LOGIN_LOCKED', `Trop de tentatives. Réessayez dans ${m} min.`);
  }
  return ok;
}

/** Échec de mot de passe : incrémente, verrouille au seuil. L'appelant persiste le résultat. */
export function recordFailedLogin(state: LoginAttemptState, now: number): LoginAttemptState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= PASSWORD_MAX_ATTEMPTS) {
    return { failedAttempts, lockedUntil: now + PASSWORD_LOCKOUT_MS };
  }
  return { failedAttempts, lockedUntil: state.lockedUntil };
}

/** Connexion réussie : le compteur repart de zéro. */
export function resetLoginAttempts(): LoginAttemptState {
  return { failedAttempts: 0, lockedUntil: null };
}
