import { sql } from 'kysely';
import type { Db } from './client.js';
import { listMigrationNames } from './migrate.js';

/* Migrations connues de CE code mais pas encore appliquées à la base (mise à l'échelle L4, 25/09/2026).
   Cas réel qu'un déploiement à plusieurs instances rend fréquent : le NOUVEAU code démarre avant que `db:migrate` ait
   tourné — il répondrait « prêt » puis échouerait à la première requête qui touche une colonne ou une table absente.
   `/ready` s'en sert pour répondre 503 `MIGRATIONS_PENDING` : le répartiteur n'envoie rien à cette instance, les
   anciennes continuent de servir. L'inverse (base plus récente que le code : une instance ancienne encore en place
   pendant un déploiement progressif) n'est PAS un problème — seules les migrations que ce code connaît comptent. */
export async function pendingMigrations(db: Db): Promise<string[]> {
  let applied: Set<string>;
  try {
    const rows = await sql<{ name: string }>`SELECT name FROM schema_migrations`.execute(db);
    applied = new Set(rows.rows.map((r) => r.name));
  } catch (err) {
    // 42P01 : la table de suivi n'existe pas — base jamais migrée, tout est en attente.
    if ((err as { code?: string }).code !== '42P01') throw err;
    applied = new Set();
  }
  return listMigrationNames().filter((name) => !applied.has(name));
}
