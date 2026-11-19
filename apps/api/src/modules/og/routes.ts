import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { OG_FALLBACK, ogText, type OgLang, type OgMatch } from './content.js';
import { renderOgImage } from './image.js';

/* Lot B, phase 2 — l'aperçu d'un lien de match. Les robots de WhatsApp (et des autres messageries) n'exécutent pas le JavaScript : la
   page « app.moubarat.app/m/CODE » reçoit ses balises og:* d'un petit relais côté Vercel (apps/player/middleware.ts), qui lit ici :
     GET /og/m/:code?l=fr|ar            → { found, title, description }
     GET /og/m/:code/image.png?l=fr|ar  → l'image 1200 × 630
   Publiques, sans compte (comme la fiche d'un match par son code) ; rien de nominatif (ni inscrit ni organisateur). Code inconnu ou match
   annulé : « Moubarat Sport » et « Organise ton match, trouve des joueurs. ». Mémoire de 10 minutes par code, langue et remplissage. */

const TTL_MS = 10 * 60_000;
const MAX = 300;
const cache = new Map<string, { at: number; png: Buffer }>();

function langOf(raw: unknown): OgLang { return raw === 'ar' ? 'ar' : 'fr'; }

async function loadOgMatch(db: Db, rawCode: string): Promise<OgMatch | null> {
  const code = String(rawCode).trim().toUpperCase();
  if (!/^[A-Z2-9]{4,10}$/.test(code)) return null;
  const row = await db.selectFrom('matches')
    .leftJoin('fields', 'fields.id', 'matches.field_id')
    .leftJoin('venues', 'venues.id', 'fields.venue_id')
    .select(['matches.id', 'matches.format', 'matches.time_range', 'matches.capacity', 'matches.status', 'matches.place_name', 'matches.place_wilaya', 'venues.name as venue_name', 'venues.wilaya as venue_wilaya'])
    .where('matches.code', '=', code).executeTakeFirst();
  if (!row || row.status === 'CANCELLED') return null;
  const range = fromPgRange(row.time_range);
  if (range.end < Date.now()) return null;
  const joined = await db.selectFrom('match_players').select((eb) => eb.fn.countAll<string>().as('n'))
    .where('match_id', '=', row.id).where('status', '=', 'JOINED').executeTakeFirst();
  return {
    format: row.format, start: range.start, capacity: row.capacity, joined: Number(joined?.n ?? 0),
    placeName: row.venue_name ?? row.place_name ?? '', wilaya: row.venue_wilaya ?? row.place_wilaya,
  };
}

export async function registerOgRoutes(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  const { db } = deps;

  app.get<{ Params: { code: string }; Querystring: { l?: string } }>('/og/m/:code', async (req, reply) => {
    const lang = langOf(req.query.l);
    const m = await loadOgMatch(db, req.params.code);
    reply.header('cache-control', 'public, max-age=300');
    if (!m) return reply.send({ found: false, ...OG_FALLBACK[lang] });
    const t = ogText(m, lang);
    return reply.send({ found: true, title: t.title, description: t.description });
  });

  app.get<{ Params: { code: string }; Querystring: { l?: string } }>('/og/m/:code/image.png', async (req, reply) => {
    const lang = langOf(req.query.l);
    const m = await loadOgMatch(db, req.params.code);
    const key = m ? `${req.params.code.toUpperCase()}|${lang}|${m.joined}|${m.start}` : `-|${lang}`;
    const hit = cache.get(key);
    let png: Buffer;
    if (hit && Date.now() - hit.at < TTL_MS) png = hit.png;
    else {
      png = await renderOgImage(m ? ogText(m, lang) : null, lang);
      if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), png });
    }
    return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=600').send(png);
  });
}
