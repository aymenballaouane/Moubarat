/* Port fidele de fmt() (prototypes/crm-valide.html) : separateur des milliers
   francais. toLocaleString('fr-FR') separe les milliers avec un caractere
   espace fine insecable (U+202F) ou insecable (U+00A0) selon l'environnement
   — normalise en espace simple pour un rendu coherent quelle que soit la
   police. Codes numeriques plutot que des caracteres litteraux dans la
   regex : plus lisible et sans ambiguite d'encodage. */
const THIN_SPACE_CODES = [0x202f, 0x00a0];

export function fmt(n: number): string {
  let out = n.toLocaleString('fr-FR');
  for (const code of THIN_SPACE_CODES) {
    out = out.split(String.fromCharCode(code)).join(' ');
  }
  return out;
}
