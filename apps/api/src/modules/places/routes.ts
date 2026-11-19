import type { FastifyInstance } from 'fastify';
import type { Guards } from '../../auth/guards.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { ApiError, badRequest } from '../../lib/http.js';
import { clientFeatures, FEATURE_PLACES_GOOGLE } from '../../lib/client-features.js';
import { ALGERIA_BBOX, suggestionsFromPhoton, type PlaceSuggestion } from './photon.js';
import { placeFromGeocode, placeFromGoogleDetails, suggestionsFromGoogle, type PendingSuggestion } from './google.js';

/* Phase adresses (GO d'Aymen du 18/11/2026) — la recherche d'adresses de l'écran « Où tu joues ? » et le nom du lieu sous l'épingle.
   Notre serveur fait l'intermédiaire : l'app ne parle jamais directement au service d'adresses, les réponses sont gardées en mémoire
   10 minutes, un plafond par joueur protège le service, et une panne ne casse rien — la réponse dit `unavailable: true`, l'app garde la
   saisie libre et l'épingle.

   Lot B, phase 5 (19/11/2026, décision d'Aymen : « on part sur Google », OpenStreetMap gardé en secours) :
   - recherche : Google Places (New) si la clé serveur est posée (GOOGLE_PLACES_SERVER_KEY) ET que l'app se déclare capable
     (`X-Moubarat-Features: places-google` — une suggestion Google n'a pas de position, une ancienne app ne saurait pas la demander).
     Google en panne, plafond du jour atteint, clé refusée : la même recherche part chez Photon, sans que le joueur le voie ;
   - GET /places/details : la position d'une suggestion Google, au toucher (même « session » que la recherche : Google facture la
     recherche et le choix ensemble) ;
   - l'adresse sous l'épingle reste chez Photon (gratuit, l'épingle bouge souvent) ; Google Geocoding ne sert qu'en secours ;
   - GET /places/map-config : la clé navigateur de la carte Google (GOOGLE_MAPS_BROWSER_KEY, publique par nature, limitée au site). */

interface Deps {
  guards: Guards; baseUrl: string; limiter: RateLimiter; fetchImpl?: typeof fetch;
  /** Clé serveur Google (Places API (New) + Geocoding API). `null` = Google coupé, Photon seul. */
  googleKey?: string | null;
  /** Clé navigateur de la carte Google (Maps JavaScript API). `null` = la carte de secours (Leaflet). */
  mapsBrowserKey?: string | null;
}

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 4_000;
const USER_AGENT = 'Moubarat/1.0 (+https://app.moubarat.app)';
const GOOGLE_AUTOCOMPLETE = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_DETAILS = 'https://places.googleapis.com/v1/places/';
const GOOGLE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
/** Champs « Essentials » de Place Details (New) — le palier le moins cher ; jamais `displayName`. */
const DETAILS_FIELDS = 'id,location,shortFormattedAddress,formattedAddress,addressComponents';

type Suggestion = PlaceSuggestion | PendingSuggestion;
type Answer = { results: Suggestion[]; unavailable?: true; source?: 'google' | 'osm' };

