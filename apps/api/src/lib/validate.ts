import { badRequest } from './http.js';

/** Caractère de contrôle (hors saut de ligne si `allowNewline`) — jamais dans un champ texte. */
export function hasControlChar(s: string, allowNewline = false): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 32 && !(allowNewline && c === 10)) || c === 127) return true;
  }
  return false;
}

/** Téléphone d'un centre (affiché aux joueurs) — texte libre borné, MÊMES règles à la création
    (superadmin), à la modification par le superadmin et par le gérant (CRM). Vide → `null`. */
export function parseVenuePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw badRequest('Le téléphone doit être une chaîne de caractères.');
  const s = raw.trim();
  if (s === '') return null;
  if (s.length > 40 || hasControlChar(s)) throw badRequest('Téléphone : 40 caractères maximum, texte simple.');
  return s;
}
