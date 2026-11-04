import { randomBytes } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb, createPool } from '../src/db/client.js';
import { listMigrationNames, migrate } from '../src/db/migrate.js';
import { readEnv } from '../src/env.js';
import { Lifecycle } from '../src/lib/lifecycle.js';
import { buildServer } from '../src/server.js';
import { LOOSE_LIMITS, setupTestStack, type TestStack } from './helpers.js';

/* Mise à l'échelle, lot L4 (25/09/2026) — ce qui rend l'API sûre à plusieurs instances derrière un répartiteur de charge
   (docs/PASSATION.md §4.10) : /ready qui dit la vérité (arrêt en cours, migrations manquantes), identifiant de requête
   unique entre instances, délai de réception d'une requête, migrations qui ne se marchent pas dessus. Vrai Postgres 16
   éphémère. */

describe('/ready, /health et l’arrêt en cours', () => {
  let stack: TestStack;
  const lifecycle = new Lifecycle();
  let appDb: TestStack['db'];
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    stack = await setupTestStack();
    appDb = stack.db;
    // Un serveur qui PARTAGE son état d'arrêt avec le test (comme index.ts le fait avec la séquence d'arrêt).
    app = await buildServer({ db: appDb, env: readEnv({ databaseUrl: 'postgres://unused', ...LOOSE_LIMITS }), logger: false, lifecycle });
    await app.ready();
  });
  afterAll(async () => { await app.close(); await stack.teardown(); });

  it('avant l’arrêt : prêt (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ready: boolean }).ready).toBe(true);
    expect(res.headers.connection).not.toBe('close');
  });

  it('en cours d’arrêt : /ready répond 503 DRAINING (le répartiteur la retire), /health reste 200 (jamais tuée avant l’heure)', async () => {
    lifecycle.beginDraining();
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ ready: false, reason: 'DRAINING' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });

  it('en cours d’arrêt, elle CONTINUE de servir normalement (c’est tout l’intérêt du drainage) — avec « Connection: close »', async () => {
    const res = await app.inject({ method: 'GET', url: '/venues' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.connection).toBe('close');
  });
});

describe('/ready sur une base LENTE — sonde d’alerte contre sonde de répartiteur', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(async () => { await stack.teardown(); });

  it('> 500 ms : /ready répond 503 (les alertes), /ready?ignoreLatency=1 reste 200 avec slow=true (un répartiteur ne doit pas retirer toutes les instances parce que la base rame)', async () => {
    const url = (stack.pool as unknown as { options: { connectionString: string } }).options.connectionString;
    const slowPool = createPool(url, { max: 2 });
    // Chaque requête de cette connexion attend 600 ms de plus : une base « qui répond mais rame ».
    const connect = slowPool.connect.bind(slowPool) as unknown as () => Promise<{ query: (...a: unknown[]) => Promise<unknown> }>;
    (slowPool as unknown as { connect: unknown }).connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      client.query = async (...args: unknown[]) => { await new Promise<void>((r) => { setTimeout(r, 600); }); return query(...args); };
      return client;
    };
    const app = await buildServer({ db: createDb(slowPool), env: readEnv({ databaseUrl: url, ...LOOSE_LIMITS }), logger: false });
    try {
      const strict = await app.inject({ method: 'GET', url: '/ready' });
      expect(strict.statusCode).toBe(503);
      expect(strict.json()).toMatchObject({ ready: false, slow: true });
      expect((strict.json() as { dbLatencyMs: number }).dbLatencyMs).toBeGreaterThan(500);

      const lenient = await app.inject({ method: 'GET', url: '/ready?ignoreLatency=1' });
      expect(lenient.statusCode).toBe(200);
      expect(lenient.json()).toMatchObject({ ready: true, slow: true });

      // Le paramètre n'excuse RIEN d'autre : en cours d'arrêt, même version « répartiteur » répond 503.
      const lifecycle = new Lifecycle();
      const draining = await buildServer({ db: stack.db, env: readEnv({ databaseUrl: url, ...LOOSE_LIMITS }), logger: false, lifecycle });
      lifecycle.beginDraining();
      expect((await draining.inject({ method: 'GET', url: '/ready?ignoreLatency=1' })).statusCode).toBe(503);
      await draining.close();
    } finally {
      await app.close();
      await slowPool.end();
    }
  }, 30_000);
});

