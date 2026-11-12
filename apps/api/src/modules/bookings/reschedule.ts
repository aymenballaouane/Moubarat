import {
  MIN, applyPromo, assertFieldBookable, overlaps, perHour, prepareBooking, promoApplies, rescheduleBooking,
  type CenterRole, type Quote, type TimeRange,
} from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { ApiError, badRequest, must, notFound } from '../../lib/http.js';
import { lockFieldSchedule } from '../recurring-bookings/occupancy.js';
import { closureRangesFor, loadDayContext, loadPromoById, resolveFormat, rowToBooking, type BookingRow } from './service.js';

/* Modifier une réservation (16/09/2026, demande d'Aymen) — règle finale,
   volontairement simple après un premier tour trop large (synchronisation
   match, notifications, requote par joueur — tout ça écarté) :
   terrain/heure/durée modifiables UNIQUEMENT si `match_id IS NULL`. Dès
   qu'un match existe sur la résa — même sans aucun inscrit — la résa est
   verrouillée intégralement : la seule action possible reste Annuler
   (annule résa + match ensemble, comportement déjà existant, inchangé ici).
   Cette garde est LA PREMIÈRE chose vérifiée, avant même de charger le
   contexte du terrain cible — jamais un calcul fait puis jeté. */
export interface RescheduleTarget { fieldId: string; dayStart: number; startMin: number; durationMin: number }

export interface RescheduleCandidate {
  oldFieldId: string; oldFieldName: string; oldStart: number; oldEnd: number; oldPriceTotalDa: number;
  newFieldId: string; newFieldName: string; newStart: number; newEnd: number;
  totalDa: number; discountDa: number; promoDropped: boolean; quote: Quote;
}

/** Calcule le devis/gardes pour un déplacement candidat — jamais d'écriture
    ici, utilisé identiquement par la preview (lecture) et le commit
    (transaction verrouillée, appelant réévalue tout avant d'écrire). */
