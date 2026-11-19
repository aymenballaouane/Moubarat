import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Guards } from '../src/auth/guards.js';
import type { RateLimiter } from '../src/lib/rate-limit.js';
import { registerPlaceRoutes } from '../src/modules/places/routes.js';
import { placeFromGeocode, placeFromGoogleDetails, suggestionsFromGoogle } from '../src/modules/places/google.js';

/* Lot B, phase 5 (19/11/2026) — Google Places (New) pour la recherche d'adresses, OpenStreetMap (Photon) en secours. Jamais le vrai
   Google depuis les tests : un faux `fetch` qui enregistre chaque appel. Les réponses suivent le format documenté par Google. */

const AUTOCOMPLETE = { suggestions: [
  { placePrediction: { place: 'places/ChIJcityfoot', placeId: 'ChIJcityfoot', text: { text: 'City Foot, Chéraga, Algérie' },
    structuredFormat: { mainText: { text: 'City Foot' }, secondaryText: { text: 'Chéraga, Algérie' } } } },
  { queryPrediction: { text: { text: 'city foot près de moi' } } },
  { placePrediction: { placeId: 'ChIJkiffan', structuredFormat: { mainText: { text: 'Kiffan Foot' }, secondaryText: { text: 'Rue des Frères, Bordj El Kiffan, Algérie' } } } },
] };
const DETAILS = {
  id: 'ChIJcityfoot', location: { latitude: 36.7671, longitude: 2.9586 },
  shortFormattedAddress: 'Rue Ali Khodja, Chéraga', formattedAddress: 'Rue Ali Khodja, Chéraga 16014, Algérie',
  addressComponents: [
    { longText: '12', types: ['street_number'] },
    { longText: 'Rue Ali Khodja', types: ['route'] },
    { longText: 'Chéraga', types: ['locality', 'political'] },
    { longText: 'Alger', types: ['administrative_area_level_1', 'political'] },
    { longText: 'Algérie', types: ['country', 'political'] },
  ],
};
const GEOCODE = { status: 'OK', results: [{ place_id: 'ChIJgeo', formatted_address: 'Rue Didouche Mourad, Alger Centre, Algérie', address_components: [
  { long_name: 'Rue Didouche Mourad', types: ['route'] },
  { long_name: 'Alger Centre', types: ['sublocality_level_1', 'sublocality'] },
  { long_name: 'Province d’Alger', types: ['administrative_area_level_1'] },
] }] };
const PHOTON = { features: [{ geometry: { coordinates: [3.0084, 36.7565] }, properties: { name: 'Ben Aknoun', state: 'Alger', countrycode: 'DZ', osm_type: 'R', osm_id: 1 } }] };

