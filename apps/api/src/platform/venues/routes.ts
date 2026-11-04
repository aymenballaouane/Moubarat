import { sql, type Selectable } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { venueStatusTransition, deriveBookingPrefixCandidates, type VenueStatus } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { VenuesTable } from '../../db/types.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { parseVenuePhone } from '../../lib/validate.js';
import { VENUE_RATING_MIN_COUNT, ratingSummaryFor } from '../../modules/results/service.js';
import { lastReadySignalAt, loadVenueReadiness, notReadyMessage } from '../../modules/venues/readiness.js';

interface Deps { db: Db; guards: PlatformGuards; }

const VENUE_STATUSES: readonly VenueStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];
const SUBSCRIPTION_PLANS = ['CRM_ONLY', 'CRM_PLUS_APP'] as const;
const SUBSCRIPTION_STATUSES = ['PAID', 'UNPAID'] as const;
type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Libellés du résumé de journal (lu par le gérant dans le Journal de son centre). */
const FIELD_LABELS: Record<string, string> = {
  name: 'nom', wilaya: 'wilaya', address: 'adresse', lat: 'position', lng: 'position', phone: 'téléphone', description: 'description',
};

function publicVenueSummary(v: {
  id: string; name: string; wilaya: string; address: string; status: string;
  created_at: Date; field_count: number | string | bigint; subscription_status: string;
}) {
  return {
    id: v.id, name: v.name, wilaya: v.wilaya, address: v.address,
    status: v.status, createdAt: v.created_at, fieldCount: Number(v.field_count),
    // C1/CE11 (22/09/2026) : « vous ne savez pas qui est à jour » — visible dès la liste,
    // pas seulement sur la fiche, sinon ça ne répond pas au vrai besoin.
    subscriptionStatus: v.subscription_status,
  };
}

/** Transition générique PENDING/ACTIVE/REJECTED/SUSPENDED — la même mécanique
    pour les 4 actions ci-dessous, seul le couple (from validé implicitement
    par le core)/action/label change. Le serveur est l'autorité : la
    transition est réévaluée ici, jamais supposée correcte parce que le
    bouton existe côté interface. */
async function applyVenueTransition(
  db: Db, guards: PlatformGuards, req: Parameters<PlatformGuards['requireSuperadmin']>[0],
  venueId: string, next: VenueStatus, action: 'CENTER_APPROVED' | 'CENTER_REJECTED' | 'CENTER_SUSPENDED' | 'CENTER_REACTIVATED',
  verb: string,
): Promise<{ id: string; status: VenueStatus }> {
  const venue = await db.selectFrom('venues').select(['id', 'status']).where('id', '=', venueId).executeTakeFirst();
  if (!venue) throw notFound('Centre introuvable.');
  must(venueStatusTransition(venue.status as VenueStatus, next));

  /* A9 (24/09/2026, cadrage §1.7) : un centre ne devient ACTIF (visible dans l'app joueur) que s'il a de quoi
     proposer — un terrain actif tarifé et des horaires. Vaut pour la validation ET la réactivation (un centre
     suspendu a pu être vidé entre-temps). Le serveur est l'autorité : le bouton désactivé de la console n'est
     qu'un confort. Les points sont détaillés dans `details.checks`. */
  if (next === 'ACTIVE') {
    const readiness = (await loadVenueReadiness(db, [venueId], { advisory: false })).get(venueId)!;
    if (!readiness.ready) {
      throw new ApiError(409, 'VENUE_NOT_READY', notReadyMessage(readiness), { checks: readiness.checks });
    }
  }

  const row = await db.updateTable('venues').set({ status: next })
    .where('id', '=', venueId).returning(['id', 'status']).executeTakeFirstOrThrow();
  await writeAudit(db, {
    actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
    action, objectType: 'venue', objectId: venueId,
    summary: `${verb} le centre`, before: venue.status, after: next,
  });
  return { id: row.id, status: row.status as VenueStatus };
}

