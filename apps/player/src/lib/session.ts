import type { SkillLevel, Sport } from '@moubarat/core';

/* Session réelle (Lot 3B, socle auth/session) — un jeton Bearer, rien
   d'autre. Remplace le marqueur {name,sport,level} du Lot 2, qui était
   explicitement documenté comme n'étant PAS une authentification de
   production (aucun jeton, aucune expiration, aucune vérification serveur).

   Le signal "suis-je connecté ?" est désormais "un jeton existe ET le
   serveur l'accepte encore" — vérifié via GET /auth/me au chargement
   (state/useAppStore.ts), jamais la seule présence locale. Politique de
   session : fenêtre GLISSANTE de 30 jours d'INACTIVITÉ (décidée et
   implémentée le 30/08/2026, voir docs/DECISIONS.md) — le TTL se prolonge à
   chaque requête authentifiée réussie (`last_seen_at`, apps/api/src/auth/
   guards.ts), jamais ancré sur la seule création de session. Décision
   entièrement côté serveur : ce fichier n'a et n'aura jamais de logique
   d'expiration locale, seul le serveur reste juge (voir GET /auth/me).

   Enveloppe try/catch partout : localStorage peut lever (navigation privée,
   quota, contexte sandboxé) — jamais casser l'app pour autant. */

const TOKEN_KEY = 'moubarat.session.token.v1';

export function loadToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function saveToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* session en mémoire pour cette visite */ }
}

export function clearToken(): void {
  try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* rien à nettoyer */ }
}

/* --- Message à l'écran de connexion (audit produit JO7, 22/09/2026) ----------
   Un compte suspendu en cours de session est déconnecté ; le message du SERVEUR (« Ce compte est suspendu… »)
   est gardé le temps d'un rechargement et montré sur l'écran de connexion, jamais une déconnexion muette.
   sessionStorage (par onglet), jamais localStorage : ce message ne doit pas survivre à la visite. Lu sans être
   effacé (`peek`) puis effacé à part : un rendu double en développement ne doit pas le perdre. */

const NOTICE_KEY = 'moubarat.auth.notice.v1';

export function saveAuthNotice(message: string): void {
  try { window.sessionStorage.setItem(NOTICE_KEY, message); } catch { /* message perdu : l'écran de connexion s'affiche quand même */ }
}

export function peekAuthNotice(): string | null {
  try { return window.sessionStorage.getItem(NOTICE_KEY); } catch { return null; }
}

export function clearAuthNotice(): void {
  try { window.sessionStorage.removeItem(NOTICE_KEY); } catch { /* rien à nettoyer */ }
}

/* --- Préférences locales (sport/niveau) -----------------------------------
   `sport`/`level` n'existent nulle part côté serveur (table `users` : juste
   id/phone/name/role — cf. audit Lot 3A §1, ligne Auth OTP) : ce sont des
   préférences d'affichage 100% locales, découplées de l'authentification.
   Stockées à part pour que "es-tu connecté" et "quelles sont tes
   préférences" restent deux questions distinctes — la première ne doit
   jamais dépendre de la seconde. */

const PREFS_KEY = 'moubarat.prefs.v1';

export interface LocalPrefs { sport: Sport | null; level: SkillLevel | null }

export function loadPrefs(): LocalPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { sport: null, level: null };
    const parsed = JSON.parse(raw) as Partial<LocalPrefs>;
    return { sport: parsed.sport ?? null, level: parsed.level ?? null };
  } catch {
    return { sport: null, level: null };
  }
}

export function savePrefs(p: LocalPrefs): void {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* préférences en mémoire pour cette visite */ }
}

export function clearPrefs(): void {
  try { window.localStorage.removeItem(PREFS_KEY); } catch { /* rien à nettoyer */ }
}
