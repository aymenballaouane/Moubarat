import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { migrate } from '../src/db/migrate.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Lot « Match libre » : les migrations 0047 (match libre) et 0048 (9v9) sont RÉVERSIBLES (décision d'Aymen : « rien de destructif »).
   Leurs scripts de retour arrière (migrations/retour/, jamais lus par le migrateur) sont joués ici sur une base jetable : ils refusent
   tant qu'une ligne utilise la nouveauté, défont la migration sinon, et le migrateur la réapplique ensuite à l'identique.
   SQL brut seulement : le type énuméré est recréé, les lecteurs de tableaux d'enum du serveur ne sont plus valables après. */

const RETOUR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'retour');
const retour = (name: string) => readFileSync(join(RETOUR, name), 'utf8');

let stack: TestStack;
let seed: SeedResult;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await stack.pool.query(text, params)).rows as T[];
/** Joue un script de retour sur UNE connexion : refusé, il annule sa transaction sur cette même connexion avant de la rendre. */
async function runRetour(name: string): Promise<void> {
  const c = await stack.pool.connect();
  try { await c.query(retour(name)); }
  catch (err) { await c.query('ROLLBACK').catch(() => {}); throw err; }
  finally { c.release(); }
}
const migrationsApplied = async () => (await q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name);

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
});
afterAll(() => stack.teardown());

describe('retour arrière de 0048 (9v9)', () => {
  it('refuse tant qu’un terrain propose le 9v9 ; défait la migration sinon ; le migrateur la réapplique', async () => {
    await q(`UPDATE fields SET formats = array_append(formats, '9v9'::match_format) WHERE id = $1`, [seed.fields.t1]);
    await expect(runRetour('0048_format_9v9.sql')).rejects.toThrow(/0048 refusé/);
    expect(await migrationsApplied()).toContain('0048_format_9v9');

    await q(`UPDATE fields SET formats = array_remove(formats, '9v9'::match_format) WHERE id = $1`, [seed.fields.t1]);
    await runRetour('0048_format_9v9.sql');
    const values = (await q<{ v: string }>(`SELECT unnest(enum_range(NULL::match_format))::text AS v`)).map((r) => r.v);
    expect(values).not.toContain('9v9');
    expect(await migrationsApplied()).not.toContain('0048_format_9v9');
    // Les données d'avant sont intactes (formats des terrains, tarifs).
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM fields WHERE array_length(formats, 1) > 0`))[0]!.n).toBeGreaterThan(0);

    expect(await migrate(stack.pool)).toEqual(['0048_format_9v9']);
    const again = (await q<{ v: string }>(`SELECT unnest(enum_range(NULL::match_format))::text AS v`)).map((r) => r.v);
    expect(again).toEqual(['5v5', '6v6', '7v7', '8v8', '9v9', '11v11', 'DOUBLE', 'SIMPLE', '3v3']);
  });
});

describe('retour arrière de 0047 (match libre)', () => {
  it('refuse tant qu’un match libre existe ; défait la migration sinon ; le migrateur la réapplique', async () => {
    const start = Date.now() + 30 * 86_400_000;
    await q(
      `INSERT INTO matches (sport, format, level, title, venue_id, field_id, place_name, place_wilaya, time_range, capacity, price_per_player_da, organizer_id)
       VALUES ('FOOTBALL', '5v5', 'LOISIR', 'Libre', NULL, NULL, 'Stade du quartier', 'Alger', $1::tstzrange, 10, 0, $2)`,
      [toPgRange({ start, end: start + 5_400_000 }), seed.users.sofiane],
    );
    await expect(runRetour('0047_match_libre.sql')).rejects.toThrow(/0047 refusé/);

    await q('DELETE FROM matches WHERE venue_id IS NULL');
    await runRetour('0047_match_libre.sql');
    const cols = (await q<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'matches'`)).map((r) => r.c);
    expect(cols).not.toContain('place_name');
    const notNull = await q<{ c: string; n: string }>(`SELECT column_name AS c, is_nullable AS n FROM information_schema.columns WHERE table_name = 'matches' AND column_name IN ('venue_id', 'field_id')`);
    expect(notNull.every((r) => r.n === 'NO')).toBe(true);

    expect(await migrate(stack.pool)).toEqual(['0047_match_libre']);
    const back = (await q<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'matches'`)).map((r) => r.c);
    expect(back).toEqual(expect.arrayContaining(['place_name', 'place_area', 'place_wilaya']));
  });
});
