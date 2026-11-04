/* Migrateur minimal, délibérément lisible :
   - 0001 = packages/core/schema.sql, LU DEPUIS LE FICHIER GELÉ (jamais copié,
     donc jamais divergent) ;
   - puis les fichiers apps/api/migrations/*.sql en ordre lexicographique ;
   - chaque migration appliquée est enregistrée dans schema_migrations, DANS LA MÊME TRANSACTION que son
     application (mise à l'échelle L4, 25/09/2026 : jamais « appliquée mais non enregistrée », donc jamais rejouée) ;
   - UN SEUL migrateur à la fois : verrou consultatif Postgres pris pour toute l'exécution. Deux instances (ou deux
     opérateurs) qui lancent `db:migrate` en même temps ne se marchent plus dessus — la seconde attend, puis trouve
     le schéma à jour et n'applique rien (avant : la seconde échouait sur « relation déjà existante »). */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SCHEMA = join(HERE, '..', '..', '..', '..', 'packages', 'core', 'schema.sql');
const API_MIGRATIONS_DIR = join(HERE, '..', '..', 'migrations');

interface Migration { name: string; sql: string; }

export function listMigrations(): Migration[] {
  const out: Migration[] = [
    { name: '0001_schema_core', sql: readFileSync(CORE_SCHEMA, 'utf8') },
  ];
  if (existsSync(API_MIGRATIONS_DIR)) {
    for (const f of readdirSync(API_MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      out.push({ name: f.replace(/\.sql$/, ''), sql: readFileSync(join(API_MIGRATIONS_DIR, f), 'utf8') });
    }
  }
  return out;
}

/** Noms des migrations connues de CE code, dans l'ordre d'application (sans lire leur contenu). */
export function listMigrationNames(): string[] {
  const names = ['0001_schema_core'];
  if (existsSync(API_MIGRATIONS_DIR)) {
    for (const f of readdirSync(API_MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) names.push(f.replace(/.sql$/, ''));
  }
  return names;
}

const LOCK_SQL = `hashtext('moubarat:migrate')`;

/** `log` : reçoit le message d'attente quand un autre migrateur tient le verrou (le CLI l'affiche ; les tests l'ignorent). */
export async function migrate(pool: pg.Pool, log: (message: string) => void = () => {}): Promise<string[]> {
  // Une connexion DÉDIÉE : le verrou consultatif est attaché à la SESSION, il doit vivre aussi longtemps que la boucle.
  const client = await pool.connect();
  try {
    const got = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
    if (!got.rows[0]?.locked) {
      log('Une autre migration est en cours : attente de son verrou…');
      await client.query(`SELECT pg_advisory_lock(${LOCK_SQL})`);
    }
    // Sous le verrou : la création de la table de suivi ne peut plus courir contre un autre migrateur.
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const applied: string[] = [];
    for (const m of listMigrations()) {
      if (done.has(m.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      applied.push(m.name);
    }
    return applied;
  } finally {
    // Libérer le verrou ; si la connexion est cassée, la DÉTRUIRE (le verrou disparaît avec la session) plutôt que
    // de la rendre au pool avec un verrou encore tenu.
    let unlocked = false;
    try { await client.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`); unlocked = true; } catch { /* connexion cassée */ }
    client.release(!unlocked);
  }
}

/* Exécutable : `pnpm --filter @moubarat/api db:migrate` */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/moubarat';
  // application_name : `pg_stat_activity` montre QUI tient le verrou de migration si un déploiement paraît bloqué.
  const pool = new pg.Pool({ connectionString: url, application_name: 'moubarat-migrate' });
  migrate(pool, console.log)
    .then((applied) => {
      console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Schéma déjà à jour.');
      return pool.end();
    })
    .catch((err) => { console.error(err); process.exitCode = 1; return pool.end(); });
}
