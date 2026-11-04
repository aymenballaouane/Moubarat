/* « Appeler » (règle 31, 26/10/2026) : le numéro d'un autre joueur n'arrive que par GET /matches/:id/contacts — l'organisateur d'un match qu'on a rejoint,
   ou les joueurs (avec l'accord « numéro visible ») d'un match qu'on organise. Ici : seulement la mise en forme du lien `tel:` et le rangement par joueur. */

export interface MatchContact { userId: string; phone: string }

/** `tel:+213550214407`, ou `null` si la valeur n'est pas un numéro (chiffres, espaces, points, tirets, parenthèses, « + » initial) : jamais un texte quelconque du serveur dans un lien. */
export function telHref(phone: string): string | null {
  if (!/^\+?[\d\s.()-]{6,20}$/.test(phone.trim())) return null;
  const digits = phone.replace(/\D/g, '');
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`;
}

/** Les contacts rangés par identifiant de joueur (un seul numéro par joueur). */
export function contactsByUser(contacts: readonly MatchContact[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of contacts) out[c.userId] = c.phone;
  return out;
}
