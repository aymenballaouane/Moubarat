/* Audit final, MS-039 (12/11/2026) — Caisse : `Number(x) || 0` transformait une saisie vide en 0 (une clôture sans montant
   enregistrait un écart fictif) et « 50 000 » (espace des milliers, comme on l'écrit) en 0. Un montant en DA se lit ici :
   entier ≥ 0, espaces de milliers acceptés (y compris insécables) ; vide ou non numérique → null, jamais 0 en silence. */
export function parseDaAmount(input: string): number | null {
  const s = input.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
