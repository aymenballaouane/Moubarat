import type { FastifyInstance } from 'fastify';
import { FORMAT_CAPACITY, SPORT_FORMATS, validateFieldFormats, type MatchFormat, type Sport } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { PlatformGuards } from '../../auth/platform-guards.js';
import { writeAudit } from '../../audit/log.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { parseVenuePhone } from '../../lib/validate.js';
import { archiveRefusalMessage, findFieldCommitments } from './archive-guard.js';
import { VENUE_RATING_MIN_COUNT, ratingSummaryFor, ratingSummaryForMany } from '../results/service.js';
import { READY_SIGNAL_COOLDOWN_MS, evaluateReadiness, lastReadySignalAt, loadVenueReadiness, notReadyMessage } from './readiness.js';

interface Deps { db: Db; guards: PlatformGuards; }

const SPORTS: readonly Sport[] = ['FOOTBALL', 'PADEL', 'BASKET'];
const FORMATS = Object.keys(FORMAT_CAPACITY) as MatchFormat[];
const FIELD_STATUSES = ['ACTIVE', 'MAINTENANCE', 'ARCHIVED'] as const;
interface CopiedRule { id: string; label: string; weekdays: number[]; start_min: number; end_min: number; rate_da: number; format: MatchFormat }

function publicField(f: {
  id: string; name: string; sport: string; formats: string[]; hourly_rate_da: number;
  surface: string | null; size_label: string | null; indoor: boolean; status: string | null;
}) {
  return {
    id: f.id, name: f.name, sport: f.sport, formats: f.formats,
    hourlyRateDa: f.hourly_rate_da, surface: f.surface, sizeLabel: f.size_label,
    indoor: f.indoor, status: f.status ?? 'ACTIVE',
  };
}

/** `fields.formats` (colonne gelée) redevient une DÉRIVATION de
    field_format_prices après chaque mutation de formats (16/09/2026,
    demande d'Aymen) — jamais éditée indépendamment. Appelée dans la MÊME
    transaction que la mutation, jamais un second aller-retour qui laisserait
    une fenêtre où les deux divergent. */
async function syncFieldFormats(db: Db, fieldId: string): Promise<void> {
  const rows = await db.selectFrom('field_format_prices').select('format')
    .where('field_id', '=', fieldId).orderBy('format').execute();
  await db.updateTable('fields').set({ formats: rows.map((r) => r.format) })
    .where('id', '=', fieldId).execute();
}

/** Changement de sport (16/09/2026) : les formats SUIVENT le sport (core
    SPORT_FORMATS), comme l'écran Centre le faisait déjà côté client avant que
    field_format_prices devienne la source unique. Les formats qui n'existent
    pas dans le nouveau sport tombent (avec leurs bandes tarifaires) ; s'il n'en
    reste aucun, le premier format du nouveau sport est créé au tarif le plus
    bas déjà pratiqué sur ce terrain — jamais un terrain sans format, jamais un
    format orphelin. Même transaction que le changement de sport. */
async function realignFormatsToSport(db: Db, fieldId: string, sport: Sport, fallbackRateDa: number): Promise<void> {
  const allowed = SPORT_FORMATS[sport];
  const rows = await db.selectFrom('field_format_prices').selectAll().where('field_id', '=', fieldId).execute();
  const dropped = rows.filter((r) => !allowed.includes(r.format));
  if (dropped.length > 0) {
    const droppedFormats = dropped.map((r) => r.format);
    await db.deleteFrom('field_format_prices').where('field_id', '=', fieldId).where('format', 'in', droppedFormats).execute();
    await db.deleteFrom('pricing_rules').where('field_id', '=', fieldId).where('format', 'in', droppedFormats).execute();
  }
  if (rows.length - dropped.length === 0) {
    const seedRate = rows.length > 0 ? Math.min(...rows.map((r) => r.hourly_rate_da)) : fallbackRateDa;
    await db.insertInto('field_format_prices').values({ field_id: fieldId, format: allowed[0]!, hourly_rate_da: seedRate }).execute();
  }
  await syncFieldFormats(db, fieldId);
}

