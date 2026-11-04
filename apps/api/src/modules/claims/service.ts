import { RECIPIENTS, claimReminderDueAt, normalizeAlgerianMobile } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import type { BookingRow } from '../bookings/service.js';
import { fromPgRange } from '../../lib/pgrange.js';
import { writeNotifications } from '../../notifications/write.js';

/* Règle 21 (Réservation prise par téléphone, « C'est bien toi ? » — décisions d'Aymen du 26/10/2026). Les RÈGLES (qui peut répondre, quand le rappel est dû) sont celles du core
   (`claim.ts`) ; ici, seulement chercher le compte par son numéro, enregistrer le rattachement et écrire les notifications (migration 0040).

   Le rattachement est EN ATTENTE : `by_user_id` reste au nom du centre jusqu'à « C'est moi ». Tant qu'il y reste, aucune absence ni annulation ne concerne le joueur. */

/** Le centre vient de saisir `row` avec un numéro : s'il est celui d'un compte joueur actif, la réservation s'y rattache (en attente) et le joueur est prévenu.
    À appeler DANS une transaction, sous `withCommittedPush`. Renvoie le compte rattaché, ou `null` (pas de numéro, numéro illisible, aucun compte). */
export async function attachClaim(trx: Db, row: BookingRow, now: number): Promise<string | null> {
  if (!row.customer_phone || row.status !== 'RESERVED') return null;
  const phone = normalizeAlgerianMobile(row.customer_phone);
  if (!phone.ok) return null;
  const user = await trx.selectFrom('users').select('id')
    .where('phone', '=', phone.e164).where('status', '=', 'ACTIVE').where('deleted_at', 'is', null).executeTakeFirst();
  if (!user) return null;
  await trx.updateTable('bookings').set({ claimed_user_id: user.id, claim_status: 'PENDING' }).where('id', '=', row.id).execute();
  await writeNotifications(trx, RECIPIENTS.bookingClaim(user.id), 'BOOKING_CLAIM', row.id, now);
  return user.id;
}

/** Le rappel de la veille : les réservations encore en attente, à moins de 24 h de leur début, jamais rappelées. Une seule fois chacune. Renvoie le nombre de rappels écrits. */
export async function sweepClaimReminders(trx: Db, now: number): Promise<number> {
  const rows = await trx.selectFrom('bookings')
    .select(['id', 'claimed_user_id', 'time_range'])
    .where('claim_status', '=', 'PENDING').where('claim_reminded_at', 'is', null).where('status', '=', 'RESERVED')
    .where('claimed_user_id', 'is not', null)
    .execute();
  let sent = 0;
  for (const r of rows) {
    const start = fromPgRange(r.time_range).start;
    if (now >= start || now < claimReminderDueAt(start)) continue;
    const claimed = await trx.updateTable('bookings').set({ claim_reminded_at: new Date(now) })
      .where('id', '=', r.id).where('claim_reminded_at', 'is', null).executeTakeFirst();
    if (Number(claimed.numUpdatedRows) === 0) continue;   // un autre passage l'a déjà fait
    await writeNotifications(trx, RECIPIENTS.bookingClaim(r.claimed_user_id!), 'BOOKING_CLAIM', r.id, now);
    sent++;
  }
  return sent;
}
