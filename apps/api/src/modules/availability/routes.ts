import type { FastifyInstance } from 'fastify';
import { assertFieldBookable, fieldAvailability, perHour, quoteRange, type MatchFormat, type Quote, type Sport } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { algiersDateOf, dayStartMs, hhmm } from '../../lib/algiers.js';
import { ApiError, badRequest, must } from '../../lib/http.js';
import { closureRangesFor, dayContextFor, loadDayContext, loadFieldContextsBatch, type DayContext } from '../bookings/service.js';

interface Deps { db: Db; guards: PlatformGuards; summaryCacheMs?: number }

const DAY_MS = 24 * 60 * 60 * 1000;
/** Résumé « aujourd'hui » de l'Explorer (A8) : durée type d'une réservation, et début de « la soirée ». */
const SUMMARY_DURATION_MIN = 90;
const EVENING_FROM_MIN = 18 * 60;
/** Fenêtre de recherche « Prochaine dispo » (Lot 3, 15/09/2026) — même
    horizon que le prototype (`nextAvailability`, d..d+7). */
const SEARCH_DAYS = 8;

export interface DayStart {
  startMin: number;
  range: { start: number; end: number };
  /** 16/09/2026 (demande d'Aymen) : un devis PAR FORMAT configuré sur ce
      terrain, jamais une recommandation — à l'appelant de présenter les
      options côte à côte. */
  byFormat: Array<{ format: MatchFormat; quote: Quote }>;
}

/* Un seul calcul de départs disponibles pour un terrain/jour — utilisé par
   les DEUX routes ci-dessous (disponibilité par terrain, « prochaine dispo »
   multi-jours/multi-terrains), jamais une copie de fieldAvailability/
   loadDayContext/closureRangesFor (fermetures, abonnements, réservations
   bloquantes : la même fonction charge tout, pour les deux). Signalé par
   Aymen (15/09/2026) : ne pas dupliquer, même à deux endroits d'appel.
   16/09/2026 : les POSITIONS de départ ne dépendent pas du format (seuls
   horaires/blocages/durée en décident) — un seul appel à fieldAvailability
   (avec un format arbitraire, le premier configuré) calcule les créneaux
   ouverts ; le devis de CHAQUE format est ensuite calculé directement via
   quoteRange, sans rebalayer les blocages une fois par format. */
interface DayStartsOpts {
  durationMin: number; stepMin?: number; now: number;
  /** Décision Aymen (04/09/2026, core booking-flow.ts) : une source centre
      (WALK_IN, ou PHONE créé depuis le CRM) peut enregistrer un créneau EN
      COURS, tant qu'il n'est pas terminé — la même distinction que
      `prepareBooking` fait déjà à l'écriture. Sans ce paramètre, cette route
      (lecture) cachait un créneau que l'écriture accepterait pourtant pour
      le staff : le devis en direct du Planning CRM semblait « indisponible »
      pour un client au téléphone MAINTENANT, alors que la création aurait
      réussi. Faux par défaut (comportement historique, app joueur). */
  includeInProgress?: boolean;
}

/** Calcul PUR (aucun accès base) à partir d'un `DayContext` déjà chargé — extrait de
    `computeDayStarts` (A6, cadrage multi-centre/scalabilité 22/09/2026) pour être réutilisable
    avec un contexte issu du chargeur en lot (`loadFieldContextsBatch`/`dayContextFor`), sans
    jamais dupliquer la logique de calcul elle-même. */
function startsFromContext(ctx: DayContext, opts: DayStartsOpts): DayStart[] {
  must(assertFieldBookable(ctx.field.status));
  if (ctx.field.formatPrices.length === 0) return [];
  const blockers = [...ctx.existing.map((b) => b.range), ...closureRangesFor(ctx)];
  const positions = fieldAvailability({
    field: { id: ctx.field.id, hourlyRate: perHour(ctx.field.formatPrices[0]!.hourlyRateDa) },
    hours: ctx.hours,
    rules: ctx.rules,
    weekday: ctx.weekday,
    dayStartMs: ctx.dayStartMs,
    durationMin: opts.durationMin,
    format: ctx.field.formatPrices[0]!.format,
    ...(opts.stepMin !== undefined ? { stepMin: opts.stepMin } : {}),
    blockers,
    recurring: ctx.recurring,
  }).filter((s) => (opts.includeInProgress ? s.range.end > opts.now : s.range.start > opts.now));
  return positions.map((s) => ({
    startMin: s.startMin,
    range: s.range,
    byFormat: ctx.field.formatPrices.map((fp) => ({
      format: fp.format,
      quote: quoteRange(ctx.rules, perHour(fp.hourlyRateDa), ctx.weekday, s.startMin, s.startMin + opts.durationMin, fp.format),
    })),
  }));
}