export async function computeReschedule(
  db: Db, booking: BookingRow, target: RescheduleTarget, role: CenterRole,
  /** Le centre de la réservation (celui dont la garde d'accès a été évaluée par l'appelant). */
  venueId: string,
): Promise<RescheduleCandidate> {
  if (booking.match_id !== null) {
    /* BUG-1 (26/09/2026) : le verrou ne vaut que pour un match VIVANT. Avant, `match_id` posé suffisait — une
       réservation dont le match avait été annulé restait « verrouillée à vie », invisible du centre (voir cascade.ts).
       Un match annulé rend à la réservation sa liberté : elle redevient une réservation ordinaire, modifiable. */
    const linked = await db.selectFrom('matches').select('status').where('id', '=', booking.match_id).executeTakeFirst();
    if (linked !== undefined && linked.status !== 'CANCELLED') {
      throw new ApiError(
        409, 'MATCH_LOCKED',
        'Cette réservation a un match rattaché — le terrain et l’horaire ne se modifient plus une fois le match créé, même sans inscrit. Annule la réservation pour libérer le créneau (le match s’annule avec elle).',
      );
    }
  }
  // Même garde que rescheduleBooking (core) — vérifiée ici AUSSI, avant
  // prepareBooking : un blocage CENTER n'a pas la forme d'une source
  // réservable (prepareBooking n'accepte que MOUBARAT/PHONE/WALK_IN), jamais
  // un cast qui ferait semblant du contraire. Même statut (400) que
  // rescheduleBooking() via must() ailleurs — INVALID_TARGET n'est pas dans
  // STATUS_BY_CODE (lib/http.ts), jamais un 409 choisi à la main ici pour un
  // code qui vaut 400 partout où le core le renvoie.
  if (booking.source === 'CENTER') {
    throw badRequest('Un blocage se débloque et se recrée — il ne se déplace pas.', 'INVALID_TARGET');
  }

  /* MS-002 (audit final, 12/11/2026) : au commit (transaction), le verrou du terrain cible est pris AVANT de lire
     ses abonnements — même verrou que la création d'abonnement, jamais une occupation posée entre lecture et écriture. */
  if (db.isTransaction) await lockFieldSchedule(db, target.fieldId);
  const ctx = await loadDayContext(db, target.fieldId, target.dayStart);
  /* Cloisonnement entre centres (audit juridique et technique du 25/09/2026, P0-4a) : le terrain CIBLE doit
     appartenir au MÊME centre que la réservation. La garde d'accès des routes (`requireCenterAction`) ne porte
     que sur le centre d'origine : sans ce contrôle, un membre du centre A pouvait déplacer une réservation (nom,
     téléphone du client) dans le planning du centre B — dont les identifiants de terrain sont publics
     (`GET /venues`). Même erreur qu'un terrain inexistant : jamais la confirmation qu'un identifiant existe
     ailleurs. Vaut pour la prévisualisation ET le commit (les deux passent ici). */
  if (ctx.venue.id !== venueId) throw notFound('Terrain introuvable.');
  must(assertFieldBookable(ctx.field.status));

  const candidate: TimeRange = {
    start: target.dayStart + target.startMin * MIN,
    end: target.dayStart + (target.startMin + target.durationMin) * MIN,
  };
  if (closureRangesFor(ctx).some((c) => overlaps(c, candidate))) {
    throw new ApiError(409, 'SLOT_TAKEN', 'Le centre est fermé sur ce créneau (fermeture exceptionnelle).');
  }

  const originalBooking = rowToBooking(booking);
  // Jamais la résa elle-même comme bloqueur de son propre nouveau créneau —
  // sans ce filtre, tout déplacement qui recouvre même partiellement son
  // ancien horaire (même terrain) se refuserait à tort (SLOT_TAKEN contre
  // elle-même). La contrainte d'exclusion Postgres, elle, n'a pas ce
  // problème sur un UPDATE (elle ne compare jamais une ligne à sa propre
  // ancienne version) — seul ce tableau en mémoire en avait besoin.
  const existingExcludingSelf = ctx.existing.filter((b) => b.id !== booking.id);

  /* Format fixé à la création (16/09/2026), jamais reproposé au déplacement :
     réutilisé tel quel s'il est déjà connu (`booking.format`) — si le
     terrain cible ne le propose pas, la garde `prepareBooking` (field.formats)
     refuse elle-même en FORMAT_NOT_AVAILABLE, jamais un silence qui changerait
     le format sous le client. Résa historique/terrain à un seul format
     (`booking.format` NULL) : déduit du terrain cible via resolveFormat, même
     règle que la création — un terrain cible à plusieurs formats sans format
     stocké est le seul cas qui échoue ici (FORMAT_REQUIRED), volontairement,
     plutôt qu'un choix devine. Le tarif utilisé n'importe pas quand le format
     n'est pas vendu sur ce terrain : la garde ci-dessus refuse avant que
     quoteRange ne le consulte. */
  const formatPrice = booking.format !== null
    ? (ctx.field.formatPrices.find((p) => p.format === booking.format)
      ?? { format: booking.format, hourlyRateDa: ctx.field.hourlyRateDa })
    : resolveFormat(ctx.field.formatPrices);

  const prepared = prepareBooking({
    id: booking.id,
    field: { id: ctx.field.id, hourlyRate: perHour(formatPrice.hourlyRateDa), formats: ctx.field.formats },
    rules: ctx.rules, hours: ctx.hours, weekday: ctx.weekday, dayStartMs: target.dayStart,
    startMin: target.startMin, durationMin: target.durationMin,
    format: formatPrice.format,
    existing: existingExcludingSelf, recurring: ctx.recurring,
    byUserId: originalBooking.byUserId,
    ...(originalBooking.reservationName !== undefined ? { reservationName: originalBooking.reservationName } : {}),
    // CENTER déjà écarté ci-dessus (throw) — jamais atteignable ici.
    source: originalBooking.source as 'MOUBARAT' | 'PHONE' | 'WALK_IN', now: Date.now(),
  });
  must(prepared.result);
  const quote = prepared.quote!;

  /* Promo existante (16/09/2026) : re-vérifiée sur le NOUVEAU créneau,
     jamais reconduite à l'aveugle. `usedCount` du code n'est JAMAIS écrit —
     ni ici ni ailleurs dans ce flux — la copie ci-dessous avec usedCount−1
     n'existe qu'en mémoire, pour que la vérification ne se pénalise pas
     elle-même avec son propre usage déjà compté (piège : un plafond à 1
     rejetterait sinon systématiquement le déplacement de LA résa qui a
     justement consommé ce plafond). `promo_code_id` sur la ligne ne change
     jamais non plus, éligible ou pas — seule la remise (`discount_da`)
     retombe à 0 si le nouveau créneau ne correspond plus. */
  let finalPriceDa = quote.total.amount;
  let discountDa = 0;
  let promoDropped = false;
  if (booking.promo_code_id) {
    const promo = await loadPromoById(db, booking.promo_code_id);
    const applies = promo !== undefined && promoApplies(
      { ...promo, usedCount: Math.max(0, promo.usedCount - 1) },
      {
        weekday: ctx.weekday, startMin: target.startMin, dayMs: target.dayStart, fieldId: ctx.field.id,
        sport: ctx.field.sport, durationMin: target.durationMin, isSubscription: false, source: originalBooking.source,
      },
    );
    if (promo !== undefined && applies) {
      const applied = applyPromo(quote.total.amount, promo);
      discountDa = applied.discountDa;
      finalPriceDa = applied.newTotalDa;
    } else {
      promoDropped = true;
    }
  }

  const { result } = rescheduleBooking({
    booking: originalBooking, newFieldId: target.fieldId, newRange: candidate,
    newPriceTotalDa: finalPriceDa, byRole: role, now: Date.now(),
  });
  must(result);

  const oldFieldName = target.fieldId === booking.field_id
    ? ctx.field.name
    : (await db.selectFrom('fields').select('name').where('id', '=', booking.field_id).executeTakeFirstOrThrow()).name;

  return {
    oldFieldId: booking.field_id, oldFieldName, oldStart: originalBooking.range.start, oldEnd: originalBooking.range.end,
    oldPriceTotalDa: booking.price_total_da,
    newFieldId: target.fieldId, newFieldName: ctx.field.name, newStart: candidate.start, newEnd: candidate.end,
    totalDa: finalPriceDa, discountDa, promoDropped, quote,
  };
}

/** `startMin`/`durationMin` — même validation que la création (badRequest
    avant tout accès base), jamais une garde recodée avec un message différent. */
export function parseRescheduleQuery(q: { fieldId?: string; startMin?: string | number; durationMin?: string | number }): {
  fieldId: string; startMin: number; durationMin: number;
} {
  const fieldId = String(q.fieldId ?? '');
  if (!fieldId) throw badRequest('fieldId manquant.');
  const startMin = Number(q.startMin);
  if (!Number.isInteger(startMin) || startMin < 0 || startMin >= 2880) {
    throw badRequest('startMin invalide (minutes depuis minuit, 0–2879).');
  }
  const durationMin = Number(q.durationMin ?? 90);
  if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 360) {
    throw badRequest('Durée invalide : entre 30 et 360 minutes.', 'HOURS_INVALID');
  }
  return { fieldId, startMin, durationMin };
}
