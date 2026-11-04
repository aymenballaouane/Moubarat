/* Persona unique du joueur connecté, partagée par tous les ecrans (Booking,
   Match, Teams...). Avant ce fichier, matchDemo.ts définissait ses propres
   VIEWER_ID/CURRENT_USER_ID en local — un deuxième écran aurait pu diverger
   (un autre nom, un autre id) sans qu'aucune régle ne le remarque. Point
   « cohérence inter-écrans » du mandat produit : une seule source. */

/** Lot 3B (étape 2, lectures) : `let`, pas `const` — remplacé une seule fois
    par le vrai id serveur (`setCurrentUserId`, appelé par useAppStore.ts dès
    qu'une session réelle est confirmée), AVANT que la moindre donnée réelle
    ne soit rendue (App.tsx bloque le rendu tant que `store.bootstrapping`).
    Liaison vivante ESM : tout module import-ant `CURRENT_USER_ID` voit la
    valeur à jour à sa prochaine lecture, sans avoir à le passer en prop —
    des dizaines d'écrans le comparent déjà à `organizerId`/`userId` pour
    "est-ce moi/mon match", du routage (App.tsx) au store (isMine()) ; le
    réécrire en contexte React aurait été un chantier bien plus large qu'une
    intégration en lecture. Les données de démo restent construites UNE FOIS
    au chargement du module avec l'ancienne valeur ('u-aymen') — inoffensif :
    elles ne sont jamais rendues après une vraie connexion, remplacées par de
    vraies données avant le premier rendu (voir state/useAppStore.ts). */
export let CURRENT_USER_ID = 'u-aymen';
export function setCurrentUserId(id: string): void {
  CURRENT_USER_ID = id;
}

export const CURRENT_USER_NAME = 'Aymen';
/** Le numero verifie a l'auth — l'identifiant de connexion du compte
    (meme numero que la demo OTP de AuthFlow). */
export const CURRENT_USER_PHONE = '05 55 12 34 56';

/* Deuxième persona, utilisée uniquement quand un écran a besoin de démontrer
   « un autre joueur » distinct de l'utilisateur connecté (ex. Match Detail :
   Toi rejoins le match d'un autre organisateur). */
export const VIEWER_ID = 'u-toi';
