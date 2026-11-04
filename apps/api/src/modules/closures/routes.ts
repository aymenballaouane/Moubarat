import type { FastifyInstance } from 'fastify';
import type { ClosureReason } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { badRequest } from '../../lib/http.js';
import { algiersDateOf } from '../../lib/algiers.js';
import { createClosure, deleteClosure, listClosures, type ClosurePublic } from './service.js';

interface Deps { db: Db; guards: PlatformGuards; }

const REASONS: readonly ClosureReason[] = ['HOLIDAY', 'EVENT', 'MAINTENANCE', 'OTHER'];
const REASON_LABELS: Record<ClosureReason, string> = {
  HOLIDAY: 'Jour férié', EVENT: 'Événement', MAINTENANCE: 'Maintenance', OTHER: 'Autre',
};

function publicShape(c: ClosurePublic) {
  return {
    id: c.id, fieldId: c.fieldId, fieldName: c.fieldName,
    startMs: c.startMs, endMs: c.endMs, reason: c.reason, label: c.label,
  };
}

/* Audit général (§5.6) + demande d'Aymen (14-15/09/2026) : le schéma
   (`closures`) et sa lecture par le moteur de disponibilité existaient déjà,
   jamais câblés en écriture. VIEW_PLANNING (tous les rôles) pour consulter —
   c'est une information de planning ; EDIT_HOURS (Manager+) pour créer/
   retirer, même permission que les horaires d'ouverture, dont une fermeture
   exceptionnelle est la contrepartie ponctuelle. */
export async function registerClosureRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.get<{ Params: { venueId: string } }>('/venues/:venueId/closures',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
      const closures = await listClosures(db, req.params.venueId);
      return reply.send({ closures: closures.map(publicShape) });
    });

  app.post<{
    Params: { venueId: string };
    Body: {
      fieldId?: string | null; reason?: string; label?: string;
      date?: string; wholeDay?: boolean; startMin?: number; endMin?: number;
    };
  }>('/venues/:venueId/closures', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_HOURS');
    const b = req.body ?? {};
    const reason = String(b.reason ?? '') as ClosureReason;
    if (!REASONS.includes(reason)) throw badRequest(`Motif invalide : ${REASONS.join(', ')}.`);
    const date = String(b.date ?? '');
    const wholeDay = b.wholeDay === true;
    const fieldId = b.fieldId ?? null;

    const closure = await createClosure(db, {
      venueId: req.params.venueId, fieldId, reason, date, wholeDay,
      ...(b.label !== undefined ? { label: String(b.label) } : {}),
      ...(!wholeDay ? { startMin: Number(b.startMin), endMin: Number(b.endMin) } : {}),
    });

    const dateLabel = algiersDateOf(closure.startMs);
    const target = closure.fieldName ? `le terrain ${closure.fieldName}` : 'le centre';
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'CENTER_UPDATED', objectType: 'closure', objectId: closure.id,
      summary: `a fermé ${target} le ${dateLabel} (${REASON_LABELS[closure.reason]})${closure.label ? ` — ${closure.label}` : ''}`,
    });
    return reply.code(201).send({ closure: publicShape(closure) });
  });

  app.delete<{ Params: { venueId: string; id: string } }>('/venues/:venueId/closures/:id',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_HOURS');
      const removed = await deleteClosure(db, req.params.venueId, req.params.id);

      const dateLabel = algiersDateOf(removed.startMs);
      const target = removed.fieldName ? `du terrain ${removed.fieldName}` : 'du centre';
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'CENTER_UPDATED', objectType: 'closure', objectId: removed.id,
        summary: `a retiré la fermeture ${target} du ${dateLabel} (${REASON_LABELS[removed.reason]})`,
      });
      return reply.code(204).send();
    });
}
