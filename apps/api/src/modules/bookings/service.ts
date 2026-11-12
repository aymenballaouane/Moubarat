import { sql } from 'kysely';
import {
  DAY_MIN, MIN, applyPromo, assertFieldBookable, bookingReference, closureBlockers, overlaps,
  perHour, prepareBooking, promoApplies, total, weekdayOfDayStart,
  type Booking, type Closure, type MatchFormat, type OpeningHours, type PricingRule, type PromoCode,
  type Quote, type RecurringBooking, type TimeRange,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { BookingsTable, PromoCodesTable, VenueStatusDb } from '../../db/types.js';
import type { Selectable } from 'kysely';
import { fromPgRange, toPgRange } from '../../lib/pgrange.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { loadActiveRecurring, lockFieldSchedule, recurringClash, recurringForDay } from '../recurring-bookings/occupancy.js';

export type BookingRow = Selectable<BookingsTable>;

const DAY_MS = DAY_MIN * MIN;

/* --- Mapping SQL → entités core --------------------------------------------- */

export function rowToBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    fieldId: row.field_id,
    range: fromPgRange(row.time_range),
    status: row.status,
    source: row.source,
    verifiedByCenter: row.verified_by_center,
    byUserId: row.by_user_id,
    priceTotal: total(row.price_total_da),
    createdAt: row.created_at.getTime(),
    ...(row.reservation_name !== null ? { reservationName: row.reservation_name } : {}),
    ...(row.block_reason !== null ? { blockReason: row.block_reason } : {}),
    ...(row.match_id !== null ? { matchId: row.match_id } : {}),
  };
}

/* --- Contexte d'un jour sur un terrain --------------------------------------
   Tout ce que le moteur core consomme : horaires, règles tarifaires,
   occupations vivantes, abonnements, fermetures. Fenêtre de 48 h pour couvrir
   l'après-minuit (un centre algérien ferme à 01:00). */

/** Un format proposé par un terrain, avec son propre tarif de base
    (field_format_prices, 16/09/2026 — seule source de vérité, voir loadDayContext). */
export interface FieldFormatPrice { format: MatchFormat; hourlyRateDa: number }

export interface DayContext {
  field: {
    id: string; name: string; sport: string; hourlyRateDa: number;
    status: 'ACTIVE' | 'MAINTENANCE' | 'ARCHIVED';
    formats: MatchFormat[];
    formatPrices: FieldFormatPrice[];
  };
  /** `status` : statut plateforme du centre (PENDING / ACTIVE / SUSPENDED /
      REJECTED) — c'est aux appelants de décider ce qu'un centre non ACTIVE
      a le droit de vendre (voir createBooking et la route de disponibilité). */
  venue: { id: string; name: string; status: VenueStatusDb; bookingPrefix: string };
  hours: OpeningHours[];
  rules: PricingRule[];
  existing: Booking[];
  recurring: RecurringBooking[];
  closures: Closure[];
  dayStartMs: number;
  weekday: number;
}

/** Contexte STATIQUE d'un terrain — tout ce qui ne dépend PAS du jour demandé (horaires, règles de
    prix, prix par format, abonnements actifs). Chargé en lot pour N terrains en 5 requêtes fixes,
    quel que soit N (A6, cadrage multi-centre/scalabilité 22/09/2026). */
export interface FieldStaticContext {
  field: DayContext['field'];
  venue: DayContext['venue'];
  hours: OpeningHours[];
  rules: PricingRule[];
  recurring: RecurringBooking[];
}

