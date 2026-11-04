import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { badRequest } from '../../lib/http.js';
import { createPromo, listPromosWithRoi, publicPromo, setPromoActive } from './service.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface PromoBody {
  code?: string; label?: string; percentOff?: number; weekdays?: number[];
  startMin?: number; endMin?: number; validFrom?: string; validUntil?: string;
  fieldIds?: string[]; sports?: string[]; exclusions?: string[]; maxUses?: number;
  minDurationMin?: number; priority?: number;
}

const EXCLUSION_VALUES = ['SUBSCRIPTION', 'EXTERNAL', 'TOURNAMENT'] as const;

export async function registerPromoRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Création — Manager+ (permission core MANAGE_PROMOS). validatePromoDefinition/
     validatePromoLimits (core, crm.ts) sont les seules gardes ; aucune règle
     de format/plage recodée côté API. */
  app.post<{ Params: { venueId: string }; Body: PromoBody }>('/venues/:venueId/promos',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_PROMOS');
      const b = req.body ?? {};
      const code = String(b.code ?? '').toUpperCase();
      const label = String(b.label ?? '').trim();
      if (!label) throw badRequest('label manquant.');
      const percentOff = Number(b.percentOff);
      const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number) : [];
      const startMin = Number(b.startMin);
      const endMin = Number(b.endMin);
      const validFromMs = Date.parse(String(b.validFrom ?? ''));
      const validUntilMs = Date.parse(String(b.validUntil ?? ''));
      if (Number.isNaN(validFromMs) || Number.isNaN(validUntilMs)) {
        throw badRequest('validFrom/validUntil attendus au format date ISO.');
      }
      const exclusions = Array.isArray(b.exclusions)
        ? b.exclusions.filter((e): e is typeof EXCLUSION_VALUES[number] => (EXCLUSION_VALUES as readonly string[]).includes(e))
        : undefined;

      const created = await createPromo(db, req.params.venueId, {
        code, label, percentOffDa: percentOff, weekdays, startMin, endMin, validFromMs, validUntilMs,
        ...(b.fieldIds ? { fieldIds: b.fieldIds } : {}), ...(b.sports ? { sports: b.sports } : {}),
        ...(exclusions ? { exclusions } : {}), ...(b.maxUses !== undefined ? { maxUses: Number(b.maxUses) } : {}),
        ...(b.minDurationMin !== undefined ? { minDurationMin: Number(b.minDurationMin) } : {}),
        ...(b.priority !== undefined ? { priority: Number(b.priority) } : {}),
      });
      return reply.code(201).send({ promo: publicPromo(created) });
    });

  /* Liste + ROI (revenu réel généré vs remise accordée, via cashReport
     canonique) — même permission que la création. */
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/promos',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_PROMOS');
      const promos = await listPromosWithRoi(db, req.params.venueId);
      return reply.send({ promos });
    });

  app.post<{ Params: { venueId: string; id: string }; Body: { active?: boolean } }>(
    '/venues/:venueId/promos/:id/active',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_PROMOS');
      const active = Boolean(req.body?.active);
      const updated = await setPromoActive(db, req.params.venueId, req.params.id, active);
      return reply.send({ promo: publicPromo(updated) });
    });
}
