/* Libellés partagés Dashboard/Journal — une seule source, jamais deux
   traductions qui divergent (trouvé en vérifiant l'écran : Dashboard
   affichait USER_SUSPENDED en toutes lettres faute de ce partage). */
export const ACTION_LABELS: Record<string, string> = {
  CENTER_CREATED: 'Centre créé', CENTER_APPROVED: 'Centre validé', CENTER_REJECTED: 'Centre refusé',
  CENTER_SUSPENDED: 'Centre suspendu', CENTER_REACTIVATED: 'Centre réactivé',
  USER_SUSPENDED: 'Joueur suspendu', USER_REACTIVATED: 'Joueur réactivé',
  PLATFORM_ACCOUNT_SUSPENDED: 'Compte plateforme suspendu', PLATFORM_ACCOUNT_REACTIVATED: 'Compte plateforme réactivé',
  STAFF_ACCOUNT_CREATED: 'Compte CRM créé', STAFF_ACCOUNT_ATTACHED: 'Compte CRM rattaché', STAFF_PASSWORD_RESET: 'Mot de passe CRM réinitialisé',
  VENUE_REQUEST_REJECTED: 'Demande d’inscription refusée',
  STAFF_ROLE_CHANGED: 'Rôle CRM modifié', STAFF_REMOVED: 'Compte CRM retiré du centre', STAFF_UNLOCKED: 'Compte CRM déverrouillé',
  STAFF_ATTACH_REFUSED: 'Rattachement CRM refusé', CENTER_SUBSCRIPTION_UPDATED: 'Abonnement du centre modifié',
  BOOKINGS_EXPORTED: 'Réservations exportées',
  // Lot 6 de l'audit pré-lancement (27/09/2026).
  PLATFORM_PASSWORD_CHANGED: 'Mot de passe changé par son titulaire', VENUE_READY_SIGNALED: 'Centre signalé prêt par son gérant',
  FIELD_CHANGED: 'Terrain modifié', PRICE_RULE_CHANGED: 'Tarif modifié', CENTER_UPDATED: 'Centre modifié',
  CASH_SESSION: 'Session caisse', CASH_MOVEMENT: 'Mouvement caisse',
  // Lot séparé, audit pré-lancement (27/09/2026) : les codes d'action RESTANTS s'affichaient encore en toutes
  // lettres (BOOKING_CANCELLED etc., relevé lors de la vérification finale des trois surfaces) — la même faute que
  // le commentaire en tête de fichier signalait déjà pour USER_SUSPENDED. Couvre TOUT ApiAuditAction (core +
  // plateforme), y compris des codes core jamais encore écrits par une route réelle (SLOT_BLOCKED, PROMO_CHANGED,
  // ROLE_CHANGED, ATTENDANCE_SET) : mieux vaut un libellé prêt et jamais vu qu'un code brut le jour où une route
  // les écrira. `SUBSCRIPTION_CHANGED` = une réservation récurrente (Abonnements, CRM) — jamais confondu avec
  // `CENTER_SUBSCRIPTION_UPDATED` ci-dessus (le plan SaaS du centre), volontairement un mot différent.
  BOOKING_CREATED: 'Réservation créée', BOOKING_CANCELLED: 'Réservation annulée', BOOKING_RESCHEDULED: 'Réservation déplacée',
  BOOKING_CASH_STATUS: 'Statut de réservation modifié', EXTERNAL_CONFIRMED: 'Réservation téléphonique confirmée',
  SLOT_BLOCKED: 'Créneau bloqué', SLOT_UNBLOCKED: 'Créneau débloqué',
  PROMO_CHANGED: 'Code promo modifié', SUBSCRIPTION_CHANGED: 'Réservation récurrente modifiée',
  ROLE_CHANGED: 'Rôle modifié', ATTENDANCE_SET: 'Présence enregistrée',
  USER_PHONE_CHANGED: 'Téléphone joueur corrigé',
  BOOKING_CLAIM_CONFIRMED: 'Réservation confirmée par le joueur', BOOKING_CLAIM_DECLINED: 'Réservation refusée par le joueur',
  // Audit final 26/10/2026 (CRM-6) : règle 25 et correction d'un no-show.
  BOOKING_NO_SHOW_REVERTED: 'No-show annulé', PLAYER_ABSENCE_DECLARED: 'Absence déclarée', PLAYER_RESTRICTION_LIFTED: 'Restriction levée',
  // Écrit seulement par le seed de démo (`scripts/seed-demo-venue.ts`), jamais par une vraie route — absent de
  // ApiAuditAction pour cette raison, mais réel dans le Journal d'un centre de démo : un libellé quand même.
  CASH_SESSION_CLOSED: 'Session caisse clôturée',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Superadmin', OWNER: 'Propriétaire', MANAGER: 'Manager', RECEPTION: 'Réception', STAFF: 'Staff',
};
