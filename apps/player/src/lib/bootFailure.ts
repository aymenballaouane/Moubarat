/* Audit final, MS-028 (12/11/2026) — l'écran d'échec du chargement disait toujours « Pas de réseau » : à chaque mise en
   ligne de l'API ou panne de notre côté, le joueur croyait son téléphone en cause. On distingue :
   - `offline` : le téléphone se dit hors ligne (navigator.onLine faux) ;
   - `server`  : le téléphone est en ligne mais Moubarat ne répond pas, ou répond en erreur (5xx, délai dépassé…). */
export type BootFailureKind = 'offline' | 'server';

export function bootFailureKind(online: boolean): BootFailureKind {
  return online ? 'server' : 'offline';
}

/** Délai entre deux essais automatiques pendant l'échec du chargement initial. */
export const BOOT_AUTO_RETRY_MS = 10_000;
