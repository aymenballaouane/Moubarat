import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import {
  buildOccupancyReport, buildOriginReport, buildRevenueReport, loadPeriodBookings,
  parsePeriod, previousPeriod,
} from './service.js';
import { buildExportWorkbook, exportFilename, exportRowsFromBookings, loadBookingsForExport } from './export.js';

interface Deps { db: Db; guards: PlatformGuards; }

type Query = { from?: string; to?: string; fieldId?: string };

/** Variation relative arrondie au point de pourcentage — null si la base de
    comparaison est nulle (rien à comparer, pas une variation de 0 %). */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function registerAnalyticsRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* CA — collecté/engagé/perdu, réparti par source ET par terrain, sur une
     période. `cashReport` (core) exclut déjà les blocages CENTER — jamais du
     chiffre. Réservé Manager+ (permission core VIEW_ANALYTICS). */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/revenue',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const period = parsePeriod(req.query.from, req.query.to);
      const bookings = await loadPeriodBookings(db, req.params.venueId, period, req.query.fieldId);
      return reply.send({ period, ...buildRevenueReport(bookings) });
    });

  /* Occupation — globale et par terrain, sur la même période. */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/occupancy',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const period = parsePeriod(req.query.from, req.query.to);
      const bookings = await loadPeriodBookings(db, req.params.venueId, period);
      const report = await buildOccupancyReport(db, req.params.venueId, period, bookings);
      return reply.send({ period, ...report });
    });

  /* Origine des réservations — part Moubarat / téléphone / comptoir. */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/origin',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const period = parsePeriod(req.query.from, req.query.to);
      const bookings = await loadPeriodBookings(db, req.params.venueId, period);
      return reply.send({ period, ...buildOriginReport(bookings) });
    });

  /* Tendances — la période demandée comparée à la période précédente de même
     durée (ex. « ce mois-ci » vs « le mois dernier »). Aucune notion de
     tendance dans le core (pas une règle métier — une simple comparaison
     de deux appels aux mêmes fonctions canoniques) : décision API. */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/trends',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const period = parsePeriod(req.query.from, req.query.to);
      const prior = previousPeriod(period);

      const [bookings, priorBookings] = await Promise.all([
        loadPeriodBookings(db, req.params.venueId, period),
        loadPeriodBookings(db, req.params.venueId, prior),
      ]);
      const [occupancy, priorOccupancy] = await Promise.all([
        buildOccupancyReport(db, req.params.venueId, period, bookings),
        buildOccupancyReport(db, req.params.venueId, prior, priorBookings),
      ]);
      const revenue = buildRevenueReport(bookings);
      const priorRevenue = buildRevenueReport(priorBookings);
      const origin = buildOriginReport(bookings);
      const priorOrigin = buildOriginReport(priorBookings);

      return reply.send({
        period, priorPeriod: prior,
        revenue: {
          current: revenue.overall, previous: priorRevenue.overall,
          collectedChangePct: pctChange(revenue.overall.collected, priorRevenue.overall.collected),
        },
        occupancy: {
          current: occupancy.overall, previous: priorOccupancy.overall,
          changePct: pctChange(occupancy.overall, priorOccupancy.overall),
        },
        origin: { current: origin, previous: priorOrigin },
      });
    });

  /* Lot 4 — export Excel (15/09/2026). Preuve fiscale + sauvegarde manuelle
     à la demande — Manager+ (même permission que le reste d'Analytics).
     `parsePeriod` fait déjà respecter la borne de 12 mois (366 jours) avec
     un message clair — jamais une seconde validation qui pourrait diverger.
     Le nombre de lignes tracé dans `audit_log` est `rows.length`, LE MÊME
     tableau que celui écrit dans le classeur (`buildExportWorkbook(rows)`)
     — jamais un comptage séparé qui pourrait diverger de ce qui est
     réellement dans le fichier téléchargé. */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/export',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const period = parsePeriod(req.query.from, req.query.to);
      const bookings = await loadBookingsForExport(db, req.params.venueId, period);
      const rows = exportRowsFromBookings(bookings);
      const buffer = Buffer.from(await buildExportWorkbook(rows));
      const filename = exportFilename(period.fromDay, period.toDay);

      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'BOOKINGS_EXPORTED', objectType: 'venue', objectId: req.params.venueId,
        summary: `a exporté les réservations du ${period.fromDay} au ${period.toDay} (${rows.length} lignes)`,
      });

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    });
}