async function loadFieldStaticContexts(db: Db, fieldIds: readonly string[]): Promise<Map<string, FieldStaticContext>> {
  const result = new Map<string, FieldStaticContext>();
  const ids = [...new Set(fieldIds)];
  if (ids.length === 0) return result;

  const fieldRows = await db.selectFrom('fields')
    .innerJoin('venues', 'venues.id', 'fields.venue_id')
    .select([
      'fields.id as id', 'fields.name as name', 'fields.sport as sport',
      'fields.hourly_rate_da as hourly_rate_da', 'fields.status as status', 'fields.formats as formats',
      'venues.id as venue_id', 'venues.name as venue_name', 'venues.status as venue_status',
      'venues.booking_prefix as venue_booking_prefix',
    ])
    .where('fields.id', 'in', ids)
    .execute();
  if (fieldRows.length === 0) return result;

  const venueIds = [...new Set(fieldRows.map((f) => f.venue_id))];
  const [hoursRows, rulesRows, formatPriceRows, recurringRows] = await Promise.all([
    db.selectFrom('opening_hours').selectAll().where('venue_id', 'in', venueIds).execute(),
    db.selectFrom('pricing_rules').selectAll().where('field_id', 'in', ids).orderBy('priority', 'asc').execute(),
    db.selectFrom('field_format_prices').selectAll().where('field_id', 'in', ids).execute(),
    db.selectFrom('recurring_bookings').selectAll().where('field_id', 'in', ids).where('status', '=', 'ACTIVE').execute(),
  ]);

  for (const field of fieldRows) {
    result.set(field.id, {
      field: {
        id: field.id, name: field.name, sport: field.sport,
        hourlyRateDa: field.hourly_rate_da, status: field.status ?? 'ACTIVE',
        formats: field.formats,
        formatPrices: formatPriceRows.filter((p) => p.field_id === field.id).map((p) => ({ format: p.format, hourlyRateDa: p.hourly_rate_da })),
      },
      venue: { id: field.venue_id, name: field.venue_name, status: field.venue_status, bookingPrefix: field.venue_booking_prefix },
      hours: hoursRows.filter((h) => h.venue_id === field.venue_id).map((h) => ({
        venueId: h.venue_id, weekday: h.weekday, startMin: h.start_min, endMin: h.end_min,
      })),
      rules: rulesRows.filter((r) => r.field_id === field.id).map((r) => ({
        fieldId: r.field_id, label: r.label, weekdays: r.weekdays,
        startMin: r.start_min, endMin: r.end_min, format: r.format, rate: perHour(r.rate_da),
      })),
      recurring: recurringRows.filter((r) => r.field_id === field.id).map((r) => ({
        id: r.id, fieldId: r.field_id, weekday: r.weekday, startMin: r.start_min,
        durationMin: r.duration_min, holderName: r.holder_name,
        activeFrom: r.active_from.getTime(), status: r.status,
        ...(r.active_until !== null ? { activeUntil: r.active_until.getTime() } : {}),
      })),
    });
  }
  return result;
}

export interface FieldBatchContext extends FieldStaticContext {
  existing: Booking[];
  closures: Closure[];
}

/** Charge, pour N terrains et UNE fenêtre temporelle, tout ce que le moteur core consomme — 7
    requêtes fixes (5 statiques + réservations + fermetures), quel que soit N (F4/A6, cadrage
    multi-centre/scalabilité 22/09/2026 : avant, 7 requêtes PAR terrain PAR jour — une recherche sur
    8 jours × N terrains coûtait jusqu'à 56×N requêtes séquentielles, voir next-availability).
    `dayContextFor` assemble ensuite un `DayContext` par jour à partir de ce résultat, sans aucun
    aller-retour supplémentaire : `existing`/`closures` couvrent la fenêtre ENTIÈRE, jamais
    redécoupés par jour côté SQL — `fieldAvailability` (core) les filtre déjà par recouvrement
    (`overlaps`), un blocage hors du jour testé ne peut jamais matcher un créneau de ce jour-là. */
