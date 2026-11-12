-- Audit final, MS-020 (12/11/2026) : un JOUEUR peut être l'acteur d'une ligne du journal d'un centre — l'annulation de sa propre
-- réservation (avant : aucune trace, le personnel ne voyait ni qui avait libéré un créneau ni quand). Additive : on élargit la
-- liste des rôles d'acteur posée par la migration 0006 ; aucune ligne existante n'est touchée.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_actor_role_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_role_check
  CHECK (actor_role IN ('OWNER','MANAGER','RECEPTION','STAFF','SUPERADMIN','PLAYER'));
