/* Recherche de texte insensible à la casse ET aux accents, côté SQL (mise à l'échelle L3, 25/09/2026).

   Postgres n'a pas l'extension `unaccent` ici (une dépendance d'hébergement de plus pour un gain minime), et
   `translate(colonne, table_accents, table_lettres)` évalué sur CHAQUE ligne coûtait cher : mesuré le 25/09 sur
   100 000 joueurs, 600 ms pour une simple recherche par nom (l'évaluation, pas la lecture). L'astuce : ne pas
   transformer la colonne, transformer le MOTIF. Chaque lettre cherchée devient une classe qui contient la lettre et
   toutes ses variantes accentuées (`elite` → `[eèéêë]l[iìíîï]t[eèéêë]`), comparée avec l'opérateur `~*` (insensible à la
   casse) — une seule passe sur la colonne, sans fonction par ligne. Les variantes accentuées MAJUSCULES sont dans la
   classe : la comparaison ne dépend pas de la locale de la base (en locale « C », `~*` ne replie pas les accents). Tout
   caractère spécial d'expression régulière tapé par l'utilisateur est échappé : jamais un motif, toujours du texte. */

/** Correspondance lettres accentuées → lettres nues (le français), minuscules puis majuscules. Même longueur des deux côtés. */
export const FOLD_FROM = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ' + 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ';
export const FOLD_TO = 'aaaaaaceeeeiiiinooooouuuuyy' + 'aaaaaaceeeeiiiinooooouuuuy';

/** Insensible aux accents et à la casse — même définition que `fold` côté app joueur (lib/venueFilters.ts). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** base nue → toutes ses variantes accentuées (minuscules et majuscules). */
const VARIANTS = (() => {
  const map = new Map<string, string>();
  const from = [...FOLD_FROM];
  const to = [...FOLD_TO];
  from.forEach((accented, i) => map.set(to[i]!, (map.get(to[i]!) ?? '') + accented));
  return map;
})();

const REGEX_SPECIALS = /[\\^$.|?*+()[\]{}]/;

/** Motif d'expression régulière POSIX (opérateur `~*`) qui trouve `text` n'importe où dans une colonne, sans tenir
    compte de la casse ni des accents. À passer comme paramètre lié, jamais concaténé dans du SQL. */
export function accentInsensitiveRegex(text: string): string {
  return [...foldText(text)].map((c) => {
    const variants = VARIANTS.get(c);
    if (variants) return `[${c}${variants}]`;
    return REGEX_SPECIALS.test(c) ? `\\${c}` : c;
  }).join('');
}