/* Un seul calcul de départs disponibles pour un terrain/jour — utilisé par
   les DEUX routes ci-dessous (disponibilité par terrain, « prochaine dispo »
   multi-jours/multi-terrains), jamais une copie de fieldAvailability/
   loadDayContext/closureRangesFor (fermetures, abonnements, réservations
   bloquantes : la même fonction charge tout, pour les deux). Signalé par
   Aymen (15/09/2026) : ne pas dupliquer, même à deux endroits d'appel.
   16/09/2026 : les POSITIONS de départ ne dépendent pas du format (seuls
   horaires/blocages/durée en décident) — un seul appel à fieldAvailability
   (avec un format arbitraire, le premier configuré) calcule les créneaux
   ouverts ; le devis de CHAQUE format est ensuite calculé directement via
   quoteRange, sans rebalayer les blocages une fois par format. */
async function computeDayStarts(db: Db, fieldId: string, dayStart: number, opts: DayStartsOpts): Promise<{ ctx: DayContext; starts: DayStart[] }> {
  const ctx = await loadDayContext(db, fieldId, dayStart);
  return { ctx, starts: startsFromContext(ctx, opts) };
}

interface VenueAvailabilitySummary {
  venueId: string;
  /** Départs encore libres aujourd'hui (90 min), tous terrains confondus — un départ compte une fois même
      si plusieurs terrains sont libres à cette heure. */
  freeStarts: number;
  nextStartMin: number | null;
  /** Parmi eux, ceux à partir de 18h. */
  eveningStarts: number;
}

