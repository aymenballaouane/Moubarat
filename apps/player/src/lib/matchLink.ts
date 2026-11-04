/* Le lien d'un match (Lot 7, LienMatch.dc.html) — « app.moubaratsport.com/m/CODE » : le code court est celui du serveur (migration 0036). Fonctions pures, sauf le stockage
   de l'invitation en attente (sessionStorage, enveloppé : jamais bloquant). */

/** Base publique des liens. Réglable au déploiement (`VITE_PUBLIC_BASE_URL`) ; par défaut `https://app.moubaratsport.com` (décision d'Aymen, 26/10/2026 — les maquettes disent « moubaratsport.com », le domaine de l'app est le sous-domaine `app.`). */
export const PUBLIC_BASE_URL: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PUBLIC_BASE_URL ?? 'https://app.moubaratsport.com').replace(/\/+$/, '');

/** `https://app.moubaratsport.com/m/7KQ2XM` — ce que l'organisateur copie et partage. */
export function matchLink(code: string): string {
  return `${PUBLIC_BASE_URL}/m/${code}`;
}

/** `app.moubaratsport.com/m/7KQ2XM` — sans le protocole, comme dans les maquettes (ligne « copier le lien »). */
export function matchLinkLabel(code: string): string {
  return matchLink(code).replace(/^https?:\/\//, '');
}

/** Le code d'un chemin `/m/CODE` (majuscules, 4 à 10 signes de l'alphabet du serveur), sinon `null`. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/m\/([A-Za-z0-9]{4,10})\/?$/.exec(pathname);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  return /^[A-HJ-NP-Z2-9]+$/.test(code) ? code : null;
}

/** Le message d'invitation de la maquette (« On joue ? Rejoins le match : app.moubaratsport.com/m/7KQ2 »), toujours en français comme les liens wa.me des maquettes arabes. */
export function inviteText(code: string): string {
  return `On joue ? Rejoins le match : ${matchLinkLabel(code)}`;
}

export function inviteHref(code: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteText(code))}`;
}

/* --- Invitation en attente : l'arrivée par un lien avant d'avoir un compte ------------------------------------------------ */

const PENDING_KEY = 'moubarat.pendingMatch.v1';

export function savePendingMatch(code: string): void {
  try { window.sessionStorage.setItem(PENDING_KEY, code); } catch { /* la visite garde le code en mémoire */ }
}
export function loadPendingMatch(): string | null {
  try { return window.sessionStorage.getItem(PENDING_KEY); } catch { return null; }
}
export function clearPendingMatch(): void {
  try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* rien à nettoyer */ }
}
