import type { Selectable } from 'kysely';
import { cashReport, validatePromoDefinition, validatePromoLimits, type CashReport } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { PromoCodesTable } from '../../db/types.js';
import { badRequest, must, notFound } from '../../lib/http.js';
import { rowToBooking } from '../bookings/service.js';

export type PromoRow = Selectable<PromoCodesTable>;

export function publicPromo(row: PromoRow): Record<string, unknown> {
  return {
    id: row.id, code: row.code, label: row.label, percentOff: row.percent_off,
    weekdays: row.weekdays, startMin: row.start_min, endMin: row.end_min,
    validFromMs: row.valid_from.getTime(), validUntilMs: row.valid_until.getTime(),
    fieldIds: row.field_ids, active: row.active, sports: row.sports, exclusions: row.exclusions,
    maxUses: row.max_uses, minDurationMin: row.min_duration_min, priority: row.priority,
  };
}

export interface CreatePromoInput {
  code: string; label: string; percentOffDa: number; weekdays: number[]; startMin: number; endMin: number;
  validFromMs: number; validUntilMs: number; fieldIds?: string[]; sports?: string[];
  exclusions?: ('SUBSCRIPTION' | 'EXTERNAL' | 'TOURNAMENT')[]; maxUses?: number; minDurationMin?: number; priority?: number;
}

/** `validatePromoDefinition`/`validatePromoLimits` (core, crm.ts) sont les
    seules gardes de création — aucune règle de format/plage recodée ici. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les terrains ciblés par une promo sont TOUS de ce centre (audit du 25/09/2026, deuxième trou trouvé avec P0-4a : la
    liste venait du corps de la requête sans aucun contrôle). Réponse propre (400) ; la base le refuse de toute façon
    (migration 0029, trigger `promo_codes_fields_guard`) — elle est le filet, pas le message d'erreur. */
async function assertFieldsBelongToVenue(db: Db, venueId: string, fieldIds: unknown): Promise<void> {
  if (!Array.isArray(fieldIds) || fieldIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
    throw badRequest('fieldIds doit être une liste d’identifiants de terrains.', 'FIELD_NOT_IN_VENUE');
  }
  const unique = [...new Set(fieldIds as string[])];
  if (unique.length === 0) return;
  const found = await db.selectFrom('fields').select('id').where('venue_id', '=', venueId).where('id', 'in', unique).execute();
  if (found.length !== unique.length) throw badRequest('Un ou plusieurs terrains ne sont pas de ce centre.', 'FIELD_NOT_IN_VENUE');
}

export async function createPromo(db: Db, venueId: string, p: CreatePromoInput): Promise<PromoRow> {
  const def = { code: p.code, percentOff: p.percentOffDa, startMin: p.startMin, endMin: p.endMin,
    validFromMs: p.validFromMs, validUntilMs: p.validUntilMs, weekdays: p.weekdays };
  must(validatePromoDefinition(def));
  const limits = {
    priority: p.priority ?? 0,
    ...(p.maxUses !== undefined ? { maxUses: p.maxUses } : {}),
    ...(p.minDurationMin !== undefined ? { minDurationMin: p.minDurationMin } : {}),
  };
  must(validatePromoLimits(limits));
  if (p.fieldIds !== undefined) await assertFieldsBelongToVenue(db, venueId, p.fieldIds);
  return db.insertInto('promo_codes').values({
    venue_id: venueId, code: p.code, label: p.label, percent_off: p.percentOffDa,
    weekdays: p.weekdays, start_min: p.startMin, end_min: p.endMin,
    valid_from: new Date(p.validFromMs), valid_until: new Date(p.validUntilMs),
    field_ids: p.fieldIds ?? null, sports: p.sports ?? null, exclusions: p.exclusions ?? [],
    max_uses: p.maxUses ?? null, min_duration_min: p.minDurationMin ?? null, priority: p.priority ?? 0,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function loadActivePromoByCode(db: Db, venueId: string, code: string): Promise<PromoRow | undefined> {
  return db.selectFrom('promo_codes').selectAll()
    .where('venue_id', '=', venueId).where('code', '=', code.toUpperCase()).where('active', '=', true)
    .executeTakeFirst();
}

export interface PromoWithRoi {
  promo: Record<string, unknown>;
  usageCount: number;
  totalDiscountDa: number;
  revenue: CashReport;
}

/** ROI = revenu réel des réservations qui ont utilisé ce code (via
    `cashReport`, canonique — jamais un recalcul maison) comparé à la remise
    totale accordée. `usageCount` compte les réservations réelles liées à ce
    code (pas la colonne `used_count`, jamais incrémentée côté API — décision
    documentée, docs/DECISIONS.md : dérivé des données réelles, ne dérive
    jamais). */
export async function listPromosWithRoi(db: Db, venueId: string): Promise<PromoWithRoi[]> {
  const promos = await db.selectFrom('promo_codes').selectAll()
    .where('venue_id', '=', venueId).orderBy('priority', 'desc').execute();
  if (promos.length === 0) return [];
  const rows = await db.selectFrom('bookings')
    .where('promo_code_id', 'in', promos.map((p) => p.id))
    .selectAll()
    .execute();
  const byPromo = new Map<string, typeof rows>();
  for (const r of rows) byPromo.set(r.promo_code_id!, [...(byPromo.get(r.promo_code_id!) ?? []), r]);
  return promos.map((promo) => {
    const used = byPromo.get(promo.id) ?? [];
    // Exclusion du CA perdu (15/09/2026, même règle qu'Analytics) : une
    // annulation STAFF_ERROR ne doit pas gonfler le CA perdu affiché sur ce
    // code promo — jamais dans `cashReport` (core, gelé) lui-même, retirée
    // du tableau avant l'appel. `usageCount`/`totalDiscountDa`, eux, restent
    // inchangés (décision confirmée : seul cashReport exclut, pas de côté
    // implicite ailleurs).
    const forRevenue = used.filter((r) => !(r.status === 'CANCELLED' && r.cancel_reason === 'STAFF_ERROR'));
    return {
      promo: publicPromo(promo),
      usageCount: used.length,
      totalDiscountDa: used.reduce((s, r) => s + r.discount_da, 0),
      revenue: cashReport(forRevenue.map(rowToBooking)),
    };
  });
}

export async function loadPromoOrThrow(db: Db, venueId: string, promoId: string): Promise<PromoRow> {
  const row = await db.selectFrom('promo_codes').selectAll()
    .where('id', '=', promoId).where('venue_id', '=', venueId).executeTakeFirst();
  if (!row) throw notFound('Code promo introuvable pour ce centre.');
  return row;
}

export async function setPromoActive(db: Db, venueId: string, promoId: string, active: boolean): Promise<PromoRow> {
  await loadPromoOrThrow(db, venueId, promoId);
  return db.updateTable('promo_codes').set({ active }).where('id', '=', promoId)
    .returningAll().executeTakeFirstOrThrow();
}
