import { getLang } from './lang.js';
/* Port fidele de fmt() (prototypes/crm-valide.html) : separateur des milliers
   francais. toLocaleString('fr-FR') separe les milliers avec un caractere
   espace fine insecable (U+202F) ou insecable (U+00A0) selon l'environnement
   — normalise en espace simple pour un rendu coherent quelle que soit la
   police. Codes numeriques plutot que des caracteres litteraux dans la
   regex : plus lisible et sans ambiguite d'encodage. */
const THIN_SPACE_CODES = [0x202f, 0x00a0];

/* P1-15 (CRM en arabe, lot A, 15/11/2026) : dans une page de droite à gauche, une espace ORDINAIRE entre « 2 » et « 850 »
   coupe le nombre en deux (« 850 2 ») ; l'espace insécable le garde d'un seul tenant (classe bidi « séparateur commun »).
   Espace ordinaire en français (rendu inchangé), insécable en arabe. Chiffres 0-9 dans les deux langues. */
export function fmt(n: number): string {
  const sep = getLang() === 'ar' ? String.fromCharCode(0x00a0) : ' ';
  let out = n.toLocaleString('fr-FR');
  for (const code of THIN_SPACE_CODES) {
    out = out.split(String.fromCharCode(code)).join(sep);
  }
  return out;
}
