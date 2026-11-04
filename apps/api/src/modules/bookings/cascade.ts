import { MATCH_TRANSITIONS, RECIPIENTS, activePlayers, canTransition } from '@moubarat/core';
import type { Db } from '../../db/client.js';
import { writeNotifications } from '../../notifications/write.js';
import { loadPlayers, rowToMatchPlayer } from '../matches/service.js';
import type { BookingRow } from './service.js';

/* Cascade réservation → match (26/09/2026, BUG-1 de l'audit pré-lancement, GO d'Aymen).

   Avant ce lot, annuler une réservation (par le joueur ou par le centre) n'écrivait que `bookings` : le match posé dessus
   restait OPEN, dans le fil, rejoignable, personne n'était prévenu et le créneau libéré était revendu à quelqu'un d'autre —
   alors que le CRM affirmait « annule pour libérer le créneau (le match s'annule avec elle) ». Reproduit par sonde
   (deux groupes pour un même terrain).

   Règles :
   - Appelé DANS la transaction qui vient de passer la réservation en CANCELLED, la ligne de la réservation déjà
     verrouillée. Ordre de verrouillage UNIQUE dans les deux sens : la réservation d'abord, puis le match — l'annulation
     d'un match (matches/routes.ts) verrouille elle aussi la réservation avant le match. Sans cet ordre, une annulation de
     résa et une annulation de match simultanées s'interbloqueraient.
   - Le lien est `bookings.match_id` (jamais `matches.booking_id`, NULL sur les matchs des scripts de démo).
   - La transition suit la table du core (`MATCH_TRANSITIONS`) : un match déjà annulé ou joué ne bouge pas, et
     personne n'est prévenu deux fois.
   - Qui est prévenu : un JOUEUR qui annule sa réservation est l'organisateur — il est exclu (`RECIPIENTS.matchCancelled`,
     même règle que l'annulation directe du match) ; le CENTRE n'est pas un joueur — tous les inscrits sont prévenus,
     organisateur compris, avec un libellé qui dit LE CENTRE (`MATCH_CANCELLED_BY_CENTER`), jamais « l'organisateur a
     annulé ». Push différé après commit : l'appelant enveloppe sa transaction dans `withCommittedPush`. */

export type CancelActor = { kind: 'PLAYER'; userId: string } | { kind: 'CENTER' };

export interface LinkedMatchCancelled {
  matchId: string;
  title: string;
  /** Inscrits réellement prévenus (l'annuleur exclu quand c'est un joueur). */
  notified: number;
}

export async function cancelLinkedMatch(
  trx: Db, booking: BookingRow, actor: CancelActor, now: number,
): Promise<LinkedMatchCancelled | null> {
  if (booking.match_id === null) return null;
  const match = await trx.selectFrom('matches').selectAll().where('id', '=', booking.match_id).forUpdate().executeTakeFirst();
  // FK ON DELETE SET NULL : une ligne absente n'arrive pas — mais jamais un plantage de l'annulation pour autant.
  if (!match) return null;
  if (!canTransition(MATCH_TRANSITIONS, match.status, 'CANCELLED')) return null;

  await trx.updateTable('matches').set({ status: 'CANCELLED' }).where('id', '=', match.id).execute();
  const joinedIds = activePlayers((await loadPlayers(trx, match.id)).map(rowToMatchPlayer)).map((p) => p.userId);
  const recipients = actor.kind === 'PLAYER'
    ? RECIPIENTS.matchCancelled(joinedIds, actor.userId)
    : RECIPIENTS.matchCancelledByCenter(joinedIds);
  await writeNotifications(
    trx, recipients, actor.kind === 'PLAYER' ? 'MATCH_CANCELLED' : 'MATCH_CANCELLED_BY_CENTER', match.id, now,
    undefined, actor.kind === 'PLAYER' ? actor.userId : undefined,
  );
  return { matchId: match.id, title: match.title, notified: recipients.length };
}

/** Le centre annule une réservation SANS match vivant : le réservant est prévenu — s'il est un compte JOUEUR. `by_user_id`
    porte soit un joueur (App Moubarat, ou réservation téléphonique déclarée dans l'app), soit un compte plateforme
    (Comptoir/Téléphone saisis au CRM — la FK vers `users` a été retirée par la migration 0010) ; `notifications.user_id`
    référence `users(id)` : prévenir un compte plateforme ferait échouer l'annulation. Un compte supprimé (anonymisé) ne
    lit plus rien : rien à écrire. */
export async function notifyBookerOfCenterCancel(trx: Db, booking: BookingRow, now: number): Promise<boolean> {
  const player = await trx.selectFrom('users').select('id')
    .where('id', '=', booking.by_user_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!player) return false;
  await writeNotifications(trx, RECIPIENTS.bookingCancelledByCenter(player.id), 'BOOKING_CANCELLED_BY_CENTER', booking.id, now);
  return true;
}

/** « 3 inscrits prévenus » / « 1 inscrit prévenu » / « aucun autre inscrit » — pluriel accordé en code, jamais « (s) ». */
export function notifiedLabel(n: number): string {
  if (n === 0) return 'aucun autre inscrit';
  return n === 1 ? '1 inscrit prévenu' : `${n} inscrits prévenus`;
}