export async function loadFieldContextsBatch(
  db: Db, fieldIds: readonly string[], windowStart: number, windowEnd: number,
): Promise<Map<string, FieldBatchContext>> {
  const result = new Map<string, FieldBatchContext>();
  const statics = await loadFieldStaticContexts(db, fieldIds);
  if (statics.size === 0) return result;

  const ids = [...statics.keys()];
  const venueIds = [...new Set([...statics.values()].map((c) => c.venue.id))];
  const windowRange = toPgRange({ start: windowStart, end: windowEnd });
  const [bookingRows, closureRows] = await Promise.all([
    db.selectFrom('bookings').selectAll()
      .where('field_id', 'in', ids).where('status', 'in', ['RESERVED', 'HONORED', 'PAID'])
      .where(sql<boolean>`time_range && ${windowRange}::tstzrange`).execute(),
    db.selectFrom('closures').selectAll()
      .where('venue_id', 'in', venueIds)
      .where(sql<boolean>`during && ${windowRange}::tstzrange`).execute(),
  ]);

  for (const [fieldId, staticCtx] of statics) {
    result.set(fieldId, {
      ...staticCtx,
      existing: bookingRows.filter((b) => b.field_id === fieldId).map(rowToBooking),
      closures: closureRows.filter((c) => c.venue_id === staticCtx.venue.id).map((c) => ({
        id: c.id, venueId: c.venue_id, fieldId: c.field_id,
        range: fromPgRange(c.during), reason: c.reason,
        ...(c.label !== null ? { label: c.label } : {}),
      })),
    });
  }
  return result;
}

/** Assemble un `DayContext` pour UN jour précis à partir d'un `FieldBatchContext` déjà chargé —
    aucun aller-retour base (voir `loadFieldContextsBatch`). */
export function dayContextFor(batch: FieldBatchContext, dayStart: number): DayContext {
  /* MS-002 (audit final, 12/11/2026) : `recurring` porte aussi les occurrences de la veille et du lendemain
     exprimées sur ce jour — sans elles, un abonnement du lendemain 00:00 ne bloquait pas « ce jour, 24:00 ». */
  return { ...batch, recurring: recurringForDay(batch.recurring, dayStart), dayStartMs: dayStart, weekday: weekdayOfDayStart(dayStart) };
}

/** Terrain × jour — le chemin historique, désormais un cas particulier du chargeur en lot
    ci-dessus (« une seule source de vérité », demande d'Aymen). Comportement et requêtes
    inchangés pour l'appelant : même signature, même fenêtre de 48 h, même erreur si le terrain
    n'existe pas. */
export async function loadDayContext(db: Db, fieldId: string, dayStart: number): Promise<DayContext> {
  const batch = await loadFieldContextsBatch(db, [fieldId], dayStart, dayStart + 2 * DAY_MS);
  const ctx = batch.get(fieldId);
  if (!ctx) throw notFound('Terrain introuvable.');
  // Audit 07-09/09/2026 (I1) : l'ancien garde-fou « centre suspendu ne vend
  // plus » lisait ici `venues.active`, colonne que plus rien n'écrit depuis la
  // migration 0007 (toujours vraie) — il ne bloquait donc jamais rien. Le
  // statut réel est désormais porté par le contexte ; la décision de refus
  // vit chez les appelants (createBooking : vente publique ; route de
  // disponibilité), parce que le comptoir du centre n'obéit pas à la même
  // règle que l'application (décision produit I5, voir createBooking).
  return dayContextFor(ctx, dayStart);
}

/** Fermetures exceptionnelles qui bloquent ce terrain sur la fenêtre du jour. */
export function closureRangesFor(ctx: DayContext): TimeRange[] {
  return closureBlockers(ctx.closures, ctx.field.id,
    { start: ctx.dayStartMs, end: ctx.dayStartMs + 2 * DAY_MS });
}

/** Résout le format d'une réservation à partir des prix configurés sur le
    terrain (16/09/2026, demande d'Aymen) — un seul point de résolution,
    réutilisé par la création, le déplacement (format déjà fixé, jamais
    redemandé) et la création de match (fallback quand la résa n'a pas de
    format stocké). Un seul format configuré → déduit silencieusement, aucun
    sélecteur ; plusieurs formats → explicite, jamais deviné. */
export function resolveFormat(prices: readonly FieldFormatPrice[], requested?: string): FieldFormatPrice {
  if (prices.length === 0) {
    throw badRequest('Ce terrain ne propose aucun format tarifé.', 'FORMAT_NOT_AVAILABLE');
  }
  if (prices.length === 1) return prices[0]!;
  if (!requested) {
    throw badRequest('Ce terrain propose plusieurs formats : précisez lequel.', 'FORMAT_REQUIRED');
  }
  const found = prices.find((p) => p.format === requested);
  if (!found) throw badRequest(`Ce terrain ne propose pas le format ${requested}.`, 'FORMAT_NOT_AVAILABLE');
  return found;
}

