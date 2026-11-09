import type { CapacitorConfig } from '@capacitor/cli';

/* Habillage natif iOS (chemin A, docs/IOS_SCOPING.md §3 / docs/IOS_HANDOVER.md).
   Le contenu = le build de production d'apps/player, EMBARQUÉ dans le binaire
   (webDir), jamais chargé depuis un serveur. L'API reste distante : sa base
   URL est fixée au build du player (VITE_API_BASE_URL), et l'origine de
   l'habillage (`capacitor://localhost`) doit figurer dans CORS_ORIGINS côté
   apps/api (voir env.ts). */
const config: CapacitorConfig = {
  /* Identifiant de bundle — DÉCIDÉ par Aymen le 26/10/2026 : `com.moubarat.app`, le même que le nom de paquet Android. Définitif une fois l'app
     créée dans App Store Connect ; doit correspondre à l'App ID créé sur developer.apple.com. */
  appId: 'com.moubarat.app',
  appName: 'Moubarat Sport',
  webDir: '../player/dist',
  ios: {
    /* Le web occupe toute la zone que lui laisse la barre d'onglets native ;
       les marges de sécurité (encoche, indicateur d'accueil) sont déjà
       gérées par le CSS du player (env(safe-area-inset-*)). */
    contentInset: 'never',
    /* Fond réel de l'app (--ink) derrière la WKWebView : jamais de flash
       blanc au lancement ni pendant un rechargement. */
    backgroundColor: '#050505',
    /* Pas de rebond élastique : une app, pas une page web. */
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
  server: {
    /* Schéma par défaut de Capacitor iOS — rappelé explicitement parce que
       c'est LUI qui fixe l'origine à autoriser en CORS. */
    iosScheme: 'capacitor',
  },
};

export default config;
