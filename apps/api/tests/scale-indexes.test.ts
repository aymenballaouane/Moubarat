import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import pg from 'pg';
import { setupTestStack, type TestStack } from './helpers.js';
import { createPool } from '../src/db/client.js';
import { readEnv } from '../src/env.js';

/* Mise à l'échelle, lot L1 (25/09/2026) — migration 0026 : sept index mesurés sur une base à l'échelle visée
   (voir l'en-tête de migrations/0026_scale_indexes.sql). Deux garanties ici : (1) ils existent, (2) chacun est
   UTILISABLE par la forme de requête pour laquelle il a été créé. Sur une base de test quasi vide le planificateur
   préfère toujours un balayage séquentiel — on le lui interdit (`enable_seqscan = off`, dans une transaction) et on
   vérifie que le plan retenu nomme bien l'index : un index sur la mauvaise colonne, ou une requête devenue
   incompatible, ferait réapparaître un balayage de table. */

let stack: TestStack;
beforeAll(async () => { stack = await setupTestStack(); });
afterAll(() => stack.teardown());

/** Plan retenu pour `query` avec les balayages séquentiels interdits. `without` : index retirés le temps de la
    transaction (la DDL de Postgres est transactionnelle — annulée en fin de fonction, la base de test reste intacte),
    pour vérifier qu'UN index précis est utilisable même quand un index voisin pourrait servir à sa place. */
async function planFor(query: ReturnType<typeof sql>, without: string[] = []): Promise<string> {
  const client = await stack.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    for (const idx of without) await client.query(`DROP INDEX ${idx}`);
    const compiled = query.compile(stack.db);
    const res = await client.query(`EXPLAIN ${compiled.sql}`, [...compiled.parameters]);
    return res.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const DAY = sql`tstzrange(date_trunc('day', now()), date_trunc('day', now()) + interval '1 day')`;

describe('migration 0026 — index de mise à l’échelle', () => {
  it('les sept index existent', async () => {
    const res = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('audit_log_at','bookings_field_time','bookings_time','bookings_promo','bookings_created','matches_created','matches_time')`
      .execute(stack.db);
    expect(res.rows.map((r) => r.indexname).sort()).toEqual([
      'audit_log_at', 'bookings_created', 'bookings_field_time', 'bookings_promo', 'bookings_time', 'matches_created', 'matches_time',
    ]);
  });

  it('planning / analytics d’un centre (bookings par terrain et période) : bookings_field_time, même sans son voisin bookings_time', async () => {
    const planning = sql`
      SELECT b.id FROM bookings b JOIN fields f ON f.id = b.field_id
      WHERE f.venue_id = gen_random_uuid() AND b.time_range && ${DAY} ORDER BY b.time_range ASC`;
    expect(await planFor(planning, ['bookings_time'])).toContain('bookings_field_time');
    // et bookings_time reste utilisable seul, sans son voisin (chacun sert sa propre forme de requête)
    expect(await planFor(planning, ['bookings_field_time'])).toContain('bookings_time');
  });

  it('comptes du jour du Dashboard (sans terrain) : bookings_time et matches_time', async () => {
    expect(await planFor(sql`SELECT count(*) FROM bookings b WHERE b.time_range && ${DAY} AND b.status != 'CANCELLED'`)).toContain('bookings_time');
    expect(await planFor(sql`SELECT count(*) FROM matches m WHERE m.time_range && ${DAY} AND m.status != 'CANCELLED'`)).toContain('matches_time');
  });

  it('journal plateforme et Dashboard (dernières lignes, tous centres) : audit_log_at', async () => {
    expect(await planFor(sql`SELECT * FROM audit_log ORDER BY at DESC LIMIT 100`)).toContain('audit_log_at');
  });

  it('réservations portant un code promo : bookings_promo', async () => {
    expect(await planFor(sql`SELECT * FROM bookings WHERE promo_code_id = gen_random_uuid()`)).toContain('bookings_promo');
  });

  it('listes de la console (dernières réservations / derniers matchs) : bookings_created et matches_created', async () => {
    expect(await planFor(sql`SELECT b.id FROM bookings b ORDER BY b.created_at DESC LIMIT 200`)).toContain('bookings_created');
    expect(await planFor(sql`SELECT m.id FROM matches m ORDER BY m.created_at DESC LIMIT 200`)).toContain('matches_created');
  });
});

describe('application_name des connexions (INSTANCE_NAME)', () => {
  it('createPool pose application_name sur les connexions ; sans option, Postgres n’en pose aucun', async () => {
    const url = new URL((stack.pool.options as pg.PoolConfig).connectionString!).toString();
    const named = createPool(url, { max: 1, applicationName: 'moubarat-api-2' });
    const bare = createPool(url, { max: 1 });
    try {
      expect((await named.query('SHOW application_name')).rows[0].application_name).toBe('moubarat-api-2');
      expect((await bare.query('SHOW application_name')).rows[0].application_name).toBe('');
    } finally { await named.end(); await bare.end(); }
  });

  it('INSTANCE_NAME : défaut moubarat-api ; valeur vide ou espaces = défaut ; sinon la valeur donnée', () => {
    const saved = process.env.INSTANCE_NAME;
    try {
      delete process.env.INSTANCE_NAME;
      expect(readEnv().instanceName).toBe('moubarat-api');
      process.env.INSTANCE_NAME = '   ';
      expect(readEnv().instanceName).toBe('moubarat-api');
      process.env.INSTANCE_NAME = 'moubarat-api-1';
      expect(readEnv().instanceName).toBe('moubarat-api-1');
    } finally {
      if (saved === undefined) delete process.env.INSTANCE_NAME; else process.env.INSTANCE_NAME = saved;
    }
  });
});
