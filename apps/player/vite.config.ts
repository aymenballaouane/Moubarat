import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/* Décision d'Aymen (27/10/2026) : aucune police chargée depuis Internet. Le design system gelé (design/moubarat-ds.css, partagé avec le CRM, jamais modifié)
   commence par un @import Google Fonts (Bebas Neue, Barlow, IBM Plex Mono) ; ce plugin le retire À LA VOLÉE pour l'app joueur seulement. Bebas Neue vient de
   styles/fonts.css ; Barlow et la Mono ne servent pas ici (--font-body / --font-mono = Inter dans theme-app-joueur.css). */
const withoutRemoteFonts = (): Plugin => ({
  name: 'moubarat-no-remote-fonts',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('/design/moubarat-ds.css')) return null;
    return code.replace(/@import\s+url\((['"])https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/g, '/* @import Google Fonts retire pour l app joueur (polices embarquees) */');
  },
});

/* host: true (toutes les interfaces, pas seulement localhost) — pour tester sur
   un téléphone par le Wi-Fi local (docs/DEMO.md, pratique déjà établie
   d'Aymen : "le code arrive dans le terminal de l'API... à lire avant de le
   saisir"). Sans danger hors de ce poste : le Wi-Fi local n'est joignable que
   depuis le même réseau. */
export default defineConfig({
  plugins: [withoutRemoteFonts(), react()],
  server: { port: 5175, host: true, fs: { allow: ['../..'] } },
  /* MapLibre 6 (20/11/2026) : sa tâche de fond est un fichier « .mjs » (components/map/VectorMap.tsx). L'app iPhone (Capacitor) sert les
     fichiers avec un type déduit de l'extension et ne connaît pas « .mjs » (application/octet-stream → tâche de fond refusée) : on le
     publie en « .js ». */
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (asset) => ((asset.names?.[0] ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
});
