/* Chantier CRM Abonnements (06/09/2026) : SUBSCRIPTIONS_DEMO/RecurringSubscription
   ont disparu (Abonnements.tsx lit désormais GET/POST
   /venues/:venueId/recurring-bookings) — DAY_NAMES/WEEKDAY_ORDER restent,
   ce sont de purs libellés/ordre d'affichage, pas des données fictives. */

export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
/** Ordre d'affichage du selecteur "Jour" — semaine algerienne, samedi en tete. */
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