function num(raw: unknown, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Jeton de session fourni par l'app (UUID) : transmis tel quel à Google, rien d'autre n'est accepté. */
function sessionToken(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
}

export async function registerPlaceRoutes(app: FastifyInstance, { guards, baseUrl, limiter, fetchImpl = fetch, googleKey = null, mapsBrowserKey = null }: Deps): Promise<void> {
  const cache = new Map<string, { at: number; value: unknown }>();
  const cached = <T>(key: string): T | undefined => {
    const hit = cache.get(key);
    return hit && Date.now() - hit.at < CACHE_MS ? (hit.value as T) : undefined;
  };
  const remember = (key: string, value: unknown) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value });
  };
  async function guard(userId: string) {
    const { allowed } = await limiter.check(userId);
    if (!allowed) throw new ApiError(429, 'PLACES_RATE_LIMITED', 'Trop de recherches d’adresses : réessaie dans un moment.');
  }
  /** Un appel au service : le corps JSON, ou `null` (panne, refus, plafond, délai) — jamais une erreur pour l'app. */
  async function call(service: 'osm' | 'google', url: string, init: RequestInit = {}): Promise<unknown | null> {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        app.log.warn({ event: service === 'google' ? 'places_google_unavailable' : 'places_unavailable', status: res.status }, 'service d’adresses indisponible');
        return null;
      }
      return await res.json();
    } catch (err) {
      app.log.warn({ event: service === 'google' ? 'places_google_unavailable' : 'places_unavailable', err: err instanceof Error ? err.message : String(err) }, 'service d’adresses injoignable');
      return null;
    }
  }
  const osm = (url: string) => (baseUrl ? call('osm', url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }) : Promise.resolve(null));
  const googleHeaders = (extra: Record<string, string> = {}) => ({ 'x-goog-api-key': googleKey!, accept: 'application/json', ...extra });

  app.get<{ Querystring: { q?: string; lat?: string; lng?: string; session?: string } }>('/places/search',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const q = (req.query.q ?? '').trim().replace(/\s+/g, ' ');
      if (q.length < 2) return reply.send({ results: [] });
      if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      const useGoogle = Boolean(googleKey) && clientFeatures(req.headers).has(FEATURE_PLACES_GOOGLE);
      const where = `${q.toLowerCase()}|${lat?.toFixed(2) ?? ''}|${lng?.toFixed(2) ?? ''}`;

      if (useGoogle) {
        const key = `gs|${where}`;
        const hit = cached<Answer>(key);
        if (hit) return reply.send(hit);
        await guard(req.auth!.userId);
        const token = sessionToken(req.query.session);
        const body = await call('google', GOOGLE_AUTOCOMPLETE, {
          method: 'POST',
          headers: googleHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            input: q, languageCode: 'fr', includedRegionCodes: ['dz'],
            ...(lat !== null && lng !== null ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 30_000 } } } : {}),
            ...(token ? { sessionToken: token } : {}),
          }),
        });
        if (body !== null) {
          const answer: Answer = { results: suggestionsFromGoogle(body), source: 'google' };
          remember(key, answer);
          return reply.send(answer);
        }
        // Google indisponible : la même recherche chez OpenStreetMap (déjà comptée dans le plafond du joueur).
      }

      const key = `s|${where}`;
      const hit = cached<Answer>(key);
      if (hit) return reply.send(hit);
      if (!useGoogle) await guard(req.auth!.userId);
      if (!baseUrl) return reply.send({ results: [], unavailable: true });
      const params = new URLSearchParams({ q, limit: '10', lang: 'fr', bbox: ALGERIA_BBOX });
      if (lat !== null && lng !== null) { params.set('lat', lat.toFixed(3)); params.set('lon', lng.toFixed(3)); }
      const body = await osm(`${baseUrl}/api/?${params}`);
      if (body === null) return reply.send({ results: [], unavailable: true });
      const answer: Answer = { results: suggestionsFromPhoton(body), source: 'osm' };
      remember(key, answer);
      return reply.send(answer);
    });

  app.get<{ Querystring: { id?: string; name?: string; session?: string } }>('/places/details',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const id = (req.query.id ?? '').trim();
      const name = (req.query.name ?? '').trim().slice(0, 120);
      if (!/^[A-Za-z0-9_-]{4,300}$/.test(id) || !name) throw badRequest('Lieu invalide.');
      if (!googleKey) return reply.send({ place: null, unavailable: true });
      const key = `d|${id}|${name.toLowerCase()}`;
      const hit = cached<{ place: PlaceSuggestion }>(key);
      if (hit) return reply.send(hit);
      await guard(req.auth!.userId);
      const token = sessionToken(req.query.session);
      const params = new URLSearchParams({ languageCode: 'fr', regionCode: 'dz', ...(token ? { sessionToken: token } : {}) });
      const body = await call('google', `${GOOGLE_DETAILS}${encodeURIComponent(id)}?${params}`, { headers: googleHeaders({ 'x-goog-fieldmask': DETAILS_FIELDS }) });
      const place = body === null ? null : placeFromGoogleDetails(body, name);
      if (!place) return reply.send({ place: null, unavailable: true });
      const answer = { place };
      remember(key, answer);
      return reply.send(answer);
    });

  app.get<{ Querystring: { lat?: string; lng?: string } }>('/places/reverse',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      if (lat === null || lng === null) throw badRequest('Position invalide.');
      const key = `r|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      const hit = cached<{ place: PlaceSuggestion | null }>(key);
      if (hit) return reply.send(hit);
      await guard(req.auth!.userId);
      const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), lang: 'fr', limit: '1' });
      const body = baseUrl ? await osm(`${baseUrl}/reverse?${params}`) : null;
      if (body !== null) {
        const answer = { place: suggestionsFromPhoton(body)[0] ?? null };
        remember(key, answer);
        return reply.send(answer);
      }
      if (googleKey) {
        const g = await call('google', `${GOOGLE_GEOCODE}?${new URLSearchParams({ latlng: `${lat.toFixed(6)},${lng.toFixed(6)}`, language: 'fr', key: googleKey })}`);
        if (g !== null) {
          const answer = { place: placeFromGeocode(g, lat, lng) };
          remember(key, answer);
          return reply.send(answer);
        }
      }
      return reply.send({ place: null, unavailable: true });
    });

  app.get('/places/map-config', { preHandler: (req) => guards.requireAuth(req) }, async (_req, reply) => {
    reply.header('cache-control', 'private, max-age=600');
    return reply.send({ googleMapsKey: mapsBrowserKey });
  });
}
