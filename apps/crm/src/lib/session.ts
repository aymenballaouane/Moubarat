/* Session CRM — un jeton Bearer, même politique que apps/superadmin/src/lib/session.ts :
   "suis-je connecté ?" = "un jeton existe ET le serveur l'accepte encore" (GET
   /platform/auth/me au chargement), jamais la seule présence locale. Espace de
   stockage distinct de la console plateforme (même API, deux identités séparées). */

const TOKEN_KEY = 'moubarat.crm.token.v1';

export function loadToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function saveToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* session en mémoire pour cette visite */ }
}

export function clearToken(): void {
  try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* rien à nettoyer */ }
}
