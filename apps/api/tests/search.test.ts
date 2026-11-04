import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';
import { accentInsensitiveRegex } from '../src/lib/search.js';

/* Mise à l'échelle, lot L3 (25/09/2026) — recherche insensible à la casse et aux accents par MOTIF (lib/search.ts) :
   la colonne n'est jamais transformée (translate() par ligne coûtait 600 ms sur 100 000 joueurs). Le motif doit se
   comporter comme l'ancien repli côté app (`fold`) ET ne jamais laisser du texte tapé devenir une expression régulière. */

let stack: TestStack;
beforeAll(async () => { stack = await setupTestStack(); });
afterAll(() => stack.teardown());

/** Vrai si `column ~* motif(query)` — exactement ce que fait le SQL des routes. */
async function matches(column: string, query: string): Promise<boolean> {
  const res = await stack.pool.query<{ ok: boolean }>('SELECT $1::text ~* $2::text AS ok', [column, accentInsensitiveRegex(query)]);
  return res.rows[0]!.ok;
}

describe('accentInsensitiveRegex — même résultat que le repli accents/casse de l’app', () => {
  it.each([
    ['Foot de l’Élite', 'elite', true],
    ['Foot de l’Élite', 'ÉLITE', true],
    ['Foot de l’Élite', 'élite', true],
    ['foot de l’elite', 'ÉLITE', true],
    ['Aït Ahmed', 'ait', true],
    ['Aït Ahmed', 'AÏT AHM', true],
    ['Ça roule', 'ca r', true],
    ['ÖZDEMIR', 'ozd', true],
    ['Sœur Zoé', 'zoe', true],
    ['Padel Délices', 'delices', true],
    ['Padel Délices', 'DÉLICES', true],
    ['Match du soir', 'du soi', true],
    ['Match du soir', 'lundi', false],
    ['Élite', 'elit ', false], // l'espace final fait partie de la recherche
  ])('%j cherché avec %j → %s', async (column, query, expected) => {
    expect(await matches(column, query)).toBe(expected);
  });

  it('la recherche trouve le texte n’importe où dans la colonne, pas seulement au début', async () => {
    expect(await matches('Grand Match Élite du soir', 'elite')).toBe(true);
  });
});

describe('accentInsensitiveRegex — du texte, jamais une expression régulière', () => {
  it.each([
    ['axb', 'a.b', false], // « . » n'est pas un joker
    ['a.b', 'a.b', true],
    ['anything', '.*', false],
    ['a.*b', '.*', true], // … mais le texte « .* » lui-même se trouve
    ['abc', 'a|z', false], // « | » n'est pas une alternative
    ['a|z', 'a|z', true],
    ['x(y', '(', true],
    ['xy', '(', false],
    ['x[y', '[', true],
    ['x]y', ']', true],
    ['x{2}', '{2}', true],
    ['xx', 'x{2}', false],
    ['a^b', '^', true],
    ['ab', '^', false],
    ['a$b', '$', true],
    ['back\\slash', '\\', true],
    ['100%', '100%', true],
    ['1000', '100%', false], // « % » n'est pas un joker
    ['a_b', 'a_b', true],
    ['axb', 'a_b', false], // « _ » n'est pas un joker
    ['Match', '?', false],
    ['Match?', '?', true],
    ['a+b', 'a+b', true],
    ['aab', 'a+b', false],
  ])('%j cherché avec %j → %s', async (column, query, expected) => {
    expect(await matches(column, query)).toBe(expected);
  });

  it('un motif de 80 caractères de lettres accentuées se compile et s’évalue (aucun coût exponentiel)', async () => {
    const q = 'éèêëàâäîïôöùûüç'.repeat(5); // 75 caractères
    expect(await matches(q, q)).toBe(true);
    expect(await matches('x'.repeat(5000), q)).toBe(false);
  });
});

describe('forme du motif', () => {
  it('une lettre devient une classe de ses variantes ; le reste est laissé tel quel ou échappé', () => {
    expect(accentInsensitiveRegex('a')).toMatch(/^\[a[^\]]*à[^\]]*]$/);
    expect(accentInsensitiveRegex('1')).toBe('1');
    expect(accentInsensitiveRegex('.')).toBe('\\.');
    expect(accentInsensitiveRegex('')).toBe('');
  });
});
