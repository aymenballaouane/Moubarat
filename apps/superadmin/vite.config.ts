import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* `design/moubarat-ds.css` et `design/sprite-icons.svg` importés depuis leur
   source gelée (jamais copiés), même patron que apps/crm/apps/player. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    fs: { allow: ['../..'] },
  },
});
