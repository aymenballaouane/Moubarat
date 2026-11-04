import { NOTIFICATION_LABELS, type NotificationType } from '@moubarat/core';

/* Présentation d'une notification (libellé + icône), SANS jamais planter sur un type inconnu.

   L'écran Notifications indexait `NOTIFICATION_LABELS[n.type]` et `TYPE_ICON[n.type]` : un type que cette version de l'app ne connaît
   pas (le serveur est plus récent que la PWA en cache — ce qui arrive dès qu'un nouveau type est ajouté, ex. `TEAM_INVITED`)
   donnait `undefined`, puis `undefined.title` : écran blanc, et le joueur ne pouvait plus lire AUCUNE de ses notifications.
   Maintenant : un type inconnu s'affiche comme une notification générique (libellé neutre, icône cloche, aucune navigation) et
   les autres restent lisibles. */

export const GENERIC_NOTIFICATION = { title: 'Nouvelle notification', body: 'Recharge l’app pour voir le détail.' } as const;

/** Vrai si CETTE version de l'app connaît le type. `hasOwn` et non `in` : « constructor » ou « toString » ne sont pas des types. */
export function isKnownNotificationType(type: string): type is NotificationType {
  return Object.hasOwn(NOTIFICATION_LABELS, type);
}

export function notificationLabels(type: string): { title: string; body: string } {
  return isKnownNotificationType(type) ? NOTIFICATION_LABELS[type] : GENERIC_NOTIFICATION;
}

/* EXTERNAL_BOOKING_TO_VERIFY est une notif GERANT (RECIPIENTS.externalBookingToVerify → admins du centre) : elle n'apparait jamais
   dans ce flux joueur, mais le Record doit rester exhaustif pour le compilateur — un nouveau type du core oblige à choisir son icône. */
const TYPE_ICON: Record<NotificationType, string> = {
  BOOKING_CLAIM: 'i-phone',
  SPOT_FREED: 'i-user-plus',
  MATCH_FILLING: 'i-check',
  MATCH_ALERT: 'i-bell',
  MATCH_REMINDER: 'i-clock',
  PLAYER_JOINED: 'i-user1',
  PLAYER_LEFT: 'i-users',
  MATCH_CANCELLED: 'i-x',
  CHALLENGE_RECEIVED: 'i-shield',
  CHALLENGE_ACCEPTED: 'i-shield',
  CHALLENGE_REJECTED: 'i-shield',
  CHALLENGE_EXPIRED: 'i-shield',
  BOOKING_CONFIRMED: 'i-cal',
  EXTERNAL_BOOKING_TO_VERIFY: 'i-cal',
  RESULT_TO_CONFIRM: 'i-whistle',
  RESULT_CONFIRMED: 'i-whistle',
  TEAM_INVITED: 'i-users',
  MATCH_CANCELLED_BY_CENTER: 'i-x',
  BOOKING_CANCELLED_BY_CENTER: 'i-x',
  PLAYER_REMOVED: 'i-x',
};

export function notificationIcon(type: string): string {
  return isKnownNotificationType(type) ? TYPE_ICON[type] : 'i-bell';
}
