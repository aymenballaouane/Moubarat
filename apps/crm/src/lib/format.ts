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

/** P1-15 (lot C) : un montant avec sa devise — « 2 850 DA » en français (inchangé), « 2 850 دج » en arabe. */
export function da(n: number): string {
  return `${fmt(n)} ${getLang() === 'ar' ? 'دج' : 'DA'}`;
}

/** Design P2-7 (24/11/2026) : numéro algérien lisible, comme le prototype (« 05 61 22 33 44 ») — « +213555100023 »,
    « 00213… » et « 0555100023 » donnent tous « 05 55 10 00 23 ». Tout autre format (numéro étranger, fixe incomplet,
    saisie libre) est rendu tel quel : jamais un numéro faussé pour le faire entrer dans la grille. Affichage seulement —
    les liens `tel:` gardent le numéro d'origine. */
export function phoneDisplay(raw: string): string {
  const compact = raw.replace(/[\s.\-  ]/g, '');
  const local = compact.startsWith('+213') ? `0${compact.slice(4)}`
    : compact.startsWith('00213') ? `0${compact.slice(5)}`
      : compact;
  if (!/^0\d{9}$/.test(local)) return raw;
  return local.replace(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
}

const AUDIT_DAY_NAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const AUDIT_MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Design P2-8/P2-9 (24/11/2026) : le résumé d'une entrée du Journal est un texte écrit par le serveur au moment de
    l'action (append-only, jamais réécrit) — « 1600 DA/h », « le 2026-11-12 ». Mis en forme ICI, à l'affichage, pour
    l'historique comme pour les nouvelles entrées : date ISO → « jeu. 12 nov. 2026 », montant de 4 à 7 chiffres suivi de
    « DA » (y compris « 1600 → 1800 DA/h ») → « 1 600 ». Jamais touchés : années, références (« GRE-001088 »),
    numéros de téléphone, heures, compteurs (« 1200 lignes »). */
export function prettyAuditText(summary: string): string {
  return summary
    .replace(/(^|[^\w-])(\d{4})-(\d{2})-(\d{2})(?![\w-])/g, (all, pre: string, y: string, m: string, d: string) => {
      const mi = Number(m) - 1;
      const di = Number(d);
      if (mi < 0 || mi > 11 || di < 1 || di > 31) return all;
      const wd = new Date(Date.UTC(Number(y), mi, di)).getUTCDay();
      return `${pre}${AUDIT_DAY_NAMES[wd]} ${di} ${AUDIT_MONTH_NAMES[mi]} ${y}`;
    })
    .replace(/(^|[^\w\-.,:/])([1-9]\d{3,6})(?=(?:\s*→\s*[1-9]\d*)?\s*DA\b)/g, (_all, pre: string, n: string) => `${pre}${fmt(Number(n))}`);
}
