/* MS-041 (audit final, Lot 2d, 18/11/2026, choix d'Aymen : « maintenant ») — version de l'app joueur et version minimale.
   L'app joueur envoie la version de SON code dans l'en-tête `X-Moubarat-App-Version` (apps/player/src/lib/appVersion.ts).
   C'est elle qui compte, pas le numéro du store : l'app Android affiche le site en ligne (toujours la dernière version),
   l'app iPhone embarque le code de son build (figé jusqu'à la mise à jour suivante).
   `MIN_PLAYER_APP_VERSION` (vide = aucun contrôle) : en dessous, toute requête répond 426 `APP_UPDATE_REQUIRED` et l'app
   affiche « Mets à jour Moubarat ». Règles :
   - une requête SANS cet en-tête passe toujours : le CRM, la console, et les apps installées avant ce lot (build iPhone 1.0,
     soumis le 11/11/2026) ne l'envoient pas — impossible de les forcer, les bloquer les couperait sans leur dire pourquoi ;
   - une valeur illisible passe aussi (jamais un joueur bloqué par une faute de frappe dans un build) ;
   - restent toujours ouvertes : sondes (/health, /ready), coordonnées du support (/support), textes juridiques (/legal). */

/** « 1.2.3 » → [1, 2, 3] ; « 1.2 » → [1, 2, 0] ; illisible → null. */
export function parseAppVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?$/.exec((v ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Vrai seulement si `version` est lisible ET strictement inférieure à `min` (lisible). */
export function isBelowMinVersion(version: string | null | undefined, min: string | null): boolean {
  const v = parseAppVersion(version);
  const m = parseAppVersion(min);
  if (!v || !m) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== m[i]!) return v[i]! < m[i]!;
  }
  return false;
}

export const APP_VERSION_HEADER = 'x-moubarat-app-version';

const ALWAYS_OPEN = /^\/(health|ready|support|legal)(\/|\?|$)/;

/** Les chemins jamais bloqués par la version minimale. */
export function isVersionGateExempt(url: string): boolean {
  return ALWAYS_OPEN.test(url);
}