/* --- Création — le seul chemin, pour toutes les sources ---------------------- */

export interface CreateBookingInput {
  fieldId: string;
  dayStart: number;
  startMin: number;
  durationMin: number;
  source: 'MOUBARAT' | 'PHONE' | 'WALK_IN';
  byUserId: string;
  reservationName: string;
  now: number;
  /** 16/09/2026 : requis dès que le terrain a plus d'un format configuré
      (voir resolveFormat) — un seul format garde le comportement d'avant,
      aucun sélecteur affiché côté client. */
  format?: string;
  promoCode?: string;
  /** Lot 3 (15/09/2026) : téléphone en texte libre, Comptoir/Téléphone créés
      depuis le CRM uniquement — jamais lié à un compte joueur (users). */
  customerPhone?: string;
  /** Règle 23 / 32 (Lot 9) : garde propre à une réservation posée par un JOUEUR (plafonds, chevauchement, accord « numéro visible »),
      appelée une fois le créneau validé par le core (centre ouvert, créneau libre, format connu) et AVANT l'écriture — ainsi un
      créneau pris reste `SLOT_TAKEN`, un centre fermé reste fermé : ces refus-là gardent la priorité. Lève une ApiError. */
  playerGuard?: (range: { start: number; end: number }, tx: Db) => Promise<void>;
  /** Lot 3 : une réservation Téléphone créée depuis le CRM (le staff a le
      client au bout du fil) est vérifiée d'office, dans LA MÊME opération
      d'écriture que la création — jamais une UPDATE séparée après coup, et
      jamais la notification EXTERNAL_BOOKING_TO_VERIFY qui n'aurait plus de
      sens ici (demande d'Aymen). N'affecte QUE ce champ posé sur l'objet
      core avant l'INSERT ; `prepareBooking` (core, gelé) n'est pas modifié. */
  forceVerified?: boolean;
}

/* Mapping local, pas un import de promos/service.ts : celui-ci importe déjà
   rowToBooking d'ICI (ROI = cashReport sur des réservations liées à un promo)
   — un import dans l'autre sens créerait un cycle. Duplication triviale
   d'une lecture SQL, aucune règle métier recodée (promoApplies/applyPromo
   restent les seuls arbitres, appelés depuis le core).
   Exporté (16/09/2026, Modifier une réservation) : la ré-validation promo au
   déplacement a besoin de la MÊME correspondance ligne→entité, jamais une
   copie divergente du mapping ci-dessous. */
export function rowToPromoCode(row: Selectable<PromoCodesTable>): PromoCode {
  return {
    id: row.id, venueId: row.venue_id, code: row.code, label: row.label, percentOff: row.percent_off,
    weekdays: row.weekdays, startMin: row.start_min, endMin: row.end_min,
    validFromMs: row.valid_from.getTime(), validUntilMs: row.valid_until.getTime(),
    active: row.active, exclusions: row.exclusions, usedCount: row.used_count, priority: row.priority,
    ...(row.field_ids !== null ? { fieldIds: row.field_ids } : {}),
    ...(row.sports !== null ? { sports: row.sports } : {}),
    ...(row.max_uses !== null ? { maxUses: row.max_uses } : {}),
    ...(row.min_duration_min !== null ? { minDurationMin: row.min_duration_min } : {}),
  };
}

async function loadActivePromo(db: Db, venueId: string, code: string): Promise<PromoCode | undefined> {
  const row = await db.selectFrom('promo_codes').selectAll()
    .where('venue_id', '=', venueId).where('code', '=', code.toUpperCase()).where('active', '=', true)
    .executeTakeFirst();
  return row ? rowToPromoCode(row) : undefined;
}

/** Par id, quel que soit `active` — `promoApplies` (core) vérifie déjà
    `active` lui-même ; une promo désactivée depuis la création de la résa
    doit continuer à être « perdue proprement » via CE chemin, jamais un
    filtre SQL redondant qui masquerait la même règle deux fois. */
