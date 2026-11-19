import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { assertCleanText, blockedWordIn, BLOCKED_ARABIC, BLOCKED_LATIN } from '../src/lib/content-filter.js';

/* Lot B, phase 4 — le filtre des insultes (lib/content-filter.ts), éteint par défaut (CONTENT_FILTER_ENABLED). */

describe('blockedWordIn', () => {
  it('trouve les mots de la liste, quelle que soit l’écriture', () => {
    for (const t of ['connard', 'Sale CONNARD !', 'put3', 'p u t e', 'puuuute', 'nique ta mère', 'Ta gueule', 's4lope', 'zebi', 'nik mok', '9a7ba']) {
      expect(blockedWordIn(t), t).not.toBeNull();
    }
    for (const t of ['قحبة', 'زبّي', 'يا قحبة', 'شرموطة', 'كس امك']) expect(blockedWordIn(t), t).not.toBeNull();
  });

  it('ne refuse jamais un morceau de mot ni un nom de lieu ordinaire', () => {
    for (const t of ['Concorde', 'Hammam Righa', 'couscous', 'Nike FC', 'Zebda', 'Kouba', 'Députés', 'Computer club', '5v5 du soir', 'Bab Ezzouar',
      'Atay du vendredi', 'Bordj El Kiffan', 'Terrain · Cheraga', 'كسكس', 'نيكولا', 'ملعب الزبيرية', 'حي الزبير']) {
      expect(blockedWordIn(t), t).toBeNull();
    }
    expect(blockedWordIn('')).toBeNull();
  });

  it('chaque entrée de la liste est bien reconnue elle-même', () => {
    for (const w of BLOCKED_LATIN) expect(blockedWordIn(w), w).not.toBeNull();
    for (const w of BLOCKED_ARABIC) expect(blockedWordIn(w), w).not.toBeNull();
  });

  it('assertCleanText : rien n’est refusé tant que le filtre est éteint ; allumé, 400 CONTENT_REFUSED', () => {
    expect(() => assertCleanText(false, 'connard')).not.toThrow();
    expect(() => assertCleanText(true, null, undefined, '', 'Concorde')).not.toThrow();
    expect(() => assertCleanText(true, 'ok', 'connard')).toThrow(expect.objectContaining({ statusCode: 400, code: 'CONTENT_REFUSED' }));
  });
});

const F = { 'x-moubarat-features': 'match-libre,format-9v9' };
const start = () => Math.ceil((Date.now() + 500 * 3_600_000) / 1_800_000) * 1_800_000;

describe('routes, filtre allumé', () => {
  let stack: TestStack; let seed: SeedResult; let karim = '';
  beforeAll(async () => {
    stack = await setupTestStack({ envOverrides: { contentFilterEnabled: true } });
    seed = await seedDemo(stack.db);
    karim = await loginAs(stack, seed.phones.karim);
  });
  afterAll(async () => { await stack.teardown(); });

  const refused = (res: { statusCode: number; json: () => unknown }) => {
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('CONTENT_REFUSED');
  };

  it('pseudo et prénom', async () => {
    refused(await stack.app.inject({ method: 'PATCH', url: '/me', headers: bearer(karim), payload: { name: 'connard_92' } }));
    refused(await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(karim), payload: { firstName: 'Salope' } }));
    const ok = await stack.app.inject({ method: 'PATCH', url: '/me/profile', headers: bearer(karim), payload: { firstName: 'Karim' } });
    expect(ok.statusCode, ok.body).toBeLessThan(300);
  });

  it('match libre : lieu, adresse, nom et mot ; un nom de lieu ordinaire passe', async () => {
    const base = { format: '5v5', level: 'LOISIR', durationMin: 90 };
    refused(await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(karim), ...F }, payload: { ...base, start: start(), place: { name: 'Terrain zebi', wilaya: 'Alger' } } }));
    refused(await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(karim), ...F }, payload: { ...base, start: start(), place: { name: 'Terrain Kouba', wilaya: 'Alger' }, note: 'nique ta mère' } }));
    const ok = await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(karim), ...F }, payload: { ...base, start: start(), place: { name: 'Stade Concorde', wilaya: 'Alger' }, note: 'Venez à l’heure' } });
    expect(ok.statusCode, ok.body).toBe(201);
    const id = (ok.json() as { match: { id: string } }).match.id;
    refused(await stack.app.inject({ method: 'PUT', url: `/matches/${id}/note`, headers: { ...bearer(karim), ...F }, payload: { note: 'يا قحبة' } }));
    const note = await stack.app.inject({ method: 'PUT', url: `/matches/${id}/note`, headers: { ...bearer(karim), ...F }, payload: { note: 'Ramenez de l’eau' } });
    expect(note.statusCode, note.body).toBeLessThan(300);
  });
});
