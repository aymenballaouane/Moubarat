import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Le core est consommé en sources TS (main: src/index.ts) — alias explicite
      // pour que vite/vitest le transforme comme le reste du code.
      '@moubarat/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Tests d'intégration sur un vrai Postgres : fichiers en série, timeouts larges.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
