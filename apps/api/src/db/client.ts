import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

export type Db = Kysely<Database>;

/* Tableaux d'ENUM Postgres (aujourd'hui `fields.formats` : `match_format[]`).
   Le driver `pg` ne connaît que les OID des types intégrés : un tableau d'un
   enum créé par notre schéma lui est inconnu, il renvoie donc la chaîne brute
   « {5v5,7v7} » au lieu de ['5v5','7v7'] — trouvé le 04/09/2026 : l'API
   servait `formats: "{5v5}"` et la garde `field.formats.includes(format)`
   (core, match.ts) ne tenait que par accident (`String.includes`). Les OID
   d'un type créé par migration diffèrent d'une base à l'autre (bases de test
   éphémères comprises) : ils sont découverts par une requête explicite
   (`primeEnumArrayParsers`, APRÈS migration), jamais codés en dur, et le
   parseur est propre à CE pool (option `types`), jamais global au process. */

const OID_TEXT_ARRAY = 1009;
const ENUM_ARRAY_OIDS_SQL =
  "SELECT t.oid FROM pg_type t JOIN pg_type e ON e.oid = t.typelem WHERE e.typtype = 'e'";

const enumArrayOidsByPool = new WeakMap<pg.Pool, Set<number>>();

/** SEUL point de création d'un pool applicatif (serveur, seed, scripts,
    tests) : un `new pg.Pool` direct n'aurait pas le parseur et resservirait
    la chaîne brute. À faire suivre de `primeEnumArrayParsers(pool)` une fois
    la base migrée.

    Audit multi-centre 22/09/2026 (socle 2e centre, cadrage §2, finding F6) : `max` était la SEULE option
    réglable, sans délai d'attente de connexion ni limite de durée de requête — sous charge, une requête
    lente ou un client mal éteint pouvait affamer le pool indéfiniment, sans jamais échouer proprement.
    `connectionTimeoutMs` : au-delà, `pool.connect()`/une requête en attente d'une connexion libre échoue
    plutôt que de bloquer sans fin. `statementTimeoutMs` : chaque requête individuelle s'auto-annule côté
    Postgres au-delà (protège la base d'une requête coincée, jamais du pool applicatif lui-même). Cette
    fonction elle-même ne change rien sans arguments explicites (`max` défaut 10, aucun timeout) : les
    valeurs par défaut RECOMMANDÉES vivent dans env.ts, appliquées par index.ts (le vrai serveur) — les
    tests (setupTestStack) continuent d'appeler `createPool` sans ces options, comportement inchangé. */
export function createPool(connectionString: string, opts: {
  max?: number; connectionTimeoutMs?: number; statementTimeoutMs?: number;
  /** Mise à l'échelle L1 (25/09/2026) : `application_name` des connexions, visible dans `pg_stat_activity` et les
      journaux Postgres — avec plusieurs instances, c'est ce qui dit QUELLE instance tient un verrou ou une requête
      lente. Absent = Postgres n'en pose aucun (scripts, tests). Postgres tronque à 63 caractères. */
  applicationName?: string;
} = {}): pg.Pool {
  const enumArrayOids = new Set<number>();
  // `TypeId` de @types/pg n'énumère que les OID intégrés « connus » ; 1009
  // (text[]) en fait partie côté runtime mais pas côté types.
  const parseTextArray = pg.types.getTypeParser(OID_TEXT_ARRAY as never, 'text' as never) as (v: string) => string[];
  const types: pg.CustomTypesConfig = {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
      if (format !== 'binary' && enumArrayOids.has(oid)) return parseTextArray;
      return pg.types.getTypeParser(oid as never, format as never);
    }) as pg.CustomTypesConfig['getTypeParser'],
  };
  const pool = new pg.Pool({
    connectionString, max: opts.max ?? 10, types,
    ...(opts.connectionTimeoutMs !== undefined ? { connectionTimeoutMillis: opts.connectionTimeoutMs } : {}),
    ...(opts.statementTimeoutMs !== undefined ? { statement_timeout: opts.statementTimeoutMs } : {}),
    ...(opts.applicationName ? { application_name: opts.applicationName } : {}),
  });
  /* Sans écouteur, une erreur sur une connexion INACTIVE du pool (Postgres la coupe : redémarrage, maintenance, bascule,
     `DROP DATABASE … WITH (FORCE)` des tests — code 57P01) est une exception non attrapée qui fait tomber tout le processus.
     Le pool retire lui-même la connexion fautive et en rouvre une à la demande suivante : on journalise, on ne plante pas.
     (Constaté le 07/11/2026 : c'est ce qui rendait la vérification GitHub rouge alors que tous les tests passaient.) */
  pool.on('error', (err: Error & { code?: string }) => {
    console.error(JSON.stringify({ level: 50, event: 'pg_pool_idle_error', code: err.code ?? null, msg: err.message }));
  });
  enumArrayOidsByPool.set(pool, enumArrayOids);
  return pool;
}

/** Découvre les OID des tableaux d'enum de LA base derrière ce pool et les
    enregistre auprès de son parseur. Idempotent ; à appeler après
    `migrate()` (les types n'existent pas avant) et avant la première
    lecture applicative. Sans effet sur un pool créé sans `createPool`. */
export async function primeEnumArrayParsers(pool: pg.Pool): Promise<number> {
  const set = enumArrayOidsByPool.get(pool);
  if (!set) return 0;
  const res = await pool.query<{ oid: number | string }>(ENUM_ARRAY_OIDS_SQL);
  for (const row of res.rows) set.add(Number(row.oid));
  return set.size;
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