export async function registerPlatformVenueRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* Liste — tous statuts, contrairement à GET /venues (Player), qui ne montre que ACTIVE. */
  app.get('/platform/venues', { preHandler: (req) => guards.requireSuperadmin(req) }, async (_req, reply) => {
    const rows = await db.selectFrom('venues')
      .leftJoin('fields', 'fields.venue_id', 'venues.id')
      .select([
        'venues.id', 'venues.name', 'venues.wilaya', 'venues.address',
        'venues.status', 'venues.created_at', 'venues.subscription_status',
        (eb) => eb.fn.count('fields.id').as('field_count'),
      ])
      .groupBy(['venues.id'])
      .orderBy('venues.created_at', 'desc')
      .execute();
    // A9 : « prêt à publier » visible dès la liste (points bloquants seulement — le détail est sur la fiche).
    // ONB-2 : et « signalé prêt par le centre le … » (dernier signal du gérant), pour repérer qui attend une validation.
    const [readiness, signaled] = await Promise.all([
      loadVenueReadiness(db, rows.map((r) => r.id), { advisory: false }),
      lastReadySignalAt(db, rows.map((r) => r.id)),
    ]);
    return reply.send({
      venues: rows.map((r) => {
        const rd = readiness.get(r.id)!;
        return {
          ...publicVenueSummary(r),
          readiness: { ready: rd.ready, missingCount: rd.checks.filter((c) => c.blocking && !c.ok).length },
          readySignaledAt: signaled.get(r.id) ?? null,
        };
      }),
    });
  });

  /* Détail — même contenu que GET /venues/:id (fiche complète), plus le
     statut plateforme et un résumé d'activité (réservations, matchs). */
  app.get<{ Params: { venueId: string } }>('/platform/venues/:venueId',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const v = await db.selectFrom('venues').selectAll().where('id', '=', req.params.venueId).executeTakeFirst();
    if (!v) throw notFound('Centre introuvable.');
    const [fields, hours, rating, bookingCount, matchCount, staffCount, formatPrices, readiness] = await Promise.all([
      db.selectFrom('fields').selectAll().where('venue_id', '=', v.id).orderBy('name').execute(),
      db.selectFrom('opening_hours').selectAll().where('venue_id', '=', v.id).orderBy('weekday').execute(),
      ratingSummaryFor(db, 'VENUE', v.id),
      db.selectFrom('bookings').innerJoin('fields', 'fields.id', 'bookings.field_id')
        .where('fields.venue_id', '=', v.id).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      db.selectFrom('matches').where('venue_id', '=', v.id).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      db.selectFrom('center_staff').where('venue_id', '=', v.id).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      // Tarifs PAR FORMAT (16/09/2026) : `hourly_rate_da` du terrain n'est plus édité, il
      // ne reflète plus le tarif réel — jamais l'afficher comme tel.
      db.selectFrom('field_format_prices').innerJoin('fields', 'fields.id', 'field_format_prices.field_id')
        .where('fields.venue_id', '=', v.id)
        .select(['field_format_prices.field_id', 'field_format_prices.format', 'field_format_prices.hourly_rate_da'])
        .orderBy('field_format_prices.format').execute(),
      // A9 : la fiche « prêt à publier » — points bloquants ET recommandés.
      loadVenueReadiness(db, [v.id], { advisory: true }),
    ]);
    const readySignaledAt = (await lastReadySignalAt(db, [v.id])).get(v.id) ?? null;
    return reply.send({
      venue: {
        readiness: readiness.get(v.id)!,
        readySignaledAt,
        id: v.id, name: v.name, wilaya: v.wilaya, address: v.address,
        lat: v.lat, lng: v.lng, phone: v.phone, description: v.description,
        equipments: v.equipments, photos: v.photos, status: v.status, createdAt: v.created_at,
        bookingPrefix: v.booking_prefix,
        subscriptionPlan: v.subscription_plan, subscriptionStatus: v.subscription_status,
        subscriptionDueAt: v.subscription_due_at,
        fields: fields.map((f) => ({
          id: f.id, name: f.name, sport: f.sport, formats: f.formats,
          formatPrices: formatPrices.filter((p) => p.field_id === f.id).map((p) => ({ format: p.format, hourlyRateDa: p.hourly_rate_da })),
          surface: f.surface, sizeLabel: f.size_label,
          indoor: f.indoor, status: f.status ?? 'ACTIVE',
        })),
        openingHours: hours.map((h) => ({ weekday: h.weekday, startMin: h.start_min, endMin: h.end_min })),
        rating: { ...rating, minCount: VENUE_RATING_MIN_COUNT },
        activity: {
          bookingCount: Number(bookingCount?.n ?? 0),
          matchCount: Number(matchCount?.n ?? 0),
          staffCount: Number(staffCount?.n ?? 0),
        },
      },
    });
  });

  /* Création — statut toujours PENDING, jamais activé à la création. Pas d'attribution de propriétaire ici :
     `center_staff.user_id` référence `platform_accounts` depuis la migration 0009. Le compte du gérant se
     crée ensuite via `POST /platform/venues/:venueId/staff` (`platform/staff/routes.ts`, chantier du
     20/09/2026, commit 94860a8), qui insère dans `center_staff` — corrigé le 22/09/2026 (audit produit
     CR18) : ce commentaire affirmait encore « aucune route n'insère dans center_staff, seul le CLI le fait »,
     ce qui n'était déjà plus vrai. */
  app.post<{
    Body: {
      name?: string; wilaya?: string; address?: string; lat?: number; lng?: number; phone?: string;
      description?: string; requestId?: string; bookingPrefix?: string;
    };
  }>('/platform/venues', { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    const wilaya = String(b.wilaya ?? '').trim();
    const address = String(b.address ?? '').trim();
    if (!name || !wilaya || !address) throw badRequest('name, wilaya et address sont requis.');
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest('lat/lng invalides.');
    const phone = parseVenuePhone(b.phone);

    /* Préfixe des références de réservation (22/09/2026, audit multi-centre, décision Aymen) : un code
       FIXE, attribué ici une fois pour toutes (`venues.booking_prefix`), jamais retouché ensuite — voir
       core `bookingReference`. Explicite (`bookingPrefix`, 3 lettres majuscules) si le superadmin le fournit
       — c'est le seul moyen de « choisir » le préfixe en cas de collision, aucune route ne le modifie après
       coup. Sinon, dérivé du nom (`deriveBookingPrefixCandidates`) : le premier candidat non pris l'emporte.
       Si le nom n'offre AUCUN candidat libre (jamais vu en pratique — il faudrait épuiser toutes les
       fenêtres de 3 lettres du nom), 409 explicite : le formulaire redemande un code au superadmin plutôt
       que d'improviser une valeur qui ne représenterait plus le centre. */
    let explicitPrefix: string | null = null;
    if (b.bookingPrefix !== undefined) {
      explicitPrefix = String(b.bookingPrefix).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(explicitPrefix)) throw badRequest('bookingPrefix : exactement 3 lettres (A-Z).');
    }
    const prefixCandidates = explicitPrefix ? [explicitPrefix] : deriveBookingPrefixCandidates(name);

    /* Conversion d'une demande d'inscription (20/09/2026) : `requestId` lie la demande au centre et
       la passe en CONVERTED dans la MÊME transaction que la création — toute création de centre
       (manuelle ou issue d'une demande) suit ensuite le même flux de validation. */
    const requestId = b.requestId ? String(b.requestId) : null;
    if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw notFound('Demande introuvable.');
    const accountId = req.platformAuth!.accountId;
    const { row, fromRequest } = await db.transaction().execute(async (trx) => {
      let requestContact: string | null = null;
      if (requestId) {
        const request = await trx.selectFrom('venue_requests').select(['id', 'status', 'contact_name']).where('id', '=', requestId).forUpdate().executeTakeFirst();
        if (!request) throw notFound('Demande introuvable.');
        if (request.status !== 'NEW') throw new ApiError(409, 'REQUEST_ALREADY_HANDLED', 'Cette demande a déjà été traitée.');
        requestContact = request.contact_name;
      }

      // Même patron défensif que la séquence de référence (SAVEPOINT + réessai) : la disponibilité d'un
      // préfixe est revérifiée par la contrainte UNIQUE elle-même, jamais supposée depuis une lecture
      // antérieure (une création concurrente d'un autre centre au même nom reste correcte).
      let created: Selectable<VenuesTable> | undefined;
      let bookingPrefix: string | null = null;
      for (const candidate of prefixCandidates) {
        await sql`SAVEPOINT venue_prefix`.execute(trx);
        try {
          created = await trx.insertInto('venues').values({
            name, wilaya, address, lat, lng, phone, booking_prefix: candidate,
            description: b.description ? String(b.description).trim() : null,
            status: 'PENDING',
          }).returningAll().executeTakeFirstOrThrow();
          bookingPrefix = candidate;
          break;
        } catch (err) {
          const e = err as { code?: string; constraint?: string };
          if (e.code === '23505' && (e.constraint ?? '').includes('booking_prefix')) {
            await sql`ROLLBACK TO SAVEPOINT venue_prefix`.execute(trx);
            continue;
          }
          throw err;
        }
      }
      if (bookingPrefix === null) {
        throw new ApiError(409, 'BOOKING_PREFIX_TAKEN',
          explicitPrefix
            ? `Le préfixe « ${explicitPrefix} » est déjà pris par un autre centre.`
            : `Aucun préfixe disponible n'a pu être dérivé du nom « ${name} » — indique bookingPrefix explicitement (3 lettres).`);
      }
      // `created` est garanti défini ici : la garde ci-dessus jette dès que `bookingPrefix` (posé dans la
      // même branche que `created`) est resté `null`.
      if (requestId) {
        await trx.updateTable('venue_requests').set({ status: 'CONVERTED', venue_id: created!.id, decided_at: new Date(), decided_by: accountId }).where('id', '=', requestId).execute();
      }
      return { row: created!, fromRequest: requestContact };
    });
    await writeAudit(db, {
      actorId: accountId, actorRole: 'SUPERADMIN',
      action: 'CENTER_CREATED', objectType: 'venue', objectId: row.id,
      summary: `a créé le centre ${row.name} (en attente de validation)` + (fromRequest ? ` — depuis la demande d'inscription de ${fromRequest}` : ''),
    });
    return reply.code(201).send({
      venue: { id: row.id, name: row.name, wilaya: row.wilaya, address: row.address, status: row.status, bookingPrefix: row.booking_prefix },
    });
  });

  /* Fiche d'identité d'un centre (22/09/2026, audit produit CE1/CE2) : nom, wilaya, adresse, position,
     téléphone, description. Le gérant, lui, ne modifie que adresse/description/équipements/téléphone/
     caisse (PATCH /venues/:venueId, EDIT_PROFILE) — le NOM, la WILAYA et la POSITION restent au
     superadmin : une faute de frappe à la création ne se corrigeait nulle part avant cette route.
     Journalisé AVEC `venueId` : l'entrée apparaît dans le Journal du centre (voir modules/audit).
     Seuls les champs réellement modifiés sont écrits, comparés et journalisés. */
  app.patch<{
    Params: { venueId: string };
    Body: { name?: unknown; wilaya?: unknown; address?: unknown; lat?: unknown; lng?: unknown; phone?: unknown; description?: unknown };
  }>('/platform/venues/:venueId', { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const requested: { name?: string; wilaya?: string; address?: string; lat?: number; lng?: number; phone?: string | null; description?: string | null } = {};

    const required: Array<['name' | 'wilaya' | 'address', string]> = [
      ['name', 'Le nom'], ['wilaya', 'La wilaya'], ['address', 'L’adresse'],
    ];
    for (const [key, label] of required) {
      if (b[key] === undefined) continue;
      const value = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
      if (!value) throw badRequest(`${label} ne peut pas être vide.`);
      requested[key] = value;
    }
    if (b.lat !== undefined || b.lng !== undefined) {
      if (typeof b.lat !== 'number' || typeof b.lng !== 'number' || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
        throw badRequest('La latitude et la longitude se modifient ensemble, en nombres.');
      }
      if (b.lat < -90 || b.lat > 90 || b.lng < -180 || b.lng > 180) throw badRequest('Position hors limites (latitude −90 à 90, longitude −180 à 180).');
      requested.lat = b.lat; requested.lng = b.lng;
    }
    if (b.phone !== undefined) requested.phone = parseVenuePhone(b.phone);
    if (b.description !== undefined) requested.description = (typeof b.description === 'string' ? b.description.trim() : '') || null;
    if (Object.keys(requested).length === 0) throw badRequest('Aucun champ à modifier.');

    const before = await db.selectFrom('venues').selectAll().where('id', '=', req.params.venueId).executeTakeFirst();
    if (!before) throw notFound('Centre introuvable.');

    const current: Record<string, unknown> = {
      name: before.name, wilaya: before.wilaya, address: before.address, lat: before.lat, lng: before.lng,
      phone: before.phone, description: before.description,
    };
    const changed = (Object.keys(requested) as Array<keyof typeof requested>).filter((k) => requested[k] !== current[k]);
    if (changed.length === 0) {
      return reply.send({ venue: { id: before.id, name: before.name, wilaya: before.wilaya, address: before.address, lat: before.lat, lng: before.lng, phone: before.phone, description: before.description, status: before.status }, changed: [] });
    }
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = requested[k];

    const row = await db.updateTable('venues').set(patch).where('id', '=', req.params.venueId).returningAll().executeTakeFirstOrThrow();
    const after: Record<string, unknown> = {
      name: row.name, wilaya: row.wilaya, address: row.address, lat: row.lat, lng: row.lng, phone: row.phone, description: row.description,
    };
    const pick = (src: Record<string, unknown>) => JSON.stringify(Object.fromEntries(changed.map((k) => [k, src[k]])));
    await writeAudit(db, {
      venueId: row.id, actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
      action: 'CENTER_UPDATED', objectType: 'venue', objectId: row.id,
      summary: `a modifié la fiche du centre (${[...new Set(changed.map((k) => FIELD_LABELS[k]))].join(', ')})`,
      before: pick(current), after: pick(after),
    });
    return reply.send({
      venue: { id: row.id, name: row.name, wilaya: row.wilaya, address: row.address, lat: row.lat, lng: row.lng, phone: row.phone, description: row.description, status: row.status },
      changed,
    });
  });

  /* Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit, item 6 de la feuille de route
     post-audit) : plan, échéance, statut payé/impayé — saisis par le superadmin UNIQUEMENT, jamais
     depuis le CRM (endpoint séparé de la fiche d'identité ci-dessus, portée différente). Aucune
     coupure d'accès CRM ici — voir docs/DECISIONS.md, "Futur chantier volontairement non construit" :
     la question reste ouverte, tranchée avec un avocat/comptable, pas devinée ici. Sert uniquement le
     bandeau d'avertissement du CRM (apps/crm, SubscriptionBanner.tsx) et la colonne de la liste des
     centres côté console. */
  app.patch<{
    Params: { venueId: string };
    Body: { plan?: unknown; status?: unknown; dueAt?: unknown };
  }>('/platform/venues/:venueId/subscription', { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const b = req.body ?? {};
    const requested: { subscription_plan?: SubscriptionPlan; subscription_status?: SubscriptionStatus; subscription_due_at?: Date | null } = {};

    if (b.plan !== undefined) {
      if (!SUBSCRIPTION_PLANS.includes(b.plan as SubscriptionPlan)) throw badRequest(`plan invalide : ${SUBSCRIPTION_PLANS.join(', ')}.`);
      requested.subscription_plan = b.plan as SubscriptionPlan;
    }
    if (b.status !== undefined) {
      if (!SUBSCRIPTION_STATUSES.includes(b.status as SubscriptionStatus)) throw badRequest(`status invalide : ${SUBSCRIPTION_STATUSES.join(', ')}.`);
      requested.subscription_status = b.status as SubscriptionStatus;
    }
    if (b.dueAt !== undefined) {
      if (b.dueAt === null) {
        requested.subscription_due_at = null;
      } else {
        const parsed = new Date(String(b.dueAt));
        if (Number.isNaN(parsed.getTime())) throw badRequest('dueAt : date invalide.');
        requested.subscription_due_at = parsed;
      }
    }
    if (Object.keys(requested).length === 0) throw badRequest('Aucun champ à modifier.');

    const before = await db.selectFrom('venues')
      .select(['id', 'subscription_plan', 'subscription_status', 'subscription_due_at'])
      .where('id', '=', req.params.venueId).executeTakeFirst();
    if (!before) throw notFound('Centre introuvable.');

    const row = await db.updateTable('venues').set(requested)
      .where('id', '=', req.params.venueId).returning(['id', 'subscription_plan', 'subscription_status', 'subscription_due_at'])
      .executeTakeFirstOrThrow();
    await writeAudit(db, {
      venueId: row.id, actorId: req.platformAuth!.accountId, actorRole: 'SUPERADMIN',
      action: 'CENTER_SUBSCRIPTION_UPDATED', objectType: 'venue', objectId: row.id,
      summary: 'a modifié l’abonnement du centre',
      before: JSON.stringify({ plan: before.subscription_plan, status: before.subscription_status, dueAt: before.subscription_due_at }),
      after: JSON.stringify({ plan: row.subscription_plan, status: row.subscription_status, dueAt: row.subscription_due_at }),
    });
    return reply.send({
      venue: { id: row.id, subscriptionPlan: row.subscription_plan, subscriptionStatus: row.subscription_status, subscriptionDueAt: row.subscription_due_at },
    });
  });

  app.post<{ Params: { venueId: string } }>('/platform/venues/:venueId/approve',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const r = await applyVenueTransition(db, guards, req, req.params.venueId, 'ACTIVE', 'CENTER_APPROVED', 'a validé');
    return reply.send({ venue: r });
  });

  app.post<{ Params: { venueId: string } }>('/platform/venues/:venueId/reject',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const r = await applyVenueTransition(db, guards, req, req.params.venueId, 'REJECTED', 'CENTER_REJECTED', 'a refusé');
    return reply.send({ venue: r });
  });

  app.post<{ Params: { venueId: string } }>('/platform/venues/:venueId/suspend',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const r = await applyVenueTransition(db, guards, req, req.params.venueId, 'SUSPENDED', 'CENTER_SUSPENDED', 'a suspendu');
    return reply.send({ venue: r });
  });

  app.post<{ Params: { venueId: string } }>('/platform/venues/:venueId/reactivate',
    { preHandler: (req) => guards.requireSuperadmin(req) }, async (req, reply) => {
    const r = await applyVenueTransition(db, guards, req, req.params.venueId, 'ACTIVE', 'CENTER_REACTIVATED', 'a réactivé');
    return reply.send({ venue: r });
  });
}

// Réexport utile pour les tests (constantes de statut valides).
export { VENUE_STATUSES };
