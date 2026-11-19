/* Ce que l'appelant sait afficher — lot « Match libre » (décisions d'Aymen du 16 et du 17/11/2026).

   Les apps déjà publiées (iPhone 1.0 et 1.0.1, Android 1.0.4, toute page web mise en cache avant ce lot) n'envoient AUCUNE version :
   impossible de les reconnaître. C'est donc l'inverse : un client À JOUR se déclare par l'en-tête `X-Moubarat-Features` (liste séparée
   par des virgules) — l'app joueur, le CRM et la console l'envoient à partir de ce lot. Un appel sans lui est traité comme une ancienne
   app de téléphone, à qui l'on cache ce qu'elle ne connaît pas :
   - `match-libre` : les matchs sans centre (phase 5) ;
   - `format-9v9` : le format 9 contre 9 (phase 9v9) — le CRM et la console se déclarent aussi, sans quoi le gérant ne verrait plus le
     9v9 qu'il vient d'ajouter. */

export const FEATURE_FREE_MATCH = 'match-libre';
export const FEATURE_FORMAT_9V9 = 'format-9v9';

type Headers = Record<string, string | string[] | undefined>;

export function clientFeatures(headers: Headers): Set<string> {
  const raw = headers['x-moubarat-features'];
  const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  return new Set(value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
}

/** Les formats que cet appelant ne sait pas afficher (vide pour un client à jour). */
export function hiddenFormats(headers: Headers): ReadonlySet<string> {
  return clientFeatures(headers).has(FEATURE_FORMAT_9V9) ? new Set() : new Set(['9v9']);
}
