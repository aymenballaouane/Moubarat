/* MS-041 (audit final, Lot 2d, 18/11/2026) — la version du CODE de l'app joueur, envoyée à l'API sur chaque appel
   (en-tête `X-Moubarat-App-Version`, lib/api.ts) et annoncée à l'habillage iPhone (message `ready`, lib/native.ts).
   Côté serveur, `MIN_PLAYER_APP_VERSION` peut exiger une version minimale (apps/api/src/lib/app-version.ts) : en dessous,
   l'app affiche « Mets à jour Moubarat » (components/MiseAJourRequise.tsx).
   À AUGMENTER à chaque changement de l'app qui doit pouvoir être imposé aux iPhone (le code y est embarqué dans le build,
   figé jusqu'à la mise à jour suivante ; l'app Android et le site, eux, servent toujours la dernière version) :
   « 1.1.0 » → « 1.2.0 ». Seuls des nombres séparés par des points (1 à 3). */
export const APP_VERSION = '1.1.0';
