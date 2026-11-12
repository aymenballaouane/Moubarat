import { ApiError } from './api.js';

/* Audit final, MS-040 (12/11/2026) — au démarrage, toute erreur de `/platform/auth/me` effaçait le jeton : à chaque mise en
   ligne de l'API (quelques secondes d'indisponibilité) ou panne, la réception devait se reconnecter. Désormais seule une
   session REFUSÉE (401/403, ou une réponse inattendue) se jette ; une panne — réseau coupé (0) ou serveur en erreur (5xx) —
   garde la session et se réessaie toute seule. */

/** Délai entre deux essais quand le serveur est injoignable. */
export const BOOT_RETRY_MS = 5_000;

export function bootFailureAction(e: unknown): 'drop' | 'retry' {
  if (e instanceof ApiError && (e.statusCode === 0 || e.statusCode >= 500)) return 'retry';
  return 'drop';
}
