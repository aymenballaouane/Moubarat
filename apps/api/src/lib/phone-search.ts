/* Recherche par numéro de téléphone (CRM-2 / CRM-3, audit pré-lancement, 27/09/2026).

   Deux colonnes, deux écritures : `users.phone` est en E.164 (`+213555000195`, normalisé à l'inscription), tandis que
   `bookings.customer_phone` est du TEXTE LIBRE saisi au comptoir (`0555 00 01 95`, `05-55-00-01-95`…). L'accueil, lui,
   tape ce qu'il a sous les yeux — souvent un morceau de numéro. La règle : on compare des CHIFFRES, des deux côtés
   (`regexp_replace(colonne, '\D', '', 'g')` côté SQL), et la saisie est déclinée dans les écritures équivalentes d'un
   mobile algérien (`0555…` ⇔ `213555…` ⇔ `00213555…`), pour qu'un numéro national retrouve un compte E.164 et
   inversement. Sous 4 chiffres, pas de recherche téléphonique : « 05 » trouverait tout le pays. */

const MIN_DIGITS = 4;

/** Les chiffres de la saisie, sans séparateurs. */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Les motifs `LIKE` (`%chiffres%`) à comparer aux chiffres d'une colonne téléphone, ou `null` si la saisie ne contient
    pas assez de chiffres pour désigner un numéro. La saisie et ses écritures équivalentes (national ⇔ international). */
export function phoneSearchPatterns(raw: string): string[] | null {
  const d = phoneDigits(raw);
  if (d.length < MIN_DIGITS) return null;
  const forms = new Set<string>([d]);
  const intl = d.startsWith('00') ? d.slice(2) : d;
  if (intl.startsWith('213') && intl.length > 3) {
    forms.add(intl);
    forms.add(`0${intl.slice(3)}`);
  } else if (d.startsWith('0') && !d.startsWith('00')) {
    forms.add(`213${d.slice(1)}`);
  }
  return [...forms].map((f) => `%${f}%`);
}

/** Motif `ILIKE` qui trouve `text` n'importe où, ses caractères spéciaux (`%`, `_`, `\`) échappés — à utiliser avec
    `ESCAPE '\'`. Même échappement que la recherche des joueurs de la console (platform/users/routes.ts). */
export function containsLike(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
