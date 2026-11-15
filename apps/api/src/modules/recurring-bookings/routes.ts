import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { badRequest } from '../../lib/http.js';
import { dayStartMs, hhmm } from '../../lib/algiers.js';
import { createRecurringBooking, endRecurringBooking, listRecurringBookings, setRecurringPrice } from './service.js';
import { revertSession, setSessionStatus } from './sessions.js';

interface Deps { db: Db; guards: PlatformGuards; }

interface CreateBody {
  fieldId?: string; weekday?: number; startMin?: number; durationMin?: number;
  holderName?: string; activeFrom?: string; activeUntil?: string;
  /** P1-12 (15/11/2026) : prix d'une séance, en DA. */
  pricePerSessionDa?: number;
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
        ...(b.pricePerSessionDa !== undefined ? { pricePerSessionDa: Number(b.pricePerSessionDa) } : {}),
      });

      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'SUBSCRIPTION_CHANGED', objectType: 'recurring_booking', objectId: created.id,
        summary: `a créé l'abonnement ${created.holderName} · ${created.fieldName} · ${DAY_LABELS[created.weekday]} ${hhmm(created.startMin)}${created.pricePerSessionDa !== null ? ` · ${created.pricePerSessionDa} DA la séance` : ''}`,
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

  /* P1-12 (audit stratégique du CRM, 15/11/2026) : fixer ou changer le prix d'une séance (Manager et au-dessus). Vaut pour les
     séances dont le statut n'est pas encore posé ; les autres gardent le prix figé à l'enregistrement. */
  app.patch<{ Params: { venueId: string; id: string }; Body: { pricePerSessionDa?: unknown } }>('/venues/:venueId/recurring-bookings/:id',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'MANAGE_SUBSCRIPTIONS');
      if (typeof req.body?.pricePerSessionDa !== 'number') throw badRequest('pricePerSessionDa attendu (entier de DA > 0).');
      const { sub, previous } = await setRecurringPrice(db, req.params.venueId, req.params.id, req.body.pricePerSessionDa);
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'SUBSCRIPTION_CHANGED', objectType: 'recurring_booking', objectId: sub.id,
        summary: `a fixé le prix par séance de l'abonnement ${sub.holderName} : ${previous ?? '—'} → ${sub.pricePerSessionDa} DA`,
      });
      return reply.send({ subscription: sub });
    });

  /* P1-12 : poser le statut d'une séance — Payée / Honorée / No-show, mêmes règles qu'une réservation (sessions.ts), même
     permission (SET_CASH_STATUS : Réception et au-dessus). `recordCash` (avec Payée) : encaissement en caisse, comme P1-11. */
  app.post<{ Params: { venueId: string; id: string; date: string }; Body: { status?: string; recordCash?: unknown } }>(
    '/venues/:venueId/recurring-bookings/:id/sessions/:date/status',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'SET_CASH_STATUS');
      const to = String(req.body?.status ?? '');
      if (to !== 'HONORED' && to !== 'PAID' && to !== 'NO_SHOW') throw badRequest('Statut cible invalide : HONORED, PAID ou NO_SHOW.');
      if (req.body?.recordCash !== undefined && typeof req.body.recordCash !== 'boolean') throw badRequest('recordCash doit être un booléen.');
      const out = await setSessionStatus(db, {
        venueId: req.params.venueId, recurringId: req.params.id, date: req.params.date, to,
        actorId: req.platformAuth!.accountId, role, recordCash: req.body?.recordCash === true, now: Date.now(),
      });
      return reply.send({ ok: true, ...out });
    });

  /* P1-12 : corriger une séance marquée par erreur — Manager et propriétaire (REVERT_NO_SHOW, comme une réservation). */
  app.post<{ Params: { venueId: string; id: string; date: string } }>('/venues/:venueId/recurring-bookings/:id/sessions/:date/revert',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'REVERT_NO_SHOW');
      await revertSession(db, { venueId: req.params.venueId, recurringId: req.params.id, date: req.params.date, actorId: req.platformAuth!.accountId, role });
      return reply.send({ ok: true, status: 'RESERVED' });
    });
}

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
