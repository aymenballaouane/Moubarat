import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* `design/moubarat-ds.css` et `design/sprite-icons.svg` sont importés
   directement depuis leur source gelée (jamais copiés dans apps/crm) —
   server.fs.allow ouvre la racine du monorepo au serveur de dev pour ça. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    fs: { allow: ['../..'] },
  },
});
