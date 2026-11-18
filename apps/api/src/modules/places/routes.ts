import type { FastifyInstance } from 'fastify';
import type { Guards } from '../../auth/guards.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { ApiError, badRequest } from '../../lib/http.js';
import { ALGERIA_BBOX, suggestionsFromPhoton, type PlaceSuggestion } from './photon.js';

/* Phase adresses (GO d'Aymen du 18/11/2026) — la recherche d'adresses de l'écran « Où tu joues ? » (W2) et le nom du lieu sous
   l'épingle de la carte. Notre serveur fait l'intermédiaire avec Photon (OpenStreetMap) : l'app ne parle jamais directement au service,
   les réponses sont gardées en mémoire 10 minutes, un plafond par joueur protège le service public (« usage raisonnable »), et une
   panne de Photon ne casse rien — la réponse dit `unavailable: true`, l'app garde la saisie libre et l'épingle.

   - GET /places/search?q=…&lat=…&lng=…  (joueur connecté) — au plus 6 lieux en Algérie, proches de (lat, lng) d'abord.
   - GET /places/reverse?lat=…&lng=…     (joueur connecté) — le lieu sous l'épingle. */

interface Deps { guards: Guards; baseUrl: string; limiter: RateLimiter; fetchImpl?: typeof fetch }

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 4_000;
const USER_AGENT = 'Moubarat/1.0 (+https://app.moubarat.app)';

function num(raw: unknown, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export async function registerPlaceRoutes(app: FastifyInstance, { guards, baseUrl, limiter, fetchImpl = fetch }: Deps): Promise<void> {
  const cache = new Map<string, { at: number; results: PlaceSuggestion[] }>();

  async function ask(url: string, key: string, userId: string): Promise<{ results: PlaceSuggestion[]; unavailable?: true }> {
    if (!baseUrl) return { results: [], unavailable: true };
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { results: hit.results };
    const { allowed } = await limiter.check(userId);
    if (!allowed) throw new ApiError(429, 'PLACES_RATE_LIMITED', 'Trop de recherches d’adresses : réessaie dans un moment.');
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        app.log.warn({ event: 'places_unavailable', status: res.status }, 'service d’adresses indisponible');
        return { results: [], unavailable: true };
      }
      const results = suggestionsFromPhoton(await res.json());
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), results });
      return { results };
    } catch (err) {
      app.log.warn({ event: 'places_unavailable', err: err instanceof Error ? err.message : String(err) }, 'service d’adresses injoignable');
      return { results: [], unavailable: true };
    }
  }

  app.get<{ Querystring: { q?: string; lat?: string; lng?: string } }>('/places/search',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const q = (req.query.q ?? '').trim().replace(/\s+/g, ' ');
      if (q.length < 2) return reply.send({ results: [] });
      if (q.length > 80) throw badRequest('Recherche trop longue (80 caractères au plus).');
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      const params = new URLSearchParams({ q, limit: '10', lang: 'fr', bbox: ALGERIA_BBOX });
      if (lat !== null && lng !== null) { params.set('lat', lat.toFixed(3)); params.set('lon', lng.toFixed(3)); }
      const key = `s|${q.toLowerCase()}|${lat?.toFixed(2) ?? ''}|${lng?.toFixed(2) ?? ''}`;
      return reply.send(await ask(`${baseUrl}/api/?${params}`, key, req.auth!.userId));
    });

  app.get<{ Querystring: { lat?: string; lng?: string } }>('/places/reverse',
    { preHandler: (req) => guards.requireAuth(req) }, async (req, reply) => {
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      if (lat === null || lng === null) throw badRequest('Position invalide.');
      const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), lang: 'fr', limit: '1' });
      const key = `r|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      const { results, unavailable } = await ask(`${baseUrl}/reverse?${params}`, key, req.auth!.userId);
      return reply.send({ place: results[0] ?? null, ...(unavailable ? { unavailable } : {}) });
    });
}
