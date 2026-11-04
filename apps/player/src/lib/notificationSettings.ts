/* « Réglages des notifications » (ReglagesNotifs.dc.html, Lot 11) : les trois interrupteurs, tels que le serveur les sert (`GET/PATCH /me/notification-settings`).
   Ce qui touche aux matchs et aux réservations (confirmation, annulation, joueur qui arrive ou part, centre qui réserve à ton numéro) n'a PAS d'interrupteur : on le dit toujours. */

export interface NotificationSettings {
  /** « Une place se libère dans ta ville » (défaut : allumé). */
  spotInCity: boolean;
  /** « Rappel avant tes matchs » (défaut : allumé). */
  reminder: boolean;
  /** « Les bons plans des centres » — le MÊME réglage que dans Mes accords (défaut : éteint). */
  promos: boolean;
}

export const NOTIFICATION_SWITCHES: readonly { key: keyof NotificationSettings; label: string }[] = [
  { key: 'spotInCity', label: 'Une place se libère dans ta ville' },
  { key: 'reminder', label: 'Rappel avant tes matchs' },
  { key: 'promos', label: 'Les bons plans des centres' },
];
