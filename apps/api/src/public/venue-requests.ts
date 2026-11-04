import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { badRequest } from '../lib/http.js';
import { checkRateLimit, type RateLimiter } from '../lib/rate-limit.js';
import { hasControlChar } from '../lib/validate.js';

interface Deps { db: Db; ipLimiter?: RateLimiter; globalLimiter?: RateLimiter; }

const SPORTS = ['FOOTBALL', 'PADEL', 'BASKET'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Durée minimale de remplissage (mesurée PAR LE NAVIGATEUR, sur sa propre horloge — insensible à
    un décalage d'horloge entre le téléphone et le serveur). Un robot naïf qui poste sans afficher
    le formulaire n'envoie rien ou une valeur trop basse. Garde-fou best-effort : un robot évolué
    peut envoyer n'importe quel nombre — c'est pourquoi un CAPTCHA reste une option ultérieure. */
export const MIN_FILL_MS = 4_000;
const DUPLICATE_WINDOW_MS = 24 * 3_600_000;
const NEUTRAL = { ok: true } as const;

function text(value: unknown, label: string, min: number, max: number): string {
  const raw = typeof value === 'string' ? value : '';
  if (hasControlChar(raw)) throw badRequest(`${label} : caractères non autorisés.`);
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw badRequest(`${label} : entre ${min} et ${max} caractères.`);
  return s;
}

/* Formulaire PUBLIC « Référencer mon centre » (20/09/2026, demande d'Aymen) — aucun compte requis.
   Réponse NEUTRE : un robot ne peut pas distinguer une demande prise d'une demande écartée (piège
   à robots, remplissage trop rapide, doublon sur 24 h) — tous répondent le même 201. Seuls les
   dépassements de limite (429) et les champs invalides d'un vrai utilisateur (400) sont explicites. */
export async function registerPublicVenueRequestRoutes(app: FastifyInstance, { db, ipLimiter, globalLimiter }: Deps): Promise<void> {

  app.post<{
    Body: {
      name?: unknown; wilaya?: unknown; address?: unknown; contactName?: unknown; contactPhone?: unknown;
      contactEmail?: unknown; sports?: unknown; fieldsCount?: unknown; message?: unknown; consent?: unknown;
      website?: unknown; fillMs?: unknown;
    };
  }>('/public/venue-requests', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    await checkRateLimit(ipLimiter, req.ip, 'RATE_LIMITED', 'Trop de demandes depuis cette adresse. Réessayez plus tard.');
    const b = req.body ?? {};

    // Piège à robots : champ invisible pour un humain. Rempli → écarté, réponse identique.
    if (typeof b.website === 'string' && b.website.trim() !== '') return reply.code(201).send(NEUTRAL);

    const name = text(b.name, 'Nom du centre', 2, 80);
    const wilaya = text(b.wilaya, 'Wilaya', 2, 40);
    const address = text(b.address, 'Adresse', 5, 200);
    const contactName = text(b.contactName, 'Nom du contact', 2, 80);
    const contactEmail = text(b.contactEmail, 'Email', 5, 254).toLowerCase();
    if (!EMAIL_RE.test(contactEmail)) throw badRequest('Adresse email invalide.');
    const contactPhone = text(b.contactPhone, 'Téléphone', 8, 25).replace(/[\s.\-()]/g, '');
    if (!/^\+?\d{8,15}$/.test(contactPhone)) throw badRequest('Numéro de téléphone invalide.');

    const rawSports = Array.isArray(b.sports) ? b.sports : [];
    const sports = [...new Set(rawSports.map(String))];
    if (sports.length < 1 || sports.length > SPORTS.length || !sports.every((s) => (SPORTS as readonly string[]).includes(s))) {
      throw badRequest('Choisissez au moins un sport : football, padel ou basket.');
    }
    let fieldsCount: number | null = null;
    if (b.fieldsCount !== undefined && b.fieldsCount !== null && b.fieldsCount !== '') {
      fieldsCount = Number(b.fieldsCount);
      if (!Number.isInteger(fieldsCount) || fieldsCount < 1 || fieldsCount > 100) throw badRequest('Nombre de terrains : un entier entre 1 et 100.');
    }
    let message: string | null = null;
    if (typeof b.message === 'string' && b.message.trim() !== '') {
      message = b.message.trim().replace(/\r\n/g, '\n');
      if (message.length > 500 || hasControlChar(message, true)) throw badRequest('Message : 500 caractères maximum, texte simple.');
    }
    if (b.consent !== true) throw badRequest('Le consentement à être recontacté est requis.');

    // Trop rapide (ou non renseigné) : écarté en silence — jamais un indice pour un robot.
    const fillMs = Number(b.fillMs);
    if (!Number.isFinite(fillMs) || fillMs < MIN_FILL_MS) return reply.code(201).send(NEUTRAL);

    await checkRateLimit(globalLimiter, 'global', 'RATE_LIMITED', 'Trop de demandes en ce moment. Réessayez plus tard.');

    // Doublon (même email OU même téléphone) sur 24 h : écarté, réponse identique.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const dup = await db.selectFrom('venue_requests').select('id')
      .where('created_at', '>', since)
      .where((eb) => eb.or([eb(eb.fn('lower', ['contact_email']), '=', contactEmail), eb('contact_phone', '=', contactPhone)]))
      .limit(1).executeTakeFirst();
    if (dup) return reply.code(201).send(NEUTRAL);

    // Jamais l'adresse IP en clair : une empreinte suffit à repérer un abus (pseudonymisation, pas anonymat).
    const ipHash = createHash('sha256').update(`venue-request:${req.ip}`).digest('hex');
    await db.insertInto('venue_requests').values({
      name, wilaya, address, contact_name: contactName, contact_phone: contactPhone, contact_email: contactEmail,
      sports, fields_count: fieldsCount, message, consent_at: new Date(), ip_hash: ipHash,
    }).execute();
    return reply.code(201).send(NEUTRAL);
  });
}
