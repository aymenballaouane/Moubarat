import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/http.js';
import { decodeCursor, encodeCursor, pageLimit, pageOf } from '../src/lib/cursor.js';
import { FOLD_FROM, FOLD_TO, foldText, accentInsensitiveRegex } from '../src/lib/search.js';

/* Mise à l'échelle L3 (25/09/2026) — le contrat de pagination par curseur (lib/cursor.ts) : opaque, vérifié, jamais
   interprété de travers. */

const UUID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const ISO = '2026-09-25T10:30:00.123456Z';

function code(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof ApiError ? e.code : `AUTRE:${String(e)}`; }
}

describe('curseur — aller-retour et opacité', () => {
  it('encode puis décode les valeurs à l’identique', () => {
    expect(decodeCursor(encodeCursor([ISO, UUID]), ['iso', 'uuid'])).toEqual([ISO, UUID]);
    expect(decodeCursor(encodeCursor([42, UUID]), ['int', 'uuid'])).toEqual([42, UUID]);
    expect(decodeCursor(encodeCursor(['abc', UUID]), ['text', 'uuid'])).toEqual(['abc', UUID]);
  });

  it('est du base64url : rien à échapper dans une adresse', () => {
    const c = encodeCursor([ISO, UUID]);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('absent ou vide : première page (null), jamais une erreur', () => {
    expect(decodeCursor(undefined, ['iso', 'uuid'])).toBeNull();
    expect(decodeCursor('', ['iso', 'uuid'])).toBeNull();
  });
});

describe('curseur — tout ce qui n’en est pas un est refusé (400 BAD_CURSOR)', () => {
  const shape = ['iso', 'uuid'] as const;
  const cases: [string, string][] = [
    ['du texte quelconque', 'pas-un-curseur!'],
    ['caractères hors de l’alphabet', 'abc def'],
    ['du base64url qui n’est pas du JSON', Buffer.from('ceci n’est pas du json').toString('base64url')],
    ['un JSON qui n’est pas un tableau', Buffer.from('{"a":1}').toString('base64url')],
    ['un tableau trop court', encodeCursor([ISO])],
    ['un tableau trop long', encodeCursor([ISO, UUID, 'extra'])],
    ['un horodatage sans microsecondes', encodeCursor(['2026-09-25T10:30:00Z', UUID])],
    ['un horodatage avec des millisecondes seulement', encodeCursor(['2026-09-25T10:30:00.123Z', UUID])],
    ['un horodatage d’injection SQL', encodeCursor(["2026-09-25' OR 1=1 --", UUID])],
    ['un identifiant qui n’est pas un UUID', encodeCursor([ISO, "x'; DROP TABLE users; --"])],
    ['un nombre à la place de l’horodatage', encodeCursor([12345, UUID])],
    ['un curseur d’une autre route (entier, uuid)', encodeCursor([7, UUID])],
    ['un curseur démesuré', 'A'.repeat(500)],
  ];
  it.each(cases)('%s', (_label, raw) => {
    expect(code(() => decodeCursor(raw, shape))).toBe('BAD_CURSOR');
  });

  it('un entier fractionnaire ou hors plage sûre est refusé pour une position entière', () => {
    expect(code(() => decodeCursor(encodeCursor([1.5, UUID]), ['int', 'uuid']))).toBe('BAD_CURSOR');
    expect(code(() => decodeCursor(encodeCursor([Number.MAX_SAFE_INTEGER + 2, UUID]), ['int', 'uuid']))).toBe('BAD_CURSOR');
    expect(code(() => decodeCursor(encodeCursor(['12', UUID]), ['int', 'uuid']))).toBe('BAD_CURSOR');
  });
});

describe('limit', () => {
  const opts = { def: 50, max: 100 };
  it('absent ou vide : la valeur historique de la route', () => {
    expect(pageLimit(undefined, opts)).toBe(50);
    expect(pageLimit('', opts)).toBe(50);
  });
  it('un entier de 1 au maximum ; au-delà, ramené au maximum', () => {
    expect(pageLimit('1', opts)).toBe(1);
    expect(pageLimit('30', opts)).toBe(30);
    expect(pageLimit('100', opts)).toBe(100);
    expect(pageLimit('5000', opts)).toBe(100);
  });
  it('tout le reste est une erreur du client (400)', () => {
    for (const bad of ['0', '-3', '2.5', 'abc', '10 ', ' ', '1e2', '0x10']) {
      const outcome = code(() => pageLimit(bad, opts));
      // « 10 » avec espace final est toléré (trim) : c'est la SEULE entrée d'espaces acceptée.
      if (bad === '10 ') expect(outcome).toBeNull(); else expect(outcome, JSON.stringify(bad)).toBe('BAD_REQUEST');
    }
  });
});

describe('pageOf', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  it('page pleine avec reste : garde `limit` lignes, le curseur part de la DERNIÈRE ligne gardée', () => {
    const page = pageOf(rows.slice(0, 3), 2, (r) => [r]);
    expect(page.items).toEqual(['a', 'b']);
    expect(decodeCursor(page.nextCursor!, ['text'])).toEqual(['b']);
  });
  it('exactement `limit` lignes lues : dernière page, pas de curseur', () => {
    expect(pageOf(rows.slice(0, 2), 2, (r) => [r])).toEqual({ items: ['a', 'b'], nextCursor: null });
  });
  it('moins de lignes que `limit`, ou aucune : dernière page', () => {
    expect(pageOf(rows.slice(0, 1), 2, (r) => [r]).nextCursor).toBeNull();
    expect(pageOf([], 2, (r) => [r]).nextCursor).toBeNull();
  });
});

describe('recherche sans accents (fil des matchs, clients)', () => {
  it('la table de correspondance est de même longueur des deux côtés (sinon translate() décale tout)', () => {
    expect([...FOLD_FROM]).toHaveLength([...FOLD_TO].length);
  });
  it('foldText : casse et accents retirés', () => {
    expect(foldText('Élite ÇA-Va Où?')).toBe('elite ca-va ou?');
  });
  it('chaque lettre accentuée de la table se replie sur la même lettre nue que foldText', () => {
    for (let i = 0; i < FOLD_FROM.length; i++) {
      const from = [...FOLD_FROM][i]!;
      expect(foldText(from), from).toBe([...FOLD_TO][i]!.toLowerCase());
    }
  });
});
