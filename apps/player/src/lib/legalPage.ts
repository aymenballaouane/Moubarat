/* Pages publiques des textes juridiques (Lot 13, décision d'Aymen du 26/10/2026) — « publie le texte déjà fourni comme une vraie page publique dans l'app web, que les stores peuvent
   ouvrir ». Deux adresses, lisibles SANS compte : `/confidentialite` (politique de confidentialité — l'adresse à donner à Google Play et à l'App Store) et `/conditions` (CGU). Le texte
   est celui de l'avocat, servi par `GET /legal/:doc` (modules/legal/content.ts) : jamais une deuxième copie ici. Français seulement pour l'instant ; l'arabe viendra si l'avocat le fournit. */

export type PublicLegalDoc = 'CONFIDENTIALITE' | 'CGU';

export const PUBLIC_LEGAL_PATHS: Record<PublicLegalDoc, string> = { CONFIDENTIALITE: '/confidentialite', CGU: '/conditions' };

/** Le document d'un chemin public (« /confidentialite », « /conditions », avec ou sans barre finale), sinon `null`. */
export function legalDocFromPath(pathname: string): PublicLegalDoc | null {
  const p = pathname.replace(/\/+$/, '').toLowerCase();
  if (p === PUBLIC_LEGAL_PATHS.CONFIDENTIALITE) return 'CONFIDENTIALITE';
  if (p === PUBLIC_LEGAL_PATHS.CGU) return 'CGU';
  return null;
}

/** « 29 septembre 2026 » — la date de publication affichée sous le titre (le serveur sert une date ISO). */
export function legalDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
