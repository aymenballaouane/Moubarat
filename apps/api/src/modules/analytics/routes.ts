import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import {
  buildOccupancyReport, buildOriginReport, buildRevenueReport, loadPeriodBookings,
  parseExportPeriod, parsePeriod, previousPeriod, type Period,
} from './service.js';
import { algiersDateOf, dayStartMs, operatingPeriodWindow } from '../../lib/algiers.js';

const DAY_MS = 86_400_000;
import { sessionsAsBookings, sessionsForPeriod } from '../recurring-bookings/sessions.js';
import { PassThrough } from 'node:stream';
import { exportFilename, exportRows, writeExportWorkbook } from './export.js';

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
      /* P1-12 (15/11/2026) : les séances d'abonnés qui ont un prix entrent dans le chiffre (encaissé, engagé, no-shows), en
         source « comptoir » — jamais dans l'origine des réservations, et le remplissage les comptait déjà (occupancy). */
      const [bookings, sessions] = await Promise.all([
        loadPeriodBookings(db, req.params.venueId, period, req.query.fieldId),
        sessionsForPeriod(db, req.params.venueId, period.fromDay, period.toDay, req.query.fieldId),
      ]);
      return reply.send({ period, ...buildRevenueReport([...bookings, ...sessionsAsBookings(sessions)]) });
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
      // P1-12 : séances d'abonnés dans le chiffre, comme /analytics/revenue (jamais dans l'occupation : déjà comptées).
      const [sessions, priorSessions] = await Promise.all([
        sessionsForPeriod(db, req.params.venueId, period.fromDay, period.toDay),
        sessionsForPeriod(db, req.params.venueId, prior.fromDay, prior.toDay),
      ]);
      const revenue = buildRevenueReport([...bookings, ...sessionsAsBookings(sessions)]);
      const priorRevenue = buildRevenueReport([...priorBookings, ...sessionsAsBookings(priorSessions)]);
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

  /* MS-073 (audit final, Lot 2b, 18/11/2026) — l'écran Analytics faisait 21 appels à l'ouverture (aujourd'hui, 7 j, 7 j
     précédents, 30 j, 30 j précédents, occupation et origine sur 7 j, puis un CA par jour sur 14 j) : 21 fois la même lecture
     des réservations, qui occupaient la base une à deux secondes à l'échelle visée. Ici, UNE lecture des 60 jours (réservations
     et séances d'abonnés), puis chaque vue est calculée par les MÊMES fonctions que les routes unitaires, sur les réservations
     dont le début tombe dans ses jours d'exploitation (même fenêtre que `loadPeriodBookings`). Réponse : les mêmes objets que
     les routes unitaires. `today` : le jour d'exploitation de référence (celui de l'écran). */
  app.get<{ Params: { venueId: string }; Querystring: { today?: string } }>(
    '/venues/:venueId/analytics/overview',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      const today = parsePeriod(req.query.today, req.query.today).toDay;
      const shift = (d: number) => algiersDateOf(dayStartMs(today) + d * DAY_MS + 12 * 3_600_000);
      const span: Period = { fromDay: shift(-59), toDay: today };
      const [bookings, sessions] = await Promise.all([
        loadPeriodBookings(db, req.params.venueId, span),
        sessionsForPeriod(db, req.params.venueId, span.fromDay, span.toDay),
      ]);
      const withSessions = [...bookings, ...sessionsAsBookings(sessions)];
      const within = <T extends { range: { start: number } }>(rows: readonly T[], p: Period): T[] => {
        const win = operatingPeriodWindow(p.fromDay, p.toDay);
        return rows.filter((b) => b.range.start >= win.start && b.range.start < win.end);
      };
      const revenue = (p: Period) => ({ period: p, ...buildRevenueReport(within(withSessions, p)) });
      const curr7: Period = { fromDay: shift(-6), toDay: today };
      const occ7 = await buildOccupancyReport(db, req.params.venueId, curr7, within(bookings, curr7));
      const trendDays = Array.from({ length: 14 }, (_, i) => shift(i - 13));
      return reply.send({
        today: revenue({ fromDay: today, toDay: today }),
        curr7: revenue(curr7),
        prev7: revenue({ fromDay: shift(-13), toDay: shift(-7) }),
        curr30: revenue({ fromDay: shift(-29), toDay: today }),
        prev30: revenue({ fromDay: shift(-59), toDay: shift(-30) }),
        occ7: { period: curr7, ...occ7 },
        origin7: { period: curr7, ...buildOriginReport(within(bookings, curr7)) },
        trend: trendDays.map((d) => ({ date: d, collectedDa: buildRevenueReport(within(withSessions, { fromDay: d, toDay: d })).overall.collected })),
      });
    });

  /* Lot 4 — export Excel (15/09/2026). Preuve fiscale + sauvegarde manuelle
     à la demande — Manager+ (même permission que le reste d'Analytics).
     `parsePeriod` fait déjà respecter la borne de 12 mois (366 jours) avec
     un message clair — jamais une seconde validation qui pourrait diverger.
     Le nombre de lignes tracé dans `audit_log` est `rows.length`, LE MÊME
     tableau que celui écrit dans le classeur (`writeExportWorkbook(rows)`)
     — jamais un comptage séparé qui pourrait diverger de ce qui est
     réellement dans le fichier téléchargé. */
  app.get<{ Params: { venueId: string }; Querystring: Query }>(
    '/venues/:venueId/analytics/export',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'VIEW_ANALYTICS');
      // MS-030 (Lot 2a, 18/11/2026) : 3 mois au plus (`parseExportPeriod`), séances d'abonnés comprises, classeur écrit en flux.
      const period = parseExportPeriod(req.query.from, req.query.to);
      const rows = await exportRows(db, req.params.venueId, period);
      const filename = exportFilename(period.fromDay, period.toDay);

      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'BOOKINGS_EXPORTED', objectType: 'venue', objectId: req.params.venueId,
        summary: `a exporté les réservations du ${period.fromDay} au ${period.toDay} (${rows.length} lignes)`,
      });

      const body = new PassThrough();
      // Une erreur d'écriture au milieu du flux ne peut plus devenir une réponse 500 (l'en-tête est parti) : le flux est
      // détruit, le client reçoit un fichier tronqué, illisible par Excel — et l'erreur est journalisée.
      writeExportWorkbook(rows, body).catch((err: unknown) => { req.log.error({ err }, 'export_stream_failed'); body.destroy(err as Error); });
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(body);
    });
}
