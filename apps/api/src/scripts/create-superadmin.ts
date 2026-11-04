/* Création du superadmin sur une base RÉELLE (pilote, production) — jamais
   via le seed, qui vide toutes les tables. Voir platform/auth/superadmin.ts
   pour les règles (idempotent, ne promeut jamais, mot de passe minimal).

   Usage (depuis apps/api, variables lues depuis l'environnement ou .env) :
     SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… [SUPERADMIN_NAME=…] pnpm superadmin:create

   Les mêmes noms de variables que le seed : une seule chose à retenir, et
   docs/PASSATION.md §3 ne documente qu'un couple. Aucune valeur n'est
   affichée en clair (le mot de passe n'apparaît jamais dans la sortie). */
import { createDb, createPool, primeEnumArrayParsers } from '../db/client.js';
import { ensureSuperadmin } from '../platform/auth/superadmin.js';

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME;
  if (!email || !password) {
    console.error('Variables requises : SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD (SUPERADMIN_NAME optionnel).');
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  const pool = createPool(url);
  await primeEnumArrayParsers(pool);
  const db = createDb(pool);

  try {
    const result = await ensureSuperadmin(db, { email, password, name });
    if (result.outcome === 'created') {
      console.log(`Superadmin créé : ${result.email} (id ${result.id}).`);
    } else {
      console.log(`Superadmin déjà présent : ${result.email} — mot de passe INCHANGÉ, rien à faire.`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
