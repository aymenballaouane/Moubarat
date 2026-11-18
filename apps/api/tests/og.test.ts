import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { missingText, ogText } from '../src/modules/og/content.js';

/* Lot B, phase 2 — l'aperçu d'un lien de match (titre, description, image 1200 × 630). */

const FEATURES = { 'x-moubarat-features': 'match-libre,format-9v9' };
let stack: TestStack;
let seed: SeedResult;
let code = '';

// Vendredi 20 novembre 2026, 19:30 à Alger (UTC+1).
const FRIDAY = Date.UTC(2026, 10, 20, 18, 30);
const base = { format: '5v5', start: FRIDAY, capacity: 10, joined: 1, placeName: 'Terrain · Ben Aknoun', wilaya: 'Alger' };

beforeAll(async () => {
  stack = await setupTestStack();
  seed = await seedDemo(stack.db);
  const token = await loginAs(stack, seed.phones.karim);
  const start = Math.ceil((Date.now() + 300 * 3_600_000) / 1_800_000) * 1_800_000;
  const res = await stack.app.inject({ method: 'POST', url: '/matches/free', headers: { ...bearer(token), ...FEATURES }, payload: {
    place: { name: 'Terrain · Ben Aknoun', wilaya: 'Alger' }, format: '5v5', level: 'LOISIR', start, durationMin: 90,
  } });
  code = (res.json() as { match: { code: string } }).match.code;
});
afterAll(async () => { await stack.teardown(); });

describe('les mots de l’aperçu', () => {
  it('français : « Match 5v5 · ven. 20 nov. à 19:30 » et « {lieu} · il manque 9 joueurs »', () => {
    expect(ogText(base, 'fr')).toEqual({
      title: 'Match 5v5 · ven. 20 nov. à 19:30',
      description: 'Terrain · Ben Aknoun, Alger · il manque 9 joueurs',
      big: 'VEN. 20 · 19:30',
      chip: '5V5 · IL MANQUE 9 JOUEURS',
    });
  });
  it('arabe : phrases du pack, pluriels accordés', () => {
    const t = ogText(base, 'ar');
    expect(t.title).toBe('مباراة 5v5 · الجمعة 20 نوفمبر على 19:30');
    expect(t.description).toBe('Terrain · Ben Aknoun, Alger · ينقص 9 لاعبين');
    expect([1, 2, 3, 11].map((n) => missingText(n, 'ar'))).toEqual(['ينقص لاعب واحد', 'ينقص لاعبان', 'ينقص 3 لاعبين', 'ينقص 11 لاعبًا']);
    expect(missingText(1, 'fr')).toBe('il manque 1 joueur');
  });
});

describe('GET /og/m/:code', () => {
  it('un match vivant : titre et description ; un code inconnu : « Moubarat Sport »', async () => {
    const ok = (await stack.app.inject({ method: 'GET', url: `/og/m/${code}` })).json() as { found: boolean; title: string; description: string };
    expect(ok.found).toBe(true);
    expect(ok.title).toMatch(/^Match 5v5 · /);
    expect(ok.description).toBe('Terrain · Ben Aknoun, Alger · il manque 9 joueurs');
    const none = (await stack.app.inject({ method: 'GET', url: '/og/m/ZZZZZZ?l=ar' })).json();
    expect(none).toEqual({ found: false, title: 'Moubarat Sport', description: 'نظّم مباراتك، واعثر على لاعبين.' });
  });
  it('l’image : un PNG de 1200 × 630', async () => {
    for (const l of ['fr', 'ar']) {
      const res = await stack.app.inject({ method: 'GET', url: `/og/m/${code}/image.png?l=${l}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      const png = res.rawPayload;
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
      if (process.env.OG_DUMP) writeFileSync(`${process.env.OG_DUMP}/og-${l}.png`, png);
    }
    const generic = await stack.app.inject({ method: 'GET', url: '/og/m/ZZZZZZ/image.png' });
    expect(generic.statusCode).toBe(200);
    if (process.env.OG_DUMP) writeFileSync(`${process.env.OG_DUMP}/og-generique.png`, generic.rawPayload);
  });
});
