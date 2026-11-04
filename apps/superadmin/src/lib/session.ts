/* Session SUPERADMIN — un jeton Bearer, même politique que apps/player/src/lib/session.ts :
   "suis-je connecté ?" = "un jeton existe ET le serveur l'accepte encore" (GET /platform/auth/me
   au chargement), jamais la seule présence locale. Try/catch partout : localStorage peut lever. */

const TOKEN_KEY = 'moubarat.superadmin.token.v1';

export function loadToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function saveToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* session en mémoire pour cette visite */ }
}

export function clearToken(): void {
  try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* rien à nettoyer */ }
}