export async function loadPromoById(db: Db, id: string): Promise<PromoCode | undefined> {
  const row = await db.selectFrom('promo_codes').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToPromoCode(row) : undefined;
}

export interface CreatedBooking {
  row: BookingRow;
  quote: Quote;
  notifyCenter: boolean;
  venue: { id: string; name: string };
}

export async function createBooking(db: Db, p: CreateBookingInput): Promise<CreatedBooking> {
  const ctx = await loadDayContext(db, p.fieldId, p.dayStart);
  /* Audit 07-09/09/2026 (I1) : un centre qui n'est pas ACTIVE (PENDING jamais
     validé, SUSPENDED, REJECTED) ne vend plus AU PUBLIC — réservation depuis
     l'application (MOUBARAT / PHONE) et acceptation d'un défi (source MOUBARAT)
     passent toutes ici. Un identifiant de terrain déjà connu, mis en cache ou
     partagé par un lien, ne suffit donc plus à réserver chez un centre
     suspendu. Le comptoir (WALK_IN, compte plateforme rattaché à CE centre,
     déjà contrôlé par requireCenterAction en amont) reste possible : décision
     produit I5 (08/09/2026), l'accès CRM est volontairement séparé du statut
     public du centre — offre « CRM seul » sans présence dans l'application.
     Lot 3 (15/09/2026) : une réservation Téléphone créée depuis le CRM
     (forceVerified — voir plus bas) est du même bord que le comptoir, MÊME
     RAISONNEMENT I5 — jamais bloquée par le statut public, jamais le chemin
     du joueur qui déclare lui-même avoir appelé (celui-là reste soumis à la
     règle, inchangée). */
  const publicSource = p.source === 'MOUBARAT' || (p.source === 'PHONE' && !p.forceVerified);
  if (publicSource && ctx.venue.status !== 'ACTIVE') {
    throw new ApiError(409, 'INVALID_TARGET', 'Ce centre est actuellement indisponible.');
  }
  must(assertFieldBookable(ctx.field.status));

  const candidate: TimeRange = {
    start: p.dayStart + p.startMin * MIN,
    end: p.dayStart + (p.startMin + p.durationMin) * MIN,
  };
  if (closureRangesFor(ctx).some((c) => overlaps(c, candidate))) {
    throw new ApiError(409, 'SLOT_TAKEN', 'Le centre est fermé sur ce créneau (fermeture exceptionnelle).');
  }

  const resolvedFormat = resolveFormat(ctx.field.formatPrices, p.format);

  const prepared = prepareBooking({
    id: '',
    field: { id: ctx.field.id, hourlyRate: perHour(resolvedFormat.hourlyRateDa), formats: ctx.field.formats },
    rules: ctx.rules,
    hours: ctx.hours,
    weekday: ctx.weekday,
    dayStartMs: p.dayStart,
    startMin: p.startMin,
    durationMin: p.durationMin,
    format: resolvedFormat.format,
    existing: ctx.existing,
    recurring: ctx.recurring,
    byUserId: p.byUserId,
    reservationName: p.reservationName,
    source: p.source,
    now: p.now,
  });
  must(prepared.result);
  const booking = prepared.booking!;
  // Lot 3 : override posé APRÈS le core (jamais dans prepareBooking, gelé),
  // AVANT l'INSERT plus bas — verified_by_center=true part donc dans la même
  // écriture que la création, jamais une UPDATE séparée.
  if (p.forceVerified) booking.verifiedByCenter = true;
  const notifyCenter = prepared.notifyCenter && !p.forceVerified;

  /* Code promo — optionnel. `promoApplies`/`applyPromo` (core, crm.ts) sont
     les seuls arbitres d'applicabilité et de calcul de remise. `maxUses` est
     vérifié par COMPTAGE réel des réservations liées (pas par la colonne
     `promo_codes.used_count`, jamais incrémentée côté API pour éviter un
     compteur qui dérive de la réalité — décision documentée,
     docs/DECISIONS.md). Fenêtre de course étroite non verrouillée sur cette
     vérification (deux réservations concurrentes pourraient toutes deux
     passer le contrôle d'un maxUses très bas) — limitation connue, acceptée
     pour cette fonctionnalité de priorité basse. */
  let promoId: string | null = null;
  let discountDa = 0;
  let finalPriceDa = booking.priceTotal.amount;
  if (p.promoCode) {
    const promo = await loadActivePromo(db, ctx.venue.id, p.promoCode);
    if (!promo) throw badRequest('Code promo invalide ou inactif.', 'PROMO_NOT_APPLICABLE');
    const applies = promoApplies(promo, {
      weekday: ctx.weekday, startMin: p.startMin, dayMs: p.dayStart, fieldId: ctx.field.id,
      sport: ctx.field.sport, durationMin: p.durationMin, isSubscription: false, source: p.source,
    });
    if (!applies) throw badRequest('Ce code promo ne s’applique pas à ce créneau.', 'PROMO_NOT_APPLICABLE');
    if (promo.maxUses != null) {
      const { n: usedCount } = await db.selectFrom('bookings')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('promo_code_id', '=', promo.id)
        .executeTakeFirstOrThrow() as { n: string | number | bigint };
      if (Number(usedCount) >= promo.maxUses) {
        throw new ApiError(409, 'PROMO_LIMIT_REACHED', 'Ce code promo a atteint son plafond d’utilisations.');
      }
    }
    const applied = applyPromo(booking.priceTotal.amount, promo);
    promoId = promo.id;
    discountDa = applied.discountDa;
    finalPriceDa = applied.newTotalDa;
  }

  /* Référence « COM-000482 » : séquence PAR CENTRE, tenue dans `venues.booking_seq`
     (migration 0013 — audit 07/09/2026, S1). Avant : COUNT(*) de tout
     l'historique du centre, hors transaction, puis cinq essais sur la
     contrainte UNIQUE — six créations simultanées épuisaient les essais
     (500 REFERENCE_EXHAUSTED sur un créneau libre) et chaque création payait
     un parcours complet de la table. Ici : incrément atomique sous verrou de
     ligne du centre, dans la MÊME transaction que l'INSERT — ouverte ici si
     l'appelant n'en a pas fourni une (l'acceptation d'un défi passe déjà la
     sienne). 22/09/2026 (audit multi-centre, décision Aymen) : le préfixe de
     `venue.bookingPrefix` est désormais un CODE FIXE, unique par construction
     (`venues.booking_prefix`, migration 0021) — deux centres ne peuvent plus
     jamais partager le même préfixe, la collision entre centres décrite
     ci-dessus historiquement ne peut plus se produire. Le SAVEPOINT reste en
     place comme filet pour le seul cas qui subsiste (rebouclage de la
     séquence d'UN MÊME centre après 1 000 000 de réservations, cf.
     `bookingReference`) : coût nul le reste du temps, jamais retiré pour si
     peu. `reference` reste UNIQUE globalement (schéma gelé). Conflit de
     créneau (course multi-postes) → la contrainte d'exclusion
     no_double_booking tranche en dernier ressort, comme avant. */
  const insertWithReference = async (tx: Db): Promise<BookingRow> => {
    /* MS-012 (audit final, 12/11/2026) : la garde du joueur (plafonds, chevauchement, restriction) s'exécute DANS la
       transaction de l'écriture, sous son verrou par joueur — avant, elle relâchait ce verrou avant l'INSERT, et quatre
       réservations simultanées du même joueur passaient à trois au lieu de deux. Toujours après la validation du
       créneau par le core (plus haut) : SLOT_TAKEN et centre fermé gardent la priorité. */
    if (p.playerGuard) await p.playerGuard(booking.range, tx);
    /* MS-002 (audit final, 12/11/2026) : sous le verrou du terrain, les abonnements sont relus et comparés par
       instants absolus — le contexte chargé plus haut l'a été hors transaction, et un abonnement créé entre-temps
       (autre poste) ne passe par aucune contrainte de la base. */
    await lockFieldSchedule(tx, booking.fieldId);
    if (recurringClash(await loadActiveRecurring(tx, booking.fieldId), booking.range)) {
      throw new ApiError(409, 'SLOT_TAKEN', 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const { booking_seq } = await tx.updateTable('venues')
        .set((eb) => ({ booking_seq: eb('booking_seq', '+', 1) }))
        .where('id', '=', ctx.venue.id)
        .returning('booking_seq').executeTakeFirstOrThrow();
      await sql`SAVEPOINT booking_ref`.execute(tx);
      try {
        return await tx.insertInto('bookings').values({
          field_id: booking.fieldId,
          time_range: toPgRange(booking.range),
          status: booking.status,
          source: booking.source,
          verified_by_center: booking.verifiedByCenter,
          by_user_id: booking.byUserId,
          reservation_name: booking.reservationName ?? null,
          reference: bookingReference(ctx.venue.bookingPrefix, booking_seq),
          price_total_da: finalPriceDa,
          block_reason: null,
          promo_code_id: promoId,
          discount_da: discountDa,
          customer_phone: p.customerPhone?.trim() || null,
          format: resolvedFormat.format,
        }).returningAll().executeTakeFirstOrThrow();
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23P01') {
          throw new ApiError(409, 'SLOT_TAKEN', 'Ce créneau vient d’être pris sur ce terrain. Choisissez un autre horaire.');
        }
        if (e.code === '23505' && (e.constraint ?? '').includes('reference')) {
          await sql`ROLLBACK TO SAVEPOINT booking_ref`.execute(tx);
          continue;
        }
        throw err;
      }
    }
    throw new ApiError(500, 'REFERENCE_EXHAUSTED', 'Impossible d’attribuer une référence. Réessayez.');
  };
  const row: BookingRow = db.isTransaction
    ? await insertWithReference(db)
    : await db.transaction().execute(insertWithReference);

  if (notifyCenter) {
    // CRM Auth V1 (03/09/2026) : center_staff.user_id référence platform_accounts
    // depuis la migration 0009, plus jamais users — le personnel de centre n'a
    // plus d'identité Player à notifier ici (notifications.user_id reste
    // REFERENCES users(id), schéma gelé). INNER JOIN : ne notifie que les
    // rares lignes qui correspondraient aussi à un vrai compte Player, jamais
    // une tentative aveugle qui ferait échouer toute la création de réservation
    // sur une violation de clé étrangère. Notifier réellement le CRM (hors
    // Player) est un besoin distinct, pas encore construit.
    const staff = await db.selectFrom('center_staff')
      .innerJoin('users', 'users.id', 'center_staff.user_id')
      .select('center_staff.user_id')
      .where('center_staff.venue_id', '=', ctx.venue.id).execute();
    if (staff.length > 0) {
      await db.insertInto('notifications').values(staff.map((s) => ({
        user_id: s.user_id, type: 'EXTERNAL_BOOKING_TO_VERIFY', ref_id: row.id,
      }))).execute();
    }
  }

  return { row, quote: prepared.quote!, notifyCenter, venue: ctx.venue };
}

/* --- Lecture d'une réservation avec son centre ------------------------------- */

export async function getBookingWithVenue(db: Db, id: string, opts: { forUpdate?: boolean } = {}): Promise<{
  row: BookingRow; venue: { id: string; name: string };
}> {
  // forUpdate : verrou de ligne Postgres. Appelé DANS une transaction, il
  // sérialise les mutations concurrentes sur CETTE réservation (annulation,
  // confirmation, changement de statut) — sans lui, deux requêtes lisent le
  // même statut avant qu'aucune n'écrive et peuvent toutes deux passer une
  // garde core devenue périmée (lost update / violation de la machine à états).
  let q = db.selectFrom('bookings').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound('Réservation introuvable.');
  const venue = await db.selectFrom('fields')
    .innerJoin('venues', 'venues.id', 'fields.venue_id')
    .select(['venues.id as id', 'venues.name as name'])
    .where('fields.id', '=', row.field_id)
    .executeTakeFirstOrThrow();
  return { row, venue };
}
