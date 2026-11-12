import type { AuditAction, CenterRole } from '@moubarat/core';
import type { Db } from '../db/client.js';

/* Journal d'audit append-only (« la boîte noire du centre » — et depuis
   SUPERADMIN V1, de la plateforme aussi : migration 0006, décision Aymen
   31/08/2026 §8, un seul journal plutôt que deux). L'API écrit, personne ne
   modifie ni ne supprime.
   EXTERNAL_CONFIRMED : action absente de l'union AuditAction du core (manque
   relevé, proposition d'ajout au gel consignée dans docs/DECISIONS.md) —
   la colonne SQL est du texte libre, le journal reste fidèle au geste réel. */
export type ApiAuditAction = AuditAction | 'EXTERNAL_CONFIRMED'
  // SUPERADMIN V1 — actions plateforme, pas centre : jamais dans AuditAction
  // (core), qui reste le vocabulaire des actions CRM. Même raison que
  // EXTERNAL_CONFIRMED ci-dessus.
  | 'CENTER_CREATED' | 'CENTER_APPROVED' | 'CENTER_REJECTED' | 'CENTER_SUSPENDED' | 'CENTER_REACTIVATED'
  | 'USER_SUSPENDED' | 'USER_REACTIVATED' | 'PLATFORM_ACCOUNT_SUSPENDED' | 'PLATFORM_ACCOUNT_REACTIVATED'
  // Lot 4 — export Excel (15/09/2026) : même raison que EXTERNAL_CONFIRMED,
  // absente de l'union AuditAction du core.
  | 'BOOKINGS_EXPORTED'
  // Comptes CRM d'un centre (20/09/2026) : création / rattachement / réinitialisation
  // du mot de passe — jamais le mot de passe dans le journal. Depuis le 22/09/2026
  // (écran Équipe du CRM), ces mêmes actions peuvent aussi être posées par un OWNER
  // (actorRole = CenterRole), pas seulement le superadmin — voir modules/staff/service.ts.
  | 'STAFF_ACCOUNT_CREATED' | 'STAFF_ACCOUNT_ATTACHED' | 'STAFF_PASSWORD_RESET'
  // Écran Équipe du CRM (22/09/2026, audit produit CR6/CR10/CR15) : changement de rôle
  // (y compris transfert de propriété), retrait d'UN centre (jamais le compte plateforme
  // entier), déverrouillage manuel sans régénérer le mot de passe.
  | 'STAFF_ROLE_CHANGED' | 'STAFF_REMOVED' | 'STAFF_UNLOCKED'
  // Audit juridique et technique du 25/09/2026 (P0-4b) : un propriétaire qui tente de rattacher une adresse déjà
  // utilisée par un compte plateforme d'ailleurs — refusé, mais tracé (détection d'une tentative de prise de contrôle).
  | 'STAFF_ATTACH_REFUSED'
  // Demandes d'inscription d'un centre (20/09/2026).
  | 'VENUE_REQUEST_REJECTED'
  // Abonnement SaaS minimal (22/09/2026, C1/CE11) : plan/échéance/statut payé-impayé, superadmin
  // uniquement — jamais un montant ni une facture, ce n'est pas AuditAction (core) volontairement,
  // aucune règle métier derrière (aucune coupure d'accès).
  | 'CENTER_SUBSCRIPTION_UPDATED'
  // Audit pré-lancement, lot 6 (27/09/2026) : ONB-1 — un compte plateforme change LUI-MÊME son mot de passe (une ligne
  // par centre rattaché, comme la suspension d'un compte) ; ONB-2 — le gérant signale à Moubarat que son centre est prêt
  // à être publié (ligne du centre : visible dans son Journal ET dans celui de la console).
  | 'PLATFORM_PASSWORD_CHANGED' | 'VENUE_READY_SIGNALED'
  // SA-1(a), audit pré-lancement, lot 8 (27/09/2026) : le superadmin corrige le téléphone d'un joueur (carte SIM
  // perdue, faute de frappe à l'inscription). Sans venueId (un joueur n'a jamais de centre) — avant/après en clair :
  // hors du périmètre de P0-6 (« aucun joueur ne voit le numéro d'un autre »), qui ne restreint que ce qu'un JOUEUR
  // voit d'un autre joueur, jamais le Journal superadmin (déjà seul à voir tous les numéros, GET /platform/users).
  | 'USER_PHONE_CHANGED'
  // Règle 25 (26/10/2026) : le centre déclare un joueur absent d'un match (ligne du centre) ; le support lève une restriction (sans centre).
  | 'PLAYER_ABSENCE_DECLARED' | 'PLAYER_RESTRICTION_LIFTED'
  // Règle 21 (26/10/2026) : le joueur dont le numéro a été saisi par le centre répond « C'est moi » / « Ce n'est pas moi » (ligne du centre, auteur « Moubarat »).
  | 'BOOKING_CLAIM_CONFIRMED' | 'BOOKING_CLAIM_DECLINED'
  // Audit final 26/10/2026 (P1-3) : un manager corrige un « no-show » posé par erreur (efface l'absence du titulaire).
  | 'BOOKING_NO_SHOW_REVERTED';
// PLAYER (audit final, MS-020, migration 0043) : un joueur qui annule sa propre réservation — acteur = son identifiant joueur.
export type ApiActorRole = CenterRole | 'SUPERADMIN' | 'PLAYER';

export interface AuditWrite {
  /** Absent pour une action plateforme qui ne cible pas un centre précis. */
  venueId?: string;
  actorId: string;
  actorRole: ApiActorRole;
  action: ApiAuditAction;
  objectType: string;
  objectId: string;
  summary: string;
  before?: string;
  after?: string;
}

export async function writeAudit(db: Db, e: AuditWrite): Promise<void> {
  await db.insertInto('audit_log').values({
    venue_id: e.venueId ?? null,
    actor_id: e.actorId,
    actor_role: e.actorRole,
    action: e.action,
    object_type: e.objectType,
    object_id: e.objectId,
    summary: e.summary,
    before_val: e.before ?? null,
    after_val: e.after ?? null,
  }).execute();
}
