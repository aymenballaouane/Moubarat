import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { seedDemo, type SeedResult } from '../src/seed/fixtures.js';
import { latinPart, suggestionsFromPhoton } from '../src/modules/places/photon.js';

/* Phase adresses (GO d'Aymen du 18/11/2026 : OpenStreetMap + Leaflet). La recherche passe par notre serveur, qui interroge Photon : ici
   un FAUX Photon local (jamais le vrai service depuis les tests), avec des réponses relevées sur le vrai le 18/11/2026. */

const BEN_AKNOUN = { features: [
  { geometry: { coordinates: [3.0084296, 36.7565214] }, properties: { name: 'Ben Aknoun', county: 'Daïra Bouzareah', state: 'Alger', countrycode: 'DZ', osm_type: 'R', osm_id: 544814, osm_key: 'place', osm_value: 'suburb' } },
  { geometry: { coordinates: [3.0147579, 36.7602825] }, properties: { name: 'BEN AKNOUN RP LS 4', street: 'Avenue Khalef Mustapha', district: 'Ben Aknoun', city: 'BEN AKNOUN', state: 'Alger', countrycode: 'DZ', osm_type: 'N', osm_id: 14030997306, osm_key: 'amenity', osm_value: 'atm' } },
  { geometry: { coordinates: [3.19, 36.72] }, properties: { name: 'Stade Mohamed Bentalha', street: 'Cité AADL La Réconciliation Nationale', district: 'Cité 324 lgts', city: 'Bab Ezzouar', state: 'Alger ⴷⵣⴰⵢⴻⵔ الجزائر', countrycode: 'DZ', osm_type: 'W', osm_id: 77, osm_key: 'leisure', osm_value: 'sports_centre' } },
  { geometry: { coordinates: [2.35, 48.85] }, properties: { name: 'Paris', state: 'Île-de-France', countrycode: 'FR', osm_type: 'R', osm_id: 1 } },
] };

let stack: TestStack;
let seed: SeedResult;
let karim = '';
let fake: http.Server;
let calls: string[] = [];
let answerStatus = 200;

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    calls.push(req.url ?? '');
    res.writeHead(answerStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url?.startsWith('/reverse') ? { features: [BEN_AKNOUN.features[0]] } : BEN_AKNOUN));
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  stack = await setupTestStack({ envOverrides: { placesSearchUrl: url, placesMaxPerHour: 5 } });
  seed = await seedDemo(stack.db);
  karim = await loginAs(stack, seed.phones.karim);
});
afterAll(async () => { await stack.teardown(); await new Promise<void>((r) => fake.close(() => r())); });

describe('lecture d’une réponse Photon', () => {
  it('garde les lieux d’Algérie, écarte le bruit (distributeurs) et l’étranger, nom + détail + wilaya + position', () => {
    const list = suggestionsFromPhoton(BEN_AKNOUN);
    expect(list.map((x) => x.name)).toEqual(['Ben Aknoun', 'Stade Mohamed Bentalha']);
    expect(list[1]).toMatchObject({ detail: 'Cité AADL La Réconciliation Nationale, Cité 324 lgts', wilaya: 'Alger', lat: 36.72, lng: 3.19 });
  });
  it('wilaya : la partie latine d’un nom en trois écritures', () => {
    expect(latinPart('Alger ⴷⵣⴰⵢⴻⵔ الجزائر')).toBe('Alger');
    expect(latinPart('Wilaya de Blida')).toBe('Blida');
    expect(latinPart(null)).toBeNull();
  });
});

describe('GET /places/search et /places/reverse', () => {
  it('exige un compte ; une recherche trop courte ne coûte rien', async () => {
    expect((await stack.app.inject({ method: 'GET', url: '/places/search?q=Ben' })).statusCode).toBe(401);
    const short = await stack.app.inject({ method: 'GET', url: '/places/search?q=B', headers: bearer(karim) });
    expect(short.json()).toEqual({ results: [] });
    expect(calls).toHaveLength(0);
  });

  it('interroge Photon en Algérie, près du joueur, et garde la réponse en mémoire', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/places/search?q=Ben%20Aknoun&lat=36.75&lng=3.06', headers: bearer(karim) });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { results: { name: string }[] }).results.map((x) => x.name)).toEqual(['Ben Aknoun', 'Stade Mohamed Bentalha']);
    expect(calls[0]).toContain('bbox=-8.67%2C18.96%2C11.98%2C37.12');
    expect(calls[0]).toContain('lat=36.750');
    await stack.app.inject({ method: 'GET', url: '/places/search?q=ben%20aknoun&lat=36.75&lng=3.06', headers: bearer(karim) });
    expect(calls).toHaveLength(1);   // même recherche : servie de mémoire
  });

  it('le lieu sous l’épingle', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/places/reverse?lat=36.7565&lng=3.0084', headers: bearer(karim) });
    expect(res.json()).toMatchObject({ place: { name: 'Ben Aknoun', wilaya: 'Alger' } });
    expect((await stack.app.inject({ method: 'GET', url: '/places/reverse?lat=abc&lng=3', headers: bearer(karim) })).statusCode).toBe(400);
  });

  it('service en panne : réponse vide et « indisponible », jamais une erreur pour l’app', async () => {
    answerStatus = 503;
    const res = await stack.app.inject({ method: 'GET', url: '/places/search?q=Hydra', headers: bearer(karim) });
    answerStatus = 200;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [], unavailable: true });
  });

  it('au-delà du plafond par joueur : 429', async () => {
    let last = 0;
    for (const q of ['Kouba', 'Bir Mourad Rais', 'Cheraga', 'Dely Brahim', 'Draria']) {
      last = (await stack.app.inject({ method: 'GET', url: `/places/search?q=${encodeURIComponent(q)}`, headers: bearer(karim) })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('match libre — la position du lieu est gardée', () => {
  it('POST /matches/free avec lat/lng : servie avec le lieu ; à moitié donnée : refusée', async () => {
    const start = Math.ceil((Date.now() + 500 * 3_600_000) / 1_800_000) * 1_800_000;
    const body = { place: { name: 'Stade Mohamed Bentalha', wilaya: 'Alger', lat: 36.72, lng: 3.19 }, format: '5v5', level: 'LOISIR', start, durationMin: 90 };
    const headers = { ...bearer(karim), 'x-moubarat-features': 'match-libre,format-9v9' };
    const res = await stack.app.inject({ method: 'POST', url: '/matches/free', headers, payload: body });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { match: { place: unknown } }).match.place).toEqual({ name: 'Stade Mohamed Bentalha', wilaya: 'Alger', lat: 36.72, lng: 3.19 });
    const half = await stack.app.inject({ method: 'POST', url: '/matches/free', headers, payload: { ...body, start: start + 3 * 3_600_000, place: { name: 'Stade', wilaya: 'Alger', lat: 36.72 } } });
    expect((half.json() as { error: string }).error).toBe('PLACE_INVALID');
  });
});
