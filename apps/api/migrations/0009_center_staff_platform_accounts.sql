-- CRM Auth V1, étape 2 — repointe l'identité du personnel de centre vers
-- platform_accounts (email+mot de passe), plus jamais users (Player,
-- téléphone+OTP). Décision Aymen 02/09/2026 : réutiliser platform_accounts/
-- platform_sessions pour le CRM plutôt qu'un 3e système d'auth.
--
-- Les 4 lignes de seed existantes (Hamid/Yacine/Nadia/Amine) référencent des
-- users.id réels, qui ne correspondent à aucun platform_accounts.id — jamais
-- utilisées par un vrai login (requireCenterAction n'a jamais eu de vraie
-- session CRM à vérifier). NOT VALID : la contrainte s'applique à toute
-- nouvelle ligne, sans rejeter la migration à cause des 4 existantes.
-- Aucune donnée supprimée — ces lignes restent en base, simplement inertes
-- (aucune requête ne peut plus les faire correspondre à un vrai compte).
ALTER TABLE center_staff DROP CONSTRAINT center_staff_user_id_fkey;
ALTER TABLE center_staff ADD CONSTRAINT center_staff_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES platform_accounts(id) NOT VALID;
