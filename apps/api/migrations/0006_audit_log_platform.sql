-- SUPERADMIN V1 : le journal d'audit devient le journal UNIQUE (centre + plateforme),
-- décision Aymen 31/08/2026 (§8, option A) — pas un second système de journalisation.
--
-- venue_id : nullable — une action SUPERADMIN (suspendre un joueur, par exemple)
-- ne cible pas forcément un centre.
--
-- actor_role : élargi à SUPERADMIN, en plus des rôles centre existants.
--
-- actor_id : la contrainte FK vers users() est retirée plutôt que repointée.
-- Elle référencera bientôt DEUX espaces d'identité différents (users pour les
-- écritures CRM historiques tant que requireCenterAction reste côté session
-- Player, platform_accounts pour SUPERADMIN) — exactement la même situation
-- que object_id/object_type un peu plus haut dans cette table, déjà non-FK
-- par conception pour la même raison (référence polymorphe, jamais un lien
-- d'intégrité vérifié). Rien ne change pour les écritures existantes (Caisse,
-- Terrains/Horaires/Tarifs) : leurs valeurs actor_id restent valides, seule la
-- vérification stricte en base disparaît.
ALTER TABLE audit_log ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_actor_id_fkey;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_actor_role_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_role_check
  CHECK (actor_role IN ('OWNER','MANAGER','RECEPTION','STAFF','SUPERADMIN'));