export async function registerAvailabilityRoutes(app: FastifyInstance, { db, guards, summaryCacheMs = 0 }: Deps): Promise<void> {

  /* A8 (cadrage multi-centre/scalabilité, 24/09/2026) — résumé de disponibilité d'AUJOURD'HUI pour TOUS les
     centres actifs, pour les cartes de l'Explorer (« 4 créneaux libres aujourd'hui, prochain à 19h »).
     C'est le « résumé par centre » explicitement différé en A6 faute de consommateur : UN chargement en lot
     (loadFieldContextsBatch, 7 requêtes fixes quel que soit le nombre de centres), puis le moteur core en
     mémoire terrain par terrain — jamais une requête par centre. Route publique (comme GET /venues) ; un
     cache court par processus (env.availabilitySummaryCacheMs) évite de recalculer à chaque ouverture de
     l'écran. Ne dit rien de plus que ce que GET /fields/:id/availability dirait déjà à n'importe qui. */
  let summaryCache: { at: number; body: { date: string; durationMin: number; venues: VenueAvailabilitySummary[] } } | null = null;
  app.get('/venues/availability-summary', async (_req, reply) => {
    const now = Date.now();
    if (summaryCacheMs > 0 && summaryCache && now - summaryCache.at < summaryCacheMs) return reply.send(summaryCache.body);

    const date = algiersDateOf(now);
    const dayStart = dayStartMs(date);
    const venues = await db.selectFrom('venues').select('id').where('status', '=', 'ACTIVE').execute();
    const fields = venues.length === 0 ? [] : await db.selectFrom('fields').select(['id', 'venue_id'])
      .where('venue_id', 'in', venues.map((v) => v.id))
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '=', 'ACTIVE')]))
      .execute();
    // Fenêtre de deux jours, comme loadDayContext : les réservations/fermetures d'après minuit d'une
    // ouverture qui court jusqu'à 01:00 doivent bloquer les derniers départs d'aujourd'hui.
    const batch = await loadFieldContextsBatch(db, fields.map((f) => f.id), dayStart, dayStart + 2 * DAY_MS);

    const startsByVenue = new Map<string, Set<number>>(venues.map((v) => [v.id, new Set<number>()]));
    for (const f of fields) {
      const batchCtx = batch.get(f.id);
      if (!batchCtx) continue;
      const set = startsByVenue.get(f.venue_id)!;
      for (const s of startsFromContext(dayContextFor(batchCtx, dayStart), { durationMin: SUMMARY_DURATION_MIN, now })) set.add(s.startMin);
    }

    const body = {
      date, durationMin: SUMMARY_DURATION_MIN,
      venues: venues.map((v): VenueAvailabilitySummary => {
        const starts = [...startsByVenue.get(v.id)!].sort((a, b) => a - b);
        return {
          venueId: v.id, freeStarts: starts.length, nextStartMin: starts[0] ?? null,
          eveningStarts: starts.filter((m) => m >= EVENING_FROM_MIN).length,
        };
      }),
    };
    if (summaryCacheMs > 0) summaryCache = { at: now, body };
    return reply.send(body);
  });

  /* Le moteur de disponibilité core, exposé tel quel : mêmes départs, mêmes devis
     pour l'app joueur et le CRM (« la même fonction sert l'app et le CRM »).
     Route publique (app joueur ET CRM — le Planning s'en sert aussi pour son
     devis en direct, Lot 3). `includeInProgress=1` : réservé en pratique au
     CRM (staff), voir computeDayStarts — un simple indicateur de présentation,
     jamais un contrôle de sécurité : l'écriture (prepareBooking, core) reste
     seule autorité sur ce qui est réellement réservable. */
  app.get<{
    Params: { fieldId: string };
    Querystring: { date?: string; duration?: string; step?: string; includeInProgress?: string };
  }>('/fields/:fieldId/availability', { preHandler: (req) => guards.tryPlatformAuth(req) }, async (req, reply) => {
    const date = req.query.date ?? '';
    const durationMin = Number(req.query.duration ?? 90);
    if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 360) {
      throw badRequest('Durée invalide : entre 30 et 360 minutes.', 'HOURS_INVALID');
    }
    const stepMin = Number(req.query.step ?? 30);
    if (!Number.isInteger(stepMin) || stepMin < 5 || stepMin > 60) {
      throw badRequest('Pas invalide : entre 5 et 60 minutes.', 'HOURS_INVALID');
    }
    let dayStart: number;
    try { dayStart = dayStartMs(date); }
    catch { throw badRequest('Paramètre date attendu au format YYYY-MM-DD.'); }

    // includeInProgress n'est JAMAIS honoré sans une session PLATEFORME
    // valide (tryPlatformAuth ci-dessus, best-effort) — ni pour un joueur
    // authentifié, ni pour un appel anonyme, quel que soit ce que demande
    // l'URL (signalé par Aymen, 15/09/2026 : « refusé pour une session
    // joueur »). Ce n'est qu'un indicateur de PRÉSENTATION (voir
    // computeDayStarts) — l'écriture (prepareBooking, core) reste seule
    // autorité réelle sur ce qui se réserve, mais la lecture ne doit pas
    // non plus laisser croire à un joueur qu'un créneau déjà entamé est
    // encore ouvert.
    const includeInProgress = req.query.includeInProgress === '1' && Boolean(req.platformAuth);
    const { ctx, starts } = await computeDayStarts(db, req.params.fieldId, dayStart, {
      durationMin, stepMin, now: Date.now(), includeInProgress,
    });
    // Audit 07-09/09/2026 (I1) : route publique, consommée par l'application
    // joueur — un centre non ACTIVE n'expose plus ses créneaux, même à qui
    // connaît déjà l'identifiant du terrain (même règle que la vente publique
    // dans createBooking ; le CRM ne passe pas par ici pour ÉCRIRE, mais lit
    // bien cette route pour son devis en direct — includeInProgress ne
    // change rien à CETTE garde, un centre suspendu reste indisponible
    // même au staff via cette route de lecture publique).
    if (ctx.venue.status !== 'ACTIVE') {
      throw new ApiError(409, 'INVALID_TARGET', 'Ce centre est actuellement indisponible.');
    }

    return reply.send({
      date,
      weekday: ctx.weekday,
      durationMin,
      stepMin,
      field: {
        id: ctx.field.id, name: ctx.field.name, sport: ctx.field.sport,
        hourlyRateDa: ctx.field.hourlyRateDa,
        formats: ctx.field.formatPrices.map((fp) => ({ format: fp.format, hourlyRateDa: fp.hourlyRateDa })),
      },
      venue: { id: ctx.venue.id, name: ctx.venue.name },
      starts: starts.map((s) => ({
        startMin: s.startMin,
        label: hhmm(s.startMin),
        start: s.range.start,
        end: s.range.end,
        byFormat: s.byFormat.map((f) => ({
          format: f.format,
          totalDa: f.quote.total.amount,
          bands: f.quote.bands.map((b) => ({
            fromMin: b.fromMin, toMin: b.toMin, rateDaPerHour: b.rate.amount, amountDa: b.amount,
          })),
        })),
      })),
    });
  });

  /* Lot 3 (15/09/2026, demande d'Aymen) : « Prochaine dispo » du Planning
     CRM cherche sur PLUSIEURS jours et PLUSIEURS terrains — la route
     ci-dessus ne fait ni l'un ni l'autre (un terrain, un jour). Aucune route
     existante ne couvrait ce besoin ; celle-ci réutilise computeDayStarts,
     jamais une règle de prix ou de disponibilité recodée côté client ou
     dupliquée ici. Lecture seule : VIEW_PLANNING (les 4 rôles, comme
     consulter le planning) — seule la création qui s'ensuit exige
     CREATE_BOOKING. Toujours includeInProgress: un membre du staff qui
     cherche « le prochain créneau » pour un client au téléphone doit voir
     un départ dans les toutes prochaines minutes, pas seulement demain. */
  app.get<{
    Params: { venueId: string };
    Querystring: { sport?: string; duration?: string; from?: string };
  }>('/venues/:venueId/next-availability', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    await guards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
    const sport = String(req.query.sport ?? '');
    if (!['FOOTBALL', 'PADEL', 'BASKET'].includes(sport)) {
      throw badRequest('Sport invalide : FOOTBALL, PADEL ou BASKET.');
    }
    const durationMin = Number(req.query.duration ?? 90);
    if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 360) {
      throw badRequest('Durée invalide : entre 30 et 360 minutes.', 'HOURS_INVALID');
    }
    let fromDayStart: number;
    try { fromDayStart = dayStartMs(req.query.from ?? algiersDateOf(Date.now())); }
    catch { throw badRequest('Paramètre from attendu au format YYYY-MM-DD.'); }

    const venue = await db.selectFrom('venues').select('status').where('id', '=', req.params.venueId).executeTakeFirst();
    // Décision I5 (08/09/2026), étendue ici : le comptoir n'obéit pas au
    // statut public du centre — même raisonnement que createBooking pour
    // WALK_IN/PHONE créé par le staff, cette recherche reste utilisable.
    // Un centre introuvable, en revanche, n'a évidemment aucun créneau.
    if (!venue) return reply.send({ found: false as const });

    const fields = await db.selectFrom('fields').select(['id', 'name'])
      .where('venue_id', '=', req.params.venueId).where('sport', '=', sport as Sport)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '=', 'ACTIVE')]))
      .orderBy('name', 'asc').execute();
    if (fields.length === 0) {
      return reply.send({ found: false as const });
    }

    // A6 (cadrage multi-centre/scalabilité, 22/09/2026, F4) : avant, computeDayStarts rechargeait
    // TOUT (7 requêtes) pour chaque terrain, pour chaque jour — jusqu'à 56×N requêtes séquentielles
    // pour cette recherche seule. UN chargement en lot couvrant les N terrains ET les SEARCH_DAYS
    // jours d'un coup (7 requêtes fixes), puis un calcul en mémoire par jour/terrain — même moteur
    // core (fieldAvailability/quoteRange), aucune règle changée, juste chargée différemment.
    const now = Date.now();
    const windowEnd = fromDayStart + SEARCH_DAYS * DAY_MS;
    const batch = await loadFieldContextsBatch(db, fields.map((f) => f.id), fromDayStart, windowEnd);

    for (let d = 0; d < SEARCH_DAYS; d++) {
      const dayStart = fromDayStart + d * DAY_MS;
      const date = algiersDateOf(dayStart);
      let best: { fieldId: string; fieldName: string; start: DayStart } | null = null;
      for (const f of fields) {
        const batchCtx = batch.get(f.id);
        if (!batchCtx) continue;
        const starts = startsFromContext(dayContextFor(batchCtx, dayStart), { durationMin, now, includeInProgress: true });
        const first = starts[0];
        if (first && (!best || first.range.start < best.start.range.start)) {
          best = { fieldId: f.id, fieldName: f.name, start: first };
        }
      }
      if (best) {
        // « Prochaine dispo » reste un aperçu rapide, pas une comparaison de
        // formats (celle-ci se fait dans Planning via l'availability
        // détaillée) — on retient le moins cher, en l'annonçant explicitement
        // (jamais un totalDa présenté sans dire à quel format il correspond).
        const cheapest = best.start.byFormat.reduce((a, b) => (b.quote.total.amount < a.quote.total.amount ? b : a));
        return reply.send({
          found: true as const,
          date,
          fieldId: best.fieldId,
          fieldName: best.fieldName,
          startMin: best.start.startMin,
          label: hhmm(best.start.startMin),
          start: best.start.range.start,
          end: best.start.range.end,
          format: cheapest.format,
          totalDa: cheapest.quote.total.amount,
          bands: cheapest.quote.bands.map((b) => ({
            fromMin: b.fromMin, toMin: b.toMin, rateDaPerHour: b.rate.amount, amountDa: b.amount,
          })),
        });
      }
    }
    return reply.send({ found: false as const });
  });
}
