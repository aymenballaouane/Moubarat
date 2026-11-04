-- CRM Auth V1, étape 2 (suite) — même correctif que audit_log.actor_id
-- (migration 0006, chantier SUPERADMIN) : quatre colonnes qui attribuent une
-- action à son auteur référençaient strictement users(id), alors que
-- l'auteur peut désormais être un platform_account (personnel de centre).
--
-- Décision Aymen 03/09/2026 : PAS de compte système générique — ça
-- masquerait le vrai acteur dans les données elles-mêmes (pas seulement le
-- journal), rendant impossible un futur rapport par membre du personnel.
-- Contrainte FK retirée (référence polymorphe assumée, comme object_id/
-- object_type dans audit_log), jamais une valeur devinée à sa place.
-- Aucune ligne existante supprimée ou modifiée.
ALTER TABLE bookings DROP CONSTRAINT bookings_by_user_id_fkey;
ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_opened_by_fkey;
ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_closed_by_fkey;
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_by_user_id_fkey;
