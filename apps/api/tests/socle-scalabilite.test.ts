import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, loginAsPlatform, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { createPool, createDb, primeEnumArrayParsers } from '../src/db/client.js';
import { LAST_SEEN_COALESCE_MS } from '../src/auth/guards.js';

/* Audit multi-centre 22/09/2026 (socle indispensable au 2e centre, cadrage §2) — F5 (écriture last_seen_at
   coalescée), F6 (pool configurable, délais), index notifications/matches manquants, /me/matches borné. */

describe('F5 — écriture last_seen_at coalescée (session joueur ET plateforme)', () => {
  let stack: TestStack;
  let seed: SeedResult;
  beforeAll(async () => { stack = await setupTestStack(); seed = await seedDemo(stack.db); });
  afterAll(() => stack.teardown());

  it('joueur : une requête juste après la connexion NE réécrit PAS last_seen_at (dans la fenêtre de coalescence)', async () => {
    const token = await loginAs(stack, seed.phones.sofiane);
    const before = (await stack.db.selectFrom('sessions').innerJoin('users', 'users.id', 'sessions.user_id')
      .select('sessions.last_seen_at').where('users.phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).last_seen_at;

    await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    const after = (await stack.db.selectFrom('sessions').innerJoin('users', 'users.id', 'sessions.user_id')
      .select('sessions.last_seen_at').where('users.phone', '=', seed.phones.sofiane).executeTakeFirstOrThrow()).last_seen_at;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('joueur : une requête APRÈS la fenêtre de coalescence réécrit last_seen_at', async () => {
    const token = await loginAs(stack, seed.phones.karim);
    await stack.db.updateTable('sessions').set({ last_seen_at: new Date(Date.now() - LAST_SEEN_COALESCE_MS - 1000) })
      .where('user_id', '=', seed.users.karim).execute();

    await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    const after = (await stack.db.selectFrom('sessions').select('last_seen_at')
      .where('user_id', '=', seed.users.karim).executeTakeFirstOrThrow()).last_seen_at;
    expect(Date.now() - after.getTime()).toBeLessThan(5000);
  });

  it('plateforme (CRM) : même coalescence sur platform_sessions', async () => {
    const token = await loginAsPlatform(stack, seed.crmStaffEmails.hamid, seed.crmStaffPassword);
    const before = (await stack.db.selectFrom('platform_sessions').innerJoin('platform_accounts', 'platform_accounts.id', 'platform_sessions.account_id')
      .select('platform_sessions.last_seen_at').where('platform_accounts.email', '=', seed.crmStaffEmails.hamid).executeTakeFirstOrThrow()).last_seen_at;

    await stack.app.inject({ method: 'GET', url: '/platform/auth/me', headers: bearer(token) });
    const after = (await stack.db.selectFrom('platform_sessions').innerJoin('platform_accounts', 'platform_accounts.id', 'platform_sessions.account_id')
      .select('platform_sessions.last_seen_at').where('platform_accounts.email', '=', seed.crmStaffEmails.hamid).executeTakeFirstOrThrow()).last_seen_at;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('la session reste VALIDE tout du long, coalescée ou non (le TTL glissant n’est jamais compromis)', async () => {
    const token = await loginAs(stack, seed.phones.walid);
    const r1 = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    const r2 = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
  });
});

describe('F6 — pool configurable (connectionTimeoutMs, statementTimeoutMs)', () => {
  const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';

  it('statementTimeoutMs configuré : une requête plus longue que le délai est annulée par Postgres (57014), jamais un blocage sans fin', async () => {
    const pool = createPool(ADMIN_URL, { statementTimeoutMs: 200 });
    await primeEnumArrayParsers(pool);
    const db = createDb(pool);
    try {
      await expect(sql`SELECT pg_sleep(1)`.execute(db)).rejects.toMatchObject({ code: '57014' });
    } finally {
      await db.destroy();
    }
  });

  it('sans statementTimeoutMs (comportement historique, celui des tests/scripts) : la même requête aboutit normalement', async () => {
    const pool = createPool(ADMIN_URL);
    await primeEnumArrayParsers(pool);
    const db = createDb(pool);
    try {
      await expect(sql`SELECT pg_sleep(0.3)`.execute(db)).resolves.toBeDefined();
    } finally {
      await db.destroy();
    }
  });

  it('connectionTimeoutMs configuré : un pool à max=1 saturé refuse une deuxième connexion au-delà du délai, plutôt que d’attendre indéfiniment', async () => {
    const pool = createPool(ADMIN_URL, { max: 1, connectionTimeoutMs: 200 });
    await primeEnumArrayParsers(pool);
    const db = createDb(pool);
    try {
      await db.transaction().execute(async (trx) => {
        await sql`SELECT 1`.execute(trx); // occupe l'unique connexion du pool, transaction ouverte
        const started = Date.now();
        await expect(sql`SELECT 1`.execute(db)).rejects.toThrow(); // hors de la transaction : doit attendre puis échouer
        expect(Date.now() - started).toBeLessThan(2000); // échoue vite (≈200 ms), jamais un blocage long
      });
    } finally {
      await db.destroy();
    }
  });
});

describe('index et limites ajoutés (migration 0022, cadrage F3/S3/S6)', () => {
  let stack: TestStack;
  beforeAll(async () => { stack = await setupTestStack(); });
  afterAll(() => stack.teardown());

  it('les trois nouveaux index existent réellement en base', async () => {
    const rows = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('notifications_user_created', 'notifications_user_type_ref', 'matches_organizer')
    `.execute(stack.db);
    expect(rows.rows.map((r) => r.indexname).sort()).toEqual(
      ['matches_organizer', 'notifications_user_created', 'notifications_user_type_ref'],
    );
  });
});

describe('/me/matches — borné (audit F3, plus jamais unbounded)', () => {
  let stack: TestStack;
  let seed: SeedResult;
  let sofiane = '';
  afterEach(async () => { await stack?.teardown(); });

  it('LIMIT appliqué : au plus 100 lignes, jamais la table entière', async () => {
    stack = await setupTestStack();
    seed = await seedDemo(stack.db);
    sofiane = await loginAs(stack, seed.phones.sofiane);

    // 120 matchs dont sofiane est organisateur — bien au-delà de la limite.
    const field = await stack.db.selectFrom('fields').select('id').where('id', '=', seed.fields.t1).executeTakeFirstOrThrow();
    const base = Date.now() + 10 * 86_400_000;
    await stack.db.insertInto('matches').values(Array.from({ length: 120 }, (_, i) => ({
      sport: 'FOOTBALL' as const, format: '5v5' as const, level: 'LOISIR' as const, title: `Match ${i}`,
      venue_id: seed.venueId, field_id: field.id,
      time_range: `[${new Date(base + i * 3_600_000).toISOString()},${new Date(base + i * 3_600_000 + 5_400_000).toISOString()})`,
      capacity: 10, price_per_player_da: 500, organizer_id: seed.users.sofiane,
    }))).execute();

    const res = await stack.app.inject({ method: 'GET', url: '/me/matches', headers: bearer(sofiane) });
    expect(res.statusCode).toBe(200);
    const matches = (res.json() as { matches: unknown[] }).matches;
    expect(matches.length).toBeLessThanOrEqual(100);
    expect(matches.length).toBeGreaterThan(0);
  });
});
