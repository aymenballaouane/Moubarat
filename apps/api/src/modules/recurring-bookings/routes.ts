import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { badRequest } from '../../lib/http.js';
import { dayStartMs, hhmm } from '../../lib/algiers.js';
import { createRecurringBooking, endRecurringBooking, listRecurringBookings } from './service.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface CreateBody {
  fieldId?: string; weekday?: number; startMin?: number; durationMin?: number;
  holderName?: string; activeFrom?: string; activeUntil?: string;
}

/** Écran CRM Abonnements (06/09/2026) : `recurring_bookings` existait déjà
    (schéma gelé, moteur de blocage core) mais aucune route n'exposait sa
    gestion — chantier serveur réel, pas un branchement. Portée strictement
    égale à ce que l'écran fait : créer/résilier un créneau hebdomadaire daté,
    jamais séances/paiement/suspension/report (V1.5, docs/CRM_MASTER_SPEC_V1.md
    §30). MANAGE_SUBSCRIPTIONS = Manager+ (core), comme les promos. */
export async function registerRecurringBookingRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  app.get<{ Params: { venueId: string } }>('/venues/:venueId/recurring-bookings',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_SUBSCRIPTIONS');
      const subscriptions = await listRecurringBookings(db, req.params.venueId);
      return reply.send({ subscriptions });
    });

  app.post<{ Params: { venueId: string }; Body: CreateBody }>('/venues/:venueId/recurring-bookings',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_SUBSCRIPTIONS');
      const b = req.body ?? {};
      if (!b.fieldId) throw badRequest('fieldId manquant.');
      if (!b.holderName) throw badRequest('holderName manquant.');
      let activeFromMs: number;
      try { activeFromMs = dayStartMs(String(b.activeFrom ?? '')); }
      catch { throw badRequest('activeFrom attendu au format YYYY-MM-DD.'); }
      let activeUntilMs: number | undefined;
      if (b.activeUntil) {
        try { activeUntilMs = dayStartMs(String(b.activeUntil)); }
        catch { throw badRequest('activeUntil attendu au format YYYY-MM-DD.'); }
      }

      const created = await createRecurringBooking(db, req.params.venueId, {
        fieldId: b.fieldId, weekday: Number(b.weekday), startMin: Number(b.startMin),
        durationMin: Number(b.durationMin), holderName: String(b.holderName),
        activeFromMs, ...(activeUntilMs !== undefined ? { activeUntilMs } : {}),
      });

      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'SUBSCRIPTION_CHANGED', objectType: 'recurring_booking', objectId: created.id,
        summary: `a créé l'abonnement ${created.holderName} · ${created.fieldName} · ${DAY_LABELS[created.weekday]} ${hhmm(created.startMin)}`,
      });
      return reply.code(201).send({ subscription: created });
    });

  app.post<{ Params: { venueId: string; id: string } }>('/venues/:venueId/recurring-bookings/:id/end',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_SUBSCRIPTIONS');
      const ended = await endRecurringBooking(db, req.params.venueId, req.params.id);
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'SUBSCRIPTION_CHANGED', objectType: 'recurring_booking', objectId: ended.id,
        summary: `a résilié l'abonnement ${ended.holderName} · ${ended.fieldName} · ${DAY_LABELS[ended.weekday]} ${hhmm(ended.startMin)}`,
      });
      return reply.send({ subscription: ended });
    });
}

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