describe('/ready et les migrations manquantes', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(async () => { await stack.teardown(); });

  it('une migration connue du code mais absente de la base : 503 MIGRATIONS_PENDING avec le nombre ; puis prêt une fois appliquée ; jamais re-vérifié ensuite', async () => {
    const last = listMigrationNames().at(-1)!;
    await sql`DELETE FROM schema_migrations WHERE name = ${last}`.execute(stack.db);
    const pending = await stack.app.inject({ method: 'GET', url: '/ready' });
    expect(pending.statusCode).toBe(503);
    expect(pending.json()).toEqual({ ready: false, reason: 'MIGRATIONS_PENDING', pendingMigrations: 1 });
    // /health (vivant) n'est pas concerné : l'instance vit, elle attend simplement sa base.
    expect((await stack.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

    await sql`INSERT INTO schema_migrations (name) VALUES (${last})`.execute(stack.db);
    expect((await stack.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);

    // Une fois le schéma reconnu à jour, il l'est pour toujours : plus de requête de contrôle à chaque sonde.
    await sql`DELETE FROM schema_migrations WHERE name = ${last}`.execute(stack.db);
    expect((await stack.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    await sql`INSERT INTO schema_migrations (name) VALUES (${last})`.execute(stack.db);
  });
});

describe('identifiant de requête', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(async () => { await stack.teardown(); });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('sans en-tête : un UUID, DIFFÉRENT à chaque requête (le compteur par processus de Fastify se répétait entre instances)', async () => {
    const a = await stack.app.inject({ method: 'GET', url: '/health' });
    const b = await stack.app.inject({ method: 'GET', url: '/health' });
    expect(a.headers['x-request-id']).toMatch(UUID);
    expect(b.headers['x-request-id']).toMatch(UUID);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('un X-Request-Id sûr (posé par le répartiteur ou le client) est repris tel quel', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'lb-7f3a.9c2_d1-XYZ' } });
    expect(res.headers['x-request-id']).toBe('lb-7f3a.9c2_d1-XYZ');
  });

  it('un X-Request-Id de forme dangereuse (espaces, balises, retour à la ligne, trop long, vide) est REMPLACÉ — jamais un texte libre dans les journaux', async () => {
    for (const bad of ['a b', '<script>alert(1)</script>', 'x'.repeat(65), '', 'ligne\nfausse', 'accentué']) {
      const res = await stack.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': bad } }).catch(() => null);
      if (res === null) continue; // un en-tête que Node refuse d'emblée (retour à la ligne) n'atteint jamais l'API
      expect(res.headers['x-request-id'], JSON.stringify(bad)).toMatch(UUID);
    }
  });

  it('présent aussi sur une réponse d’erreur (404, 400) et sur une réponse authentifiée refusée (401)', async () => {
    for (const url of ['/route-inconnue', '/matches/pas-un-uuid', '/me/notifications']) {
      const res = await stack.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(res.headers['x-request-id'], url).toMatch(UUID);
    }
  });

  it('lisible par les navigateurs (CORS : exposé) — pour qu’un écran d’erreur puisse un jour l’afficher au support', async () => {
    const origin = 'http://localhost:5175';
    const res = await stack.app.inject({ method: 'GET', url: '/health', headers: { origin } });
    expect(String(res.headers['access-control-expose-headers']).toLowerCase()).toContain('x-request-id');
    const pre = await stack.app.inject({
      method: 'OPTIONS', url: '/health', headers: { origin, 'access-control-request-method': 'GET' },
    });
    expect(pre.statusCode).toBeLessThan(300);
    expect(pre.headers['x-request-id']).toMatch(UUID);
  });

  it('chaque ligne de journal porte le nom de l’instance (journaux agrégés de plusieurs instances)', async () => {
    const env = readEnv({ databaseUrl: 'postgres://unused', instanceName: 'api-test-7', ...LOOSE_LIMITS });
    const app = await buildServer({ db: stack.db, env, logger: true });
    try {
      app.log.level = 'silent';
      const bindings = (app.log as unknown as { bindings: () => Record<string, unknown> }).bindings();
      expect(bindings.instance).toBe('api-test-7');
    } finally {
      await app.close();
    }
  });
});

describe('délai de réception d’une requête (REQUEST_TIMEOUT_MS)', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(async () => { await stack.teardown(); });

  /** Ouvre une connexion brute, envoie `head`, et rend le temps écoulé avant que le serveur la ferme (ou `null`). */
  function timeToClose(port: number, head: string, maxMs: number): Promise<{ ms: number | null; received: string }> {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let received = '';
      const socket = net.connect(port, '127.0.0.1', () => { socket.write(head); });
      socket.on('data', (d) => { received += d.toString('utf8'); });
      const done = (ms: number | null) => { socket.destroy(); resolve({ ms, received }); };
      socket.on('close', () => { done(Date.now() - t0); });
      socket.on('error', () => { done(Date.now() - t0); });
      setTimeout(() => { done(null); }, maxMs);
    });
  }

  it('un client qui n’envoie jamais la fin de sa requête est coupé après le délai ; un client normal n’est pas gêné', async () => {
    const env = readEnv({ databaseUrl: 'postgres://unused', requestTimeoutMs: 1_000, ...LOOSE_LIMITS });
    const app = await buildServer({ db: stack.db, env, logger: false });
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const port = (app.server.address() as net.AddressInfo).port;
      expect(app.server.requestTimeout).toBe(1_000);

      // Requête normale : servie.
      const ok = await timeToClose(port, 'GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 5_000);
      expect(ok.received).toContain('200 OK');

      // En-têtes JAMAIS terminés (pas de ligne vide finale) : coupé par le délai, pas avant 1 s, pas après ~4 s
      // (contrôle des délais toutes les secondes : connectionsCheckingInterval = min(5 s, délai)).
      const slow = await timeToClose(port, 'GET /health HTTP/1.1\r\nHost: x\r\n', 8_000);
      expect(slow.ms, 'la connexion a dû être fermée par le serveur').not.toBeNull();
      expect(slow.ms!).toBeGreaterThanOrEqual(900);
      expect(slow.ms!).toBeLessThan(5_000);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('REQUEST_TIMEOUT_MS=0 : aucun délai (comportement historique de Fastify)', async () => {
    const env = readEnv({ databaseUrl: 'postgres://unused', requestTimeoutMs: 0, ...LOOSE_LIMITS });
    const app = await buildServer({ db: stack.db, env, logger: false });
    try {
      expect(app.server.requestTimeout).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('migrations : un seul migrateur à la fois', () => {
  const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';
  const dbNames: string[] = [];
  let admin: pg.Pool;
  const pools: pg.Pool[] = [];

  beforeAll(() => { admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 }); });
  afterAll(async () => {
    for (const p of pools) await p.end();
    for (const name of dbNames) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  async function freshDb(): Promise<string> {
    const name = `moubarat_test_${randomBytes(4).toString('hex')}`;
    await admin.query(`CREATE DATABASE ${name}`);
    dbNames.push(name);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    return url.toString();
  }
  function poolFor(url: string): pg.Pool {
    const p = new pg.Pool({ connectionString: url, max: 3 });
    pools.push(p);
    return p;
  }

  it('trois migrateurs lancés EN MÊME TEMPS sur une base vide : aucune erreur, chaque migration appliquée UNE seule fois, au total', async () => {
    const url = await freshDb();
    const results = await Promise.all([migrate(poolFor(url)), migrate(poolFor(url)), migrate(poolFor(url))]);
    const names = listMigrationNames();
    expect(results.flat().sort()).toEqual([...names].sort()); // l'union = tout, sans doublon
    expect(results.filter((r) => r.length === 0).length).toBe(2); // un seul a travaillé, les deux autres ont trouvé le schéma à jour
    const rows = await poolFor(url).query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
    expect(Number(rows.rows[0]!.n)).toBe(names.length);
  }, 60_000);

  it('un migrateur qui trouve le verrou pris ATTEND (et le dit), puis travaille dès sa libération', async () => {
    const url = await freshDb();
    const holder = await poolFor(url).connect();
    await holder.query(`SELECT pg_advisory_lock(hashtext('moubarat:migrate'))`);
    const messages: string[] = [];
    let settled = false;
    const run = migrate(poolFor(url), (m) => { messages.push(m); }).then((r) => { settled = true; return r; });
    await new Promise<void>((r) => { setTimeout(r, 500); });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/attente/);
    expect(settled, 'ne doit pas avancer tant que le verrou est tenu').toBe(false);
    await holder.query(`SELECT pg_advisory_unlock(hashtext('moubarat:migrate'))`);
    holder.release();
    const applied = await run;
    expect(applied).toEqual(listMigrationNames());
  }, 60_000);

  it('une migration qui échoue n’est PAS enregistrée (même transaction) et le verrou est libéré ; corrigée, elle passe au coup suivant', async () => {
    const url = await freshDb();
    const pool = poolFor(url);
    await migrate(pool);
    // Une migration précise (un index simple : rejouée sans son enregistrement, elle échoue sur « existe déjà ») — jamais « la dernière
    // en date », qui change à chaque nouvelle migration.
    const last = '0028_users_created_index';
    expect(listMigrationNames()).toContain(last);
    // Rejouer une migration dont l'effet existe déjà : elle échoue (« existe déjà »), comme un script à moitié appliqué à la main.
    await pool.query('DELETE FROM schema_migrations WHERE name = $1', [last]);
    await expect(migrate(pool)).rejects.toThrow();
    const recorded = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [last]);
    expect(recorded.rowCount).toBe(0);
    // Le verrou consultatif n'est plus tenu par personne (aucune connexion ne doit en garder un).
    const locks = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    expect(locks.rows[0].n).toBe(0);
    // Un AUTRE migrateur (autre pool) ne reste pas bloqué : on supprime l'effet déjà présent, il applique la migration.
    await pool.query('DROP INDEX IF EXISTS users_created');
    const other = poolFor(url);
    expect(await migrate(other)).toEqual([last]);
  }, 60_000);
});
