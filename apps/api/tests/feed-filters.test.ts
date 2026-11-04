import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, insertTestField, type TestStack } from './helpers.js';
import { toPgRange } from '../src/lib/pgrange.js';

/* Lot 5 (25/10/2026) — page « Filtres » d'Explorer : niveau, format, ville (wilaya du centre) et « avec de la place »
   deviennent des paramètres du fil des matchs côté serveur (même principe que le sport, le jour, « ce soir »). */

const DAY = 86_400_000;

describe('fil des matchs — filtres niveau, format, ville, place', () => {
  let stack: TestStack;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    stack = await setupTestStack();
    const venue = async (name: string, wilaya: string) => (await stack.db.insertInto('venues').values({
      name, wilaya, address: 'x', lat: 0, lng: 0, status: 'ACTIVE',
    }).returning('id').executeTakeFirstOrThrow()).id;
    const alger = await venue('Centre Alger', 'Alger');
    const setif = await venue('Centre Sétif', 'Sétif');
    const tizi = await venue('Centre Tizi', 'Tizi Ouzou');
    const field = async (v: string) => (await insertTestField(stack.db, {
      venue_id: v, name: 'T1', sport: 'FOOTBALL', formats: ['5v5', '7v7'], hourly_rate_da: 3000, status: 'ACTIVE',
    })).id;
    const fAlger = await field(alger); const fSetif = await field(setif); const fTizi = await field(tizi);
    const organizer = (await stack.db.insertInto('users').values({ phone: '+213661900077', name: 'Orga Filtres' }).returning('id').executeTakeFirstOrThrow()).id;
    let n = 0;
    const add = async (key: string, o: { venue: string; field: string; level: 'LOISIR' | 'INTERMEDIAIRE' | 'COMPETITION'; format: '5v5' | '7v7'; status?: 'OPEN' | 'FULL' }) => {
      const start = Date.now() + (3 + n++) * DAY;
      ids[key] = (await stack.db.insertInto('matches').values({
        sport: 'FOOTBALL', format: o.format, level: o.level, title: key, venue_id: o.venue, field_id: o.field,
        time_range: toPgRange({ start, end: start + 90 * 60_000 }), capacity: 10, price_per_player_da: 500,
        visibility: 'OPEN', status: o.status ?? 'OPEN', organizer_id: organizer,
      }).returning('id').executeTakeFirstOrThrow()).id;
    };
    await add('algerLoisir5', { venue: alger, field: fAlger, level: 'LOISIR', format: '5v5' });
    await add('algerInter7', { venue: alger, field: fAlger, level: 'INTERMEDIAIRE', format: '7v7' });
    await add('algerCompetFull', { venue: alger, field: fAlger, level: 'COMPETITION', format: '5v5', status: 'FULL' });
    await add('setifLoisir5', { venue: setif, field: fSetif, level: 'LOISIR', format: '5v5' });
    await add('tiziInter5', { venue: tizi, field: fTizi, level: 'INTERMEDIAIRE', format: '5v5' });
  });
  afterAll(() => stack.teardown());

  type Feed = { matches: { id: string }[] };
  async function keys(qs: string): Promise<string[]> {
    const res = await stack.app.inject({ method: 'GET', url: `/matches${qs}` });
    expect(res.statusCode, qs).toBe(200);
    const body = res.json() as Feed;
    return body.matches.map((m) => Object.entries(ids).find(([, v]) => v === m.id)![0]).sort();
  }

  it('niveau : un ou plusieurs (« l\'un ou l\'autre »)', async () => {
    expect(await keys('?level=LOISIR')).toEqual(['algerLoisir5', 'setifLoisir5']);
    expect(await keys('?level=LOISIR,COMPETITION')).toEqual(['algerCompetFull', 'algerLoisir5', 'setifLoisir5']);
  });

  it('format : un ou plusieurs', async () => {
    expect(await keys('?format=7v7')).toEqual(['algerInter7']);
    expect(await keys('?format=7v7,5v5')).toHaveLength(5);
  });

  it('ville : wilaya du centre, sans accents ni casse ; AUTRE = hors des six villes', async () => {
    expect(await keys('?city=ALGER')).toEqual(['algerCompetFull', 'algerInter7', 'algerLoisir5']);
    expect(await keys('?city=SETIF')).toEqual(['setifLoisir5']); // « Sétif » en base, SETIF demandé
    expect(await keys('?city=ORAN')).toEqual([]);
    expect(await keys('?city=AUTRE')).toEqual(['tiziInter5']);
  });

  it('place : seulement les matchs OUVERTS — un match complet reste dans le fil sans ce filtre', async () => {
    expect(await keys('')).toContain('algerCompetFull');
    expect(await keys('?spots=1')).not.toContain('algerCompetFull');
    expect(await keys('?spots=1')).toHaveLength(4);
  });

  it('les filtres se cumulent', async () => {
    expect(await keys('?city=ALGER&level=INTERMEDIAIRE,COMPETITION&spots=1')).toEqual(['algerInter7']);
    expect(await keys('?city=ALGER&format=7v7&level=LOISIR')).toEqual([]);
  });

  it('valeurs inconnues refusées (400), jamais ignorées en silence', async () => {
    for (const qs of ['?level=EXPERT', '?city=PARIS', '?format=5v5;drop', `?format=${Array.from({ length: 9 }, (_, i) => `f${i}`).join(',')}`]) {
      const res = await stack.app.inject({ method: 'GET', url: `/matches${qs}` });
      expect(res.statusCode, qs).toBe(400);
    }
  });
});