export async function registerVenueRoutes(app: FastifyInstance, { db, guards }: Deps): Promise<void> {

  /* ONB-2 (audit pré-lancement, lot 6, 27/09/2026) — ce que le CRM ne savait pas dire à son gérant : le centre
     est-il publié, sinon qu'est-ce qui manque (la MÊME règle et les MÊMES libellés que la console, readiness.ts,
     points recommandés compris), et quand l'a-t-on signalé prêt. Route GARDÉE (VIEW_PLANNING, tout le personnel) —
     jamais sur GET /venues/:id, publique et lue par l'app joueur (le statut plateforme n'y a rien à faire, voir
     platform/auth/routes.ts). */
  app.get<{ Params: { venueId: string } }>('/venues/:venueId/readiness',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      await guards.requireCenterAction(req, req.params.venueId, 'VIEW_PLANNING');
      const venue = await db.selectFrom('venues').select(['id', 'status']).where('id', '=', req.params.venueId).executeTakeFirst();
      if (!venue) throw notFound('Centre introuvable.');
      const [readiness, signaled] = await Promise.all([
        loadVenueReadiness(db, [venue.id], { advisory: true }),
        lastReadySignalAt(db, [venue.id]),
      ]);
      return reply.send({
        status: venue.status, readiness: readiness.get(venue.id)!, readySignaledAt: signaled.get(venue.id) ?? null,
      });
    });

  /* « Signaler que c'est prêt » — Manager et au-dessus (EDIT_PROFILE, ceux qui configurent le centre). Refusé si le
     centre n'est pas EN ATTENTE (409 VENUE_NOT_PENDING : déjà publié, suspendu ou refusé — rien à signaler), s'il
     manque un point bloquant (409 VENUE_NOT_READY, les mêmes points que la validation) ou si un signal a déjà été
     envoyé dans les 24 h (409 ALREADY_SIGNALED). Le signal EST la ligne du journal : `VENUE_READY_SIGNALED`, portée
     par le centre — le gérant la voit dans son Journal, la console dans le sien et sur la fiche du centre. */
  app.post<{ Params: { venueId: string } }>('/venues/:venueId/ready-signal',
    { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PROFILE');
      const venue = await db.selectFrom('venues').select(['id', 'name', 'status']).where('id', '=', req.params.venueId).executeTakeFirst();
      if (!venue) throw notFound('Centre introuvable.');
      if (venue.status !== 'PENDING') {
        const why = venue.status === 'ACTIVE' ? 'il est déjà publié' : venue.status === 'SUSPENDED' ? 'il est suspendu — contactez Moubarat' : 'il n’a pas été retenu — contactez Moubarat';
        throw new ApiError(409, 'VENUE_NOT_PENDING', `Rien à signaler : ${why}.`);
      }
      const readiness = (await loadVenueReadiness(db, [venue.id], { advisory: false })).get(venue.id)!;
      if (!readiness.ready) throw new ApiError(409, 'VENUE_NOT_READY', notReadyMessage(readiness), { checks: readiness.checks });
      const last = (await lastReadySignalAt(db, [venue.id])).get(venue.id);
      if (last && Date.now() - last.getTime() < READY_SIGNAL_COOLDOWN_MS) {
        throw new ApiError(409, 'ALREADY_SIGNALED', 'Moubarat a déjà été prévenu il y a moins de 24 h — la validation est en cours.');
      }
      await writeAudit(db, {
        venueId: venue.id, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'VENUE_READY_SIGNALED', objectType: 'venue', objectId: venue.id,
        summary: 'a signalé à Moubarat que le centre est prêt à être publié',
      });
      return reply.send({ ok: true, signaledAt: new Date() });
    });

  /* La carte / liste des centres partenaires (fiche paramétrée par le centre, spec §34).
     SUPERADMIN V1, étape 3 : un centre n'apparaît qu'une fois validé (status
     ACTIVE) — PENDING/REJECTED/SUSPENDED restent invisibles aux joueurs,
     `active` (booléen) n'est plus lu ici.

     A5 (cadrage multi-centre/scalabilité, 22/09/2026) : enrichie pour l'Explorer multi-centre —
     sports/formats proposés, prix « à partir de » par format (source réelle field_format_prices,
     jamais le fields.hourly_rate_da figé — même correctif que GET /venues/:id depuis le 16/09), note
     par centre calculée EN LOT (ratingSummaryForMany, une requête pour tous les centres, pas une par
     centre). Distance : laissée au client (lat/lng déjà fournis), pas de PostGIS à cette échelle. */
  app.get('/venues', async (_req, reply) => {
    const venues = await db.selectFrom('venues').selectAll()
      .where('status', '=', 'ACTIVE').orderBy('name').execute();
    const venueIds = venues.length ? venues.map((v) => v.id) : ['00000000-0000-0000-0000-000000000000'];
    const fields = await db.selectFrom('fields').selectAll()
      .where('venue_id', 'in', venueIds)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'ARCHIVED')]))
      .execute();
    const fieldIds = fields.length ? fields.map((f) => f.id) : ['00000000-0000-0000-0000-000000000000'];
    const [formatPrices, ratings, hours] = await Promise.all([
      db.selectFrom('field_format_prices').selectAll().where('field_id', 'in', fieldIds).execute(),
      ratingSummaryForMany(db, 'VENUE', venues.map((v) => v.id)),
      db.selectFrom('opening_hours').select(['venue_id', 'start_min', 'end_min']).where('venue_id', 'in', venueIds).execute(),
    ]);

    /* A9 (24/09/2026, cadrage §1.7) : un centre qui n'est pas « prêt à publier » (aucun terrain actif tarifé, ou
       aucun horaire) n'apparaît jamais dans le catalogue — y compris un centre déjà actif dont le gérant a depuis
       archivé son dernier terrain : une carte vide vaut moins que l'absence. Même règle que la garde
       d'activation (modules/venues/readiness.ts), évaluée ici sur les lignes déjà chargées — aucune requête de
       plus par centre. `GET /venues/:id` (lien direct) n'est pas concerné. */
    const pricedFieldIds = new Set(formatPrices.map((p) => p.field_id));
    const publishable = new Set(venues.filter((v) => evaluateReadiness({
      fields: fields.filter((f) => f.venue_id === v.id), pricedFieldIds, hours: hours.filter((h) => h.venue_id === v.id),
    }).ready).map((v) => v.id));

    return reply.send({
      venues: venues.filter((v) => publishable.has(v.id)).map((v) => {
        const venueFields = fields.filter((f) => f.venue_id === v.id);
        const venueFieldIds = new Set(venueFields.map((f) => f.id));
        const venuePrices = formatPrices.filter((p) => venueFieldIds.has(p.field_id));
        return {
          id: v.id, name: v.name, wilaya: v.wilaya, address: v.address,
          // `phone` (BUG-7, 26/09/2026) : déjà public via GET /venues/:id (décision Aymen 22/09) — servi ici aussi pour que
          // l'app l'affiche sur un match d'un centre dont la fiche complète n'est pas chargée.
          lat: v.lat, lng: v.lng, phone: v.phone, description: v.description, equipments: v.equipments,
          sports: [...new Set(venueFields.map((f) => f.sport))],
          formats: [...new Set(venuePrices.map((p) => p.format))],
          priceFromDa: venuePrices.length > 0 ? Math.min(...venuePrices.map((p) => p.hourly_rate_da)) : null,
          rating: ratings.get(v.id) ?? { avg: null, count: 0, visible: false },
          fields: venueFields.map((f) => ({
            id: f.id, name: f.name, sport: f.sport, formats: f.formats,
            formatPrices: venuePrices.filter((p) => p.field_id === f.id).map((p) => ({
              format: p.format, hourlyRateDa: p.hourly_rate_da,
            })),
            surface: f.surface, sizeLabel: f.size_label, indoor: f.indoor,
            status: f.status ?? 'ACTIVE',
          })),
        };
      }),
    });
  });

  /* Chantier Centre, É2 (04/09/2026) — `includeArchived` : réservé au
     personnel du centre (les 4 rôles CRM, décision Aymen), jamais à la
     route publique joueur. Le paramètre ne change RIEN au comportement par
     défaut (pas de session requise) ; il se garde lui-même dès qu'il est
     demandé — via requireCenterAction, qui vérifie une ligne center_staff
     réelle pour CE venueId précis (jamais un compte plateforme quelconque :
     un manager du Centre A ne peut pas lire les archivés du Centre B en
     changeant l'id dans l'URL, revue de sécurité Aymen avant codage).
     VIEW_PLANNING plutôt qu'une nouvelle permission : déjà accordée aux
     4 rôles (core gelé, aucune modification). */
  app.get<{ Params: { venueId: string }; Querystring: { includeArchived?: string } }>(
    '/venues/:venueId', async (req, reply) => {
      const v = await db.selectFrom('venues').selectAll()
        .where('id', '=', req.params.venueId).executeTakeFirst();
      if (!v) throw notFound('Centre introuvable.');
      /* Audit final, MS-008 (12/11/2026) : la fiche d'un centre NON PUBLIÉ (en attente, suspendu, refusé — tarifs, module
         caisse…) n'est servie qu'à son propre personnel. Pour tout autre appelant, sans compte ou non : la même réponse
         qu'un centre inexistant. Le CRM d'un centre en cours d'ouverture ou suspendu (offre « CRM seul », I5) envoie son
         jeton et garde sa fiche. */
      if (v.status !== 'ACTIVE') {
        try { await guards.requireCenterAction(req, v.id, 'VIEW_PLANNING'); }
        catch { throw notFound('Centre introuvable.'); }
      }
      const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
      if (includeArchived) await guards.requireCenterAction(req, v.id, 'VIEW_PLANNING');

      const fieldsBase = db.selectFrom('fields').selectAll().where('venue_id', '=', v.id);
      const [fields, hours, rating] = await Promise.all([
        (includeArchived ? fieldsBase : fieldsBase.where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'ARCHIVED')])))
          .orderBy('name').execute(),
        db.selectFrom('opening_hours').selectAll().where('venue_id', '=', v.id)
          .orderBy('weekday').execute(),
        ratingSummaryFor(db, 'VENUE', v.id),
      ]);
      /* Lot P1 (décision Aymen 04/09/2026) : les bandes tarifaires RÉELLES par
         terrain — l'app joueur affichait un tarif « pleines » figé qui pouvait
         diverger des prix des créneaux (calculés, eux, sur ces mêmes règles). */
      const [rules, formatPrices] = fields.length === 0 ? [[], []] : await Promise.all([
        db.selectFrom('pricing_rules').selectAll()
          .where('field_id', 'in', fields.map((f) => f.id)).orderBy('start_min').execute(),
        db.selectFrom('field_format_prices').selectAll()
          .where('field_id', 'in', fields.map((f) => f.id)).orderBy('format').execute(),
      ]);
      return reply.send({
        venue: {
          id: v.id, name: v.name, wilaya: v.wilaya, address: v.address,
          lat: v.lat, lng: v.lng, phone: v.phone, description: v.description,
          equipments: v.equipments, photos: v.photos,
          // Audit D2 : persisté (migration 0014), plus un état React local
          // remis à zéro à chaque rechargement — RECEPTION voit ce que
          // MANAGER a réglé, à chaque connexion.
          cashModuleEnabled: v.cash_module_enabled,
          fields: fields.map((f) => ({
            id: f.id, name: f.name, sport: f.sport, formats: f.formats,
            hourlyRateDa: f.hourly_rate_da, surface: f.surface, sizeLabel: f.size_label,
            indoor: f.indoor, status: f.status ?? 'ACTIVE',
            /** Seule source de vérité pour les formats de ce terrain
                (16/09/2026) — `formats` ci-dessus reste dérivé, pour l'app
                joueur qui n'a pas besoin des prix. */
            formatPrices: formatPrices.filter((p) => p.field_id === f.id).map((p) => ({
              format: p.format, hourlyRateDa: p.hourly_rate_da,
            })),
            pricingRules: rules.filter((r) => r.field_id === f.id).map((r) => ({
              id: r.id, label: r.label, weekdays: r.weekdays, startMin: r.start_min, endMin: r.end_min,
              format: r.format, rateDaPerHour: r.rate_da,
            })),
          })),
          openingHours: hours.map((h) => ({
            weekday: h.weekday, startMin: h.start_min, endMin: h.end_min,
          })),
          rating: { ...rating, minCount: VENUE_RATING_MIN_COUNT },
        },
      });
    });

  /* --- Écriture (Lot A-CRM, chantier « brancher la sauvegarde réelle — Centre »)
     Câblage manquant uniquement : aucune règle métier nouvelle, la matrice de
     permissions (canCenterAct / requireCenterAction) est celle déjà gelée dans
     packages/core/src/rules/crm.ts. */

  /* Fiche du centre (adresse, description, équipements) — chantier Centre, É5
     (04/09/2026). Colonnes déjà réelles dans le schéma gelé (§ « fiche centre
     & promos, retours Aymen », schema.sql:326-330), seule la route manquait.
     EDIT_PROFILE — même permission qui verrouille déjà ces champs côté écran.
     Noms de champs identiques en JS et en base (pas de snake_case à mapper,
     contrairement à sizeLabel/size_label des terrains) : `patch` va direct
     dans `.set()`. */
  app.patch<{
    Params: { venueId: string };
    Body: { address?: string; description?: string; equipments?: string[]; cashModuleEnabled?: boolean; phone?: string | null };
  }>('/venues/:venueId', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PROFILE');
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (b.address !== undefined) {
      const address = String(b.address).trim();
      if (!address) throw badRequest('L’adresse ne peut pas être vide.');
      patch.address = address;
    }
    // Téléphone affiché aux joueurs (22/09/2026, décision Aymen) : le gérant le tient à jour lui-même,
    // mêmes règles que le superadmin (parseVenuePhone). Nom, wilaya et position restent au superadmin.
    if (b.phone !== undefined) patch.phone = parseVenuePhone(b.phone);
    if (b.description !== undefined) {
      patch.description = String(b.description).trim() || null;
    }
    if (b.equipments !== undefined) {
      if (!Array.isArray(b.equipments) || !b.equipments.every((e) => typeof e === 'string')) {
        throw badRequest('equipments doit être un tableau de chaînes.');
      }
      patch.equipments = b.equipments.map((e) => String(e).trim()).filter((e) => e.length > 0);
    }
    // Audit D2 : même permission (EDIT_PROFILE) que le reste de la fiche —
    // aucun élargissement de qui peut activer le module, seul son stockage change.
    if (b.cashModuleEnabled !== undefined) {
      if (typeof b.cashModuleEnabled !== 'boolean') throw badRequest('cashModuleEnabled doit être un booléen.');
      patch.cash_module_enabled = b.cashModuleEnabled;
    }
    if (Object.keys(patch).length === 0) throw badRequest('Aucun champ à modifier.');

    const before = await db.selectFrom('venues').selectAll()
      .where('id', '=', req.params.venueId).executeTakeFirst();
    if (!before) throw notFound('Centre introuvable.');

    const row = await db.updateTable('venues').set(patch)
      .where('id', '=', req.params.venueId).returningAll().executeTakeFirstOrThrow();
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'CENTER_UPDATED', objectType: 'venue', objectId: row.id,
      summary: `a modifié la fiche du centre (${Object.keys(patch).join(', ')})`,
      before: JSON.stringify({
        address: before.address, description: before.description, equipments: before.equipments,
        cashModuleEnabled: before.cash_module_enabled, phone: before.phone,
      }),
      after: JSON.stringify({
        address: row.address, description: row.description, equipments: row.equipments,
        cashModuleEnabled: row.cash_module_enabled, phone: row.phone,
      }),
    });
    return reply.send({
      venue: {
        address: row.address, description: row.description, equipments: row.equipments,
        cashModuleEnabled: row.cash_module_enabled, phone: row.phone,
      },
    });
  });

  /* Terrain — attributs (sport, env, surface, statut). Le tarif de base a sa
     propre route ci-dessous (EDIT_PRICING, pas EDIT_FIELDS). Depuis le
     16/09/2026 (demande d'Aymen), `formats` ne s'édite plus ici : c'est
     field_format_prices, seule source de vérité (routes plus bas), qui
     décide quels formats ce terrain propose — `fields.formats` n'est plus
     qu'une colonne dérivée, resynchronisée à chaque mutation de formats. */
  app.patch<{
    Params: { venueId: string; fieldId: string };
    Body: { name?: string; sport?: string; indoor?: boolean; surface?: string; sizeLabel?: string; status?: string };
  }>('/venues/:venueId/fields/:fieldId', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_FIELDS');
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw badRequest('Le nom du terrain ne peut pas être vide.');
      patch.name = name;
    }
    if (b.sport !== undefined) {
      if (!SPORTS.includes(b.sport as Sport)) throw badRequest(`sport invalide : ${SPORTS.join(', ')}.`);
      patch.sport = b.sport;
    }
    if (b.indoor !== undefined) patch.indoor = Boolean(b.indoor);
    if (b.surface !== undefined) patch.surface = String(b.surface).trim() || null;
    if (b.sizeLabel !== undefined) patch.sizeLabel = String(b.sizeLabel).trim() || null;
    if (b.status !== undefined) {
      if (!(FIELD_STATUSES as readonly string[]).includes(b.status)) {
        throw badRequest(`status invalide : ${FIELD_STATUSES.join(', ')}.`);
      }
      patch.status = b.status;
    }
    if (Object.keys(patch).length === 0) throw badRequest('Aucun champ à modifier.');

    const before = await db.selectFrom('fields').selectAll()
      .where('id', '=', req.params.fieldId).where('venue_id', '=', req.params.venueId)
      .executeTakeFirst();
    if (!before) throw notFound('Terrain introuvable pour ce centre.');

    // Audit produit CE9 (22/09/2026) : un terrain n'est archivable que sans engagement à venir.
    if (patch.status === 'ARCHIVED' && before.status !== 'ARCHIVED') {
      const c = await findFieldCommitments(db, req.params.fieldId, Date.now());
      if (c.bookings + c.subscriptions > 0) {
        throw new ApiError(409, 'FIELD_HAS_FUTURE_BOOKINGS', archiveRefusalMessage(c),
          { conflicts: c.conflicts, bookings: c.bookings, subscriptions: c.subscriptions });
      }
    }

    const dbPatch: Record<string, unknown> = {};
    if ('name' in patch) dbPatch.name = patch.name;
    if ('sport' in patch) dbPatch.sport = patch.sport;
    if ('indoor' in patch) dbPatch.indoor = patch.indoor;
    if ('surface' in patch) dbPatch.surface = patch.surface;
    if ('sizeLabel' in patch) dbPatch.size_label = patch.sizeLabel;
    if ('status' in patch) dbPatch.status = patch.status;

    const sportChanged = 'sport' in patch && patch.sport !== before.sport;
    const row = await db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable('fields').set(dbPatch)
        .where('id', '=', req.params.fieldId).returningAll().executeTakeFirstOrThrow();
      if (!sportChanged) return updated;
      await realignFormatsToSport(trx, updated.id, updated.sport, updated.hourly_rate_da);
      return trx.selectFrom('fields').selectAll().where('id', '=', updated.id).executeTakeFirstOrThrow();
    });
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'FIELD_CHANGED', objectType: 'field', objectId: row.id,
      summary: `a modifié le terrain ${row.name} (${Object.keys(patch).join(', ')})`,
      before: JSON.stringify(publicField(before)), after: JSON.stringify(publicField(row)),
    });
    return reply.send({ field: publicField(row) });
  });

  /* Terrain — création. Rattachée à EDIT_FIELDS (même section CRM), le tarif
     de base est un attribut obligatoire en base (hourly_rate_da NOT NULL). */
  app.post<{
    Params: { venueId: string };
    Body: { name?: string; sport?: string; formats?: string[]; hourlyRateDa?: number; indoor?: boolean; surface?: string; sizeLabel?: string };
  }>('/venues/:venueId/fields', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_FIELDS');
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('Le nom du terrain est requis (ex. T4).');
    if (!SPORTS.includes(b.sport as Sport)) throw badRequest(`sport invalide : ${SPORTS.join(', ')}.`);
    if (!Array.isArray(b.formats) || b.formats.length === 0 || !b.formats.every((f) => FORMATS.includes(f as MatchFormat))) {
      throw badRequest(`formats invalide : au moins un parmi ${FORMATS.join(', ')}.`);
    }
    const hourlyRateDa = Number(b.hourlyRateDa);
    if (!Number.isInteger(hourlyRateDa) || hourlyRateDa <= 0) {
      throw badRequest('hourlyRateDa est un entier strictement positif.');
    }
    const existing = await db.selectFrom('fields').select('id')
      .where('venue_id', '=', req.params.venueId).where('name', '=', name).executeTakeFirst();
    if (existing) throw badRequest('Ce nom de terrain existe déjà.');

    const formats = b.formats as MatchFormat[];
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx.insertInto('fields').values({
        venue_id: req.params.venueId, name, sport: b.sport as Sport, formats,
        indoor: Boolean(b.indoor), hourly_rate_da: hourlyRateDa,
        surface: b.surface ? String(b.surface).trim() : null,
        size_label: b.sizeLabel ? String(b.sizeLabel).trim() : null,
        status: 'ACTIVE',
      }).returningAll().executeTakeFirstOrThrow();
      // Un prix de départ par format, tous identiques à hourlyRateDa — le
      // manager les différencie ensuite via les routes formats ci-dessous
      // (même logique que la migration 0017 pour les terrains déjà existants).
      await trx.insertInto('field_format_prices').values(
        formats.map((format) => ({ field_id: created.id, format, hourly_rate_da: hourlyRateDa })),
      ).execute();
      return created;
    });
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'FIELD_CHANGED', objectType: 'field', objectId: row.id,
      summary: `a ajouté le terrain ${row.name} (${row.sport} ${(row.formats as string[]).join('/')})`,
    });
    return reply.code(201).send({ field: publicField(row) });
  });

  /* Formats & prix d'un terrain (field_format_prices, 16/09/2026, demande
     d'Aymen) — seule source de vérité pour « quels formats ce terrain
     propose » ; `fields.formats` redevient une simple projection, resynchronisée
     ici (syncFieldFormats). EDIT_PRICING : le prix fait partie intégrante de
     la ligne, jamais une édition « format seul » séparée du tarif.
     `copyBandsFrom` (optionnel, demande d'Aymen) : recopie les bandes tarifaires
     (heures pleines, vendredi soir…) d'un format déjà configuré sur ce terrain
     vers le nouveau, au MÊME taux — point de départ éditable bande par bande, pour
     qu'un format ajouté ne tombe jamais à tarif plat sans que ce soit voulu.
     Absent : aucune bande (tarif plat, choix explicite). Même transaction que
     l'ajout du format. */
  app.post<{
    Params: { venueId: string; fieldId: string };
    Body: { format?: string; hourlyRateDa?: number; copyBandsFrom?: string };
  }>('/venues/:venueId/fields/:fieldId/formats', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PRICING');
    const b = req.body ?? {};
    if (!FORMATS.includes(b.format as MatchFormat)) throw badRequest(`format invalide : ${FORMATS.join(', ')}.`);
    const hourlyRateDa = Number(b.hourlyRateDa);
    if (!Number.isInteger(hourlyRateDa) || hourlyRateDa <= 0) {
      throw badRequest('hourlyRateDa est un entier strictement positif.');
    }
    const field = await db.selectFrom('fields').select(['id', 'sport'])
      .where('id', '=', req.params.fieldId).where('venue_id', '=', req.params.venueId).executeTakeFirst();
    if (!field) throw notFound('Terrain introuvable pour ce centre.');
    const format = b.format as MatchFormat;
    // Un format doit exister dans le sport du terrain (core, mêmes règles que
    // partout ailleurs) — jamais un 11v11 sur un terrain de padel.
    must(validateFieldFormats(field.sport, [format]));
    const existing = await db.selectFrom('field_format_prices').select('format')
      .where('field_id', '=', field.id).where('format', '=', format).executeTakeFirst();
    if (existing) throw badRequest('Ce format est déjà configuré sur ce terrain — modifiez son prix plutôt.', 'FORMAT_ALREADY_EXISTS');

    let copyFrom: MatchFormat | null = null;
    if (b.copyBandsFrom !== undefined && b.copyBandsFrom !== null && b.copyBandsFrom !== '') {
      copyFrom = b.copyBandsFrom as MatchFormat;
      const source = await db.selectFrom('field_format_prices').select('format')
        .where('field_id', '=', field.id).where('format', '=', copyFrom).executeTakeFirst();
      if (!source) throw badRequest('Les bandes à copier viennent d\u2019un format déjà configuré sur ce terrain.', 'FORMAT_NOT_AVAILABLE');
    }

    const { row, copiedRules } = await db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto('field_format_prices')
        .values({ field_id: field.id, format, hourly_rate_da: hourlyRateDa })
        .returningAll().executeTakeFirstOrThrow();
      let copied: CopiedRule[] = [];
      if (copyFrom) {
        const bands = await trx.selectFrom('pricing_rules').selectAll()
          .where('field_id', '=', field.id).where('format', '=', copyFrom).orderBy('start_min').execute();
        if (bands.length > 0) {
          copied = await trx.insertInto('pricing_rules').values(bands.map((r) => ({
            field_id: field.id, label: r.label, weekdays: r.weekdays, start_min: r.start_min, end_min: r.end_min,
            rate_da: r.rate_da, priority: r.priority, format,
          }))).returning(['id', 'label', 'weekdays', 'start_min', 'end_min', 'rate_da', 'format']).execute();
        }
      }
      await syncFieldFormats(trx, field.id);
      return { row: inserted, copiedRules: copied };
    });
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'FIELD_CHANGED', objectType: 'field', objectId: field.id,
      summary: `a ajouté le format ${format} (${hourlyRateDa} DA/h) au terrain`
        + (copyFrom ? ` — ${copiedRules.length} bande(s) tarifaire(s) copiée(s) depuis ${copyFrom}` : ' — sans bande tarifaire (tarif plat)'),
    });
    return reply.code(201).send({
      formatPrice: { format: row.format, hourlyRateDa: row.hourly_rate_da },
      pricingRules: copiedRules.map((r) => ({
        id: r.id, label: r.label, weekdays: r.weekdays, startMin: r.start_min, endMin: r.end_min, format: r.format, rateDaPerHour: r.rate_da,
      })),
    });
  });

  app.patch<{
    Params: { venueId: string; fieldId: string; format: string };
    Body: { hourlyRateDa?: number };
  }>('/venues/:venueId/fields/:fieldId/formats/:format', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
    const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PRICING');
    const hourlyRateDa = Number(req.body?.hourlyRateDa);
    if (!Number.isInteger(hourlyRateDa) || hourlyRateDa <= 0) {
      throw badRequest('hourlyRateDa est un entier strictement positif.');
    }
    const field = await db.selectFrom('fields').select('id')
      .where('id', '=', req.params.fieldId).where('venue_id', '=', req.params.venueId).executeTakeFirst();
    if (!field) throw notFound('Terrain introuvable pour ce centre.');
    const before = await db.selectFrom('field_format_prices').selectAll()
      .where('field_id', '=', field.id).where('format', '=', req.params.format as MatchFormat).executeTakeFirst();
    if (!before) throw notFound('Ce format n’est pas configuré sur ce terrain.');

    const row = await db.updateTable('field_format_prices').set({ hourly_rate_da: hourlyRateDa })
      .where('field_id', '=', field.id).where('format', '=', req.params.format as MatchFormat)
      .returningAll().executeTakeFirstOrThrow();
    await writeAudit(db, {
      venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
      action: 'FIELD_CHANGED', objectType: 'field', objectId: field.id,
      summary: `a modifié le prix du format ${row.format} : ${before.hourly_rate_da} → ${hourlyRateDa} DA/h`,
      before: String(before.hourly_rate_da), after: String(hourlyRateDa),
    });
    return reply.send({ formatPrice: { format: row.format, hourlyRateDa: row.hourly_rate_da } });
  });

  /* Suppression d'un format — refusée s'il ne reste que celui-là (un terrain
     propose toujours au moins un format, même garde que validateFieldFormats
     au niveau field). Nettoie au passage les bandes tarifaires de CE format
     (pricing_rules), jamais laissées orphelines sur un format qui n'existe
     plus pour ce terrain. */
  app.delete<{ Params: { venueId: string; fieldId: string; format: string } }>(
    '/venues/:venueId/fields/:fieldId/formats/:format', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PRICING');
      const field = await db.selectFrom('fields').select('id')
        .where('id', '=', req.params.fieldId).where('venue_id', '=', req.params.venueId).executeTakeFirst();
      if (!field) throw notFound('Terrain introuvable pour ce centre.');
      const format = req.params.format as MatchFormat;
      const before = await db.selectFrom('field_format_prices').selectAll()
        .where('field_id', '=', field.id).where('format', '=', format).executeTakeFirst();
      if (!before) throw notFound('Ce format n’est pas configuré sur ce terrain.');
      const count = await db.selectFrom('field_format_prices')
        .select((eb) => eb.fn.countAll().as('n')).where('field_id', '=', field.id)
        .executeTakeFirstOrThrow() as { n: string | number | bigint };
      if (Number(count.n) <= 1) {
        throw badRequest('Un terrain propose toujours au moins un format — configurez-en un autre avant de retirer celui-ci.', 'FORMAT_SPORT_MISMATCH');
      }

      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('field_format_prices')
          .where('field_id', '=', field.id).where('format', '=', format).execute();
        await trx.deleteFrom('pricing_rules')
          .where('field_id', '=', field.id).where('format', '=', format).execute();
        await syncFieldFormats(trx, field.id);
      });
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'FIELD_CHANGED', objectType: 'field', objectId: field.id,
        summary: `a retiré le format ${format} (${before.hourly_rate_da} DA/h) du terrain`,
      });
      return reply.code(204).send();
    });

  /* Bande tarifaire existante (pricing_rules) — seul le taux se modifie ici,
     conforme au seul geste que l'écran Centre expose aujourd'hui. */
  app.patch<{ Params: { venueId: string; ruleId: string }; Body: { rateDa?: number } }>(
    '/venues/:venueId/pricing-rules/:ruleId', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_PRICING');
      const rateDa = Number(req.body?.rateDa);
      if (!Number.isInteger(rateDa) || rateDa <= 0) throw badRequest('rateDa est un entier strictement positif.');

      const before = await db.selectFrom('pricing_rules')
        .innerJoin('fields', 'fields.id', 'pricing_rules.field_id')
        .select(['pricing_rules.id', 'pricing_rules.label', 'pricing_rules.rate_da', 'fields.venue_id', 'fields.name as field_name'])
        .where('pricing_rules.id', '=', req.params.ruleId).where('fields.venue_id', '=', req.params.venueId)
        .executeTakeFirst();
      if (!before) throw notFound('Bande tarifaire introuvable pour ce centre.');

      const row = await db.updateTable('pricing_rules').set({ rate_da: rateDa })
        .where('id', '=', req.params.ruleId).returningAll().executeTakeFirstOrThrow();
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'PRICE_RULE_CHANGED', objectType: 'pricing_rule', objectId: row.id,
        summary: `a modifié le tarif « ${before.label} » (${before.field_name}) : ${before.rate_da} → ${rateDa} DA/h`,
        before: String(before.rate_da), after: String(rateDa),
      });
      return reply.send({
        pricingRule: {
          id: row.id, fieldId: row.field_id, label: row.label, weekdays: row.weekdays,
          startMin: row.start_min, endMin: row.end_min, rateDa: row.rate_da, priority: row.priority,
        },
      });
    });

  /* Horaires d'ouverture — le schéma gelé autorise plusieurs plages par jour
     (clé primaire venue_id/weekday/start_min) ; l'écran CRM n'en édite qu'une
     (la première lue, apps/crm/src/lib/venueDetail.ts::hoursFromApi).
     Chantier Centre, É3 (04/09/2026, décision Aymen — la vraie correction,
     pas un garde-fou) : le UPDATE ciblait avant seulement (venue_id,
     weekday), donc un jour à DEUX plages aurait vu les DEUX lignes réécrites
     avec le même start_min → conflit de clé primaire (500 brut). Désormais
     ciblé par la clé complète de la ligne lue (`before.start_min`), donc
     seule CETTE plage change, l'éventuelle autre reste intacte — cohérent
     avec ce que l'écran montre et édite réellement. */
  app.put<{ Params: { venueId: string; weekday: string }; Body: { startMin?: number; endMin?: number } }>(
    '/venues/:venueId/opening-hours/:weekday', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_HOURS');
      const weekday = Number(req.params.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('weekday doit être entre 0 et 6.');
      const startMin = Number(req.body?.startMin);
      const endMin = Number(req.body?.endMin);
      if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
        throw badRequest('startMin doit être entre 0 et 1439.', 'HOURS_INVALID');
      }
      if (!Number.isInteger(endMin) || endMin <= startMin || endMin > 2880) {
        throw badRequest('La fermeture doit suivre l’ouverture.', 'HOURS_INVALID');
      }

      const before = await db.selectFrom('opening_hours').selectAll()
        .where('venue_id', '=', req.params.venueId).where('weekday', '=', weekday).executeTakeFirst();

      const row = before
        ? await db.updateTable('opening_hours').set({ start_min: startMin, end_min: endMin })
            .where('venue_id', '=', req.params.venueId).where('weekday', '=', weekday).where('start_min', '=', before.start_min)
            .returningAll().executeTakeFirstOrThrow()
        : await db.insertInto('opening_hours').values({ venue_id: req.params.venueId, weekday, start_min: startMin, end_min: endMin })
            .returningAll().executeTakeFirstOrThrow();

      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'CENTER_UPDATED', objectType: 'opening_hours', objectId: `${req.params.venueId}-${weekday}`,
        summary: `a modifié les horaires du jour ${weekday}`,
        ...(before ? { before: `${before.start_min}-${before.end_min}` } : {}),
        after: `${startMin}-${endMin}`,
      });
      return reply.send({ openingHours: { weekday, startMin: row.start_min, endMin: row.end_min } });
    });

  /* Fermer un jour déjà ouvert — l'inverse de la création ci-dessus (décision
     Aymen 04/09/2026, ajoutée en cours d'É3 sur un vrai scénario : fermer
     mercredi/jeudi). `startMin` identifie la plage précise à retirer — même
     principe que le PUT ci-dessus : jamais « tout le jour » en aveugle si
     plusieurs plages existent, seule celle que l'écran montre et édite. */
  app.delete<{ Params: { venueId: string; weekday: string }; Querystring: { startMin?: string } }>(
    '/venues/:venueId/opening-hours/:weekday', { preHandler: (req) => guards.requirePlatformAuth(req) }, async (req, reply) => {
      const role = await guards.requireCenterAction(req, req.params.venueId, 'EDIT_HOURS');
      const weekday = Number(req.params.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('weekday doit être entre 0 et 6.');
      const startMin = Number(req.query.startMin);
      if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
        throw badRequest('startMin doit être entre 0 et 1439.', 'HOURS_INVALID');
      }

      const before = await db.selectFrom('opening_hours').selectAll()
        .where('venue_id', '=', req.params.venueId).where('weekday', '=', weekday).where('start_min', '=', startMin)
        .executeTakeFirst();
      if (!before) throw notFound('Aucune plage horaire à cette heure pour ce jour.');

      await db.deleteFrom('opening_hours')
        .where('venue_id', '=', req.params.venueId).where('weekday', '=', weekday).where('start_min', '=', startMin)
        .execute();
      await writeAudit(db, {
        venueId: req.params.venueId, actorId: req.platformAuth!.accountId, actorRole: role,
        action: 'CENTER_UPDATED', objectType: 'opening_hours', objectId: `${req.params.venueId}-${weekday}`,
        summary: `a fermé le jour ${weekday} (plage ${before.start_min}-${before.end_min} supprimée)`,
        before: `${before.start_min}-${before.end_min}`,
      });
      return reply.code(204).send();
    });
}