describe('lecture des réponses Google', () => {
  it('Autocomplete : nom, détail sans le pays, quartier ; pas de position ; les « requêtes » sans lieu sont ignorées', () => {
    const s = suggestionsFromGoogle(AUTOCOMPLETE);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ id: 'ChIJcityfoot', name: 'City Foot', detail: 'Chéraga', wilaya: null, street: null, area: 'Chéraga', lat: null, lng: null, needsDetails: true });
    expect(s[1]!.detail).toBe('Rue des Frères, Bordj El Kiffan');
  });
  it('Place Details : position, rue avec numéro, commune, wilaya ; le nom est celui de la suggestion', () => {
    expect(placeFromGoogleDetails(DETAILS, 'City Foot')).toEqual({
      id: 'ChIJcityfoot', name: 'City Foot', detail: 'Rue Ali Khodja, Chéraga', wilaya: 'Alger', street: '12 Rue Ali Khodja', area: 'Chéraga', lat: 36.7671, lng: 2.9586,
    });
    expect(placeFromGoogleDetails({ id: 'x' }, 'City Foot')).toBeNull();
  });
  it('Geocoding (secours de l’épingle) : la rue comme nom, « Province d’Alger » → « Alger »', () => {
    expect(placeFromGeocode(GEOCODE, 36.77, 3.05)).toMatchObject({ name: 'Rue Didouche Mourad', area: 'Alger Centre', wilaya: 'Alger', lat: 36.77, lng: 3.05 });
    expect(placeFromGeocode({ status: 'ZERO_RESULTS', results: [] }, 1, 2)).toBeNull();
  });
});

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let googleStatus = 200;
let photonStatus = 200;
const fakeFetch = (async (url: string | URL, init: RequestInit = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  const google = u.includes('googleapis.com');
  const status = google ? googleStatus : photonStatus;
  const body = u.includes('places:autocomplete') ? AUTOCOMPLETE : u.includes('/v1/places/') ? DETAILS : u.includes('geocode') ? GEOCODE : PHOTON;
  return new Response(JSON.stringify(status === 200 ? body : { error: { status: 'RESOURCE_EXHAUSTED' } }), { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const guards = { requireAuth: async (req: { auth?: unknown }) => { req.auth = { userId: 'u1' }; } } as unknown as Guards;
const limiter = { name: 'places', max: 100, window: 'hour', check: async () => ({ allowed: true }) } as unknown as RateLimiter;
const NEW_APP = { 'x-moubarat-features': 'match-libre,format-9v9,places-google' };

let app: FastifyInstance;
let bare: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  await registerPlaceRoutes(app, { guards, baseUrl: 'http://photon.test', limiter, fetchImpl: fakeFetch, googleKey: 'SERVER-KEY', mapsBrowserKey: 'BROWSER-KEY' });
  bare = Fastify();
  await registerPlaceRoutes(bare, { guards, baseUrl: 'http://photon.test', limiter, fetchImpl: fakeFetch });
});
afterAll(async () => { await app.close(); await bare.close(); });
beforeEach(() => { calls = []; googleStatus = 200; photonStatus = 200; });

describe('GET /places/search', () => {
  it('app à jour + clé : Google, en Algérie, en français, avec la session et la position du joueur ; la clé reste côté serveur', async () => {
    const res = await app.inject({ method: 'GET', url: '/places/search?q=city%20foot&lat=36.75&lng=3.05&session=0f8b2c1e-aaaa-4bbb-8ccc-123456789abc', headers: NEW_APP });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: { name: string; needsDetails?: boolean }[]; source: string };
    expect(body.source).toBe('google');
    expect(body.results.map((r) => r.name)).toEqual(['City Foot', 'Kiffan Foot']);
    expect(res.body).not.toContain('SERVER-KEY');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('SERVER-KEY');
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({ input: 'city foot', languageCode: 'fr', includedRegionCodes: ['dz'], sessionToken: '0f8b2c1e-aaaa-4bbb-8ccc-123456789abc' });
    expect(sent.locationBias.circle.center).toEqual({ latitude: 36.75, longitude: 3.05 });
  });

  it('une ancienne app (sans « places-google ») reste chez OpenStreetMap : chaque suggestion a sa position', async () => {
    const res = await app.inject({ method: 'GET', url: '/places/search?q=ben%20aknoun', headers: { 'x-moubarat-features': 'match-libre' } });
    expect((res.json() as { source: string }).source).toBe('osm');
    expect(calls.every((c) => c.url.startsWith('http://photon.test'))).toBe(true);
  });

  it('sans clé Google : OpenStreetMap, même pour une app à jour', async () => {
    const res = await bare.inject({ method: 'GET', url: '/places/search?q=ben%20aknoun%202', headers: NEW_APP });
    expect((res.json() as { source: string }).source).toBe('osm');
  });

  it('Google refuse (plafond du jour atteint) : la même recherche part chez OpenStreetMap, sans erreur pour le joueur', async () => {
    googleStatus = 429;
    const res = await app.inject({ method: 'GET', url: '/places/search?q=kouba', headers: NEW_APP });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'osm', results: [{ name: 'Ben Aknoun' }] });
    expect(calls.map((c) => c.url.includes('googleapis.com'))).toEqual([true, false]);
  });

  it('une réponse est gardée 10 minutes : la même recherche ne rappelle pas Google', async () => {
    await app.inject({ method: 'GET', url: '/places/search?q=hydra', headers: NEW_APP });
    await app.inject({ method: 'GET', url: '/places/search?q=hydra', headers: NEW_APP });
    expect(calls).toHaveLength(1);
  });
});

describe('GET /places/details', () => {
  it('la position d’une suggestion Google, champs « Essentials » seulement, même session', async () => {
    const res = await app.inject({ method: 'GET', url: '/places/details?id=ChIJcityfoot&name=City%20Foot&session=0f8b2c1e-aaaa-4bbb-8ccc-123456789abc' });
    expect(res.json()).toEqual({ place: expect.objectContaining({ name: 'City Foot', lat: 36.7671, lng: 2.9586, wilaya: 'Alger' }) });
    expect(calls[0]!.url).toContain('/v1/places/ChIJcityfoot?');
    expect(calls[0]!.url).toContain('sessionToken=0f8b2c1e');
    const mask = (calls[0]!.init.headers as Record<string, string>)['x-goog-fieldmask'];
    expect(mask).not.toContain('displayName');
  });
  it('Google indisponible : `unavailable`, jamais une erreur ; identifiant douteux : 400', async () => {
    googleStatus = 500;
    expect((await app.inject({ method: 'GET', url: '/places/details?id=ChIJautre&name=X' })).json()).toEqual({ place: null, unavailable: true });
    expect((await app.inject({ method: 'GET', url: '/places/details?id=../../secret&name=X' })).statusCode).toBe(400);
  });
});

describe('GET /places/reverse et /places/map-config', () => {
  it('l’adresse sous l’épingle reste chez OpenStreetMap ; Google Geocoding seulement en secours', async () => {
    const a = await app.inject({ method: 'GET', url: '/places/reverse?lat=36.7565&lng=3.0084' });
    expect(a.json()).toMatchObject({ place: { name: 'Ben Aknoun' } });
    expect(calls.some((c) => c.url.includes('googleapis.com'))).toBe(false);
    photonStatus = 503;
    const b = await app.inject({ method: 'GET', url: '/places/reverse?lat=36.7700&lng=3.0500' });
    expect(b.json()).toMatchObject({ place: { name: 'Rue Didouche Mourad' } });
  });
  it('la clé navigateur de la carte (publique, limitée au site) ; `null` sans clé', async () => {
    expect((await app.inject({ method: 'GET', url: '/places/map-config' })).json()).toEqual({ googleMapsKey: 'BROWSER-KEY' });
    expect((await bare.inject({ method: 'GET', url: '/places/map-config' })).json()).toEqual({ googleMapsKey: null });
  });
});
