-- Refonte app joueur, lot "Fondations" (règle 34, décidée par Aymen le 22/10/2026) : ville,
-- sexe et sports préférés du joueur, captés à l'inscription (écran "Ton jeu") et modifiables
-- depuis "Modifier mon profil".
--
-- `profiles` existe depuis le schéma gelé (migration 0001) mais n'est écrite par AUCUNE route
-- à ce jour (position/pied fort/niveau/disponibilité restent vides pour tout compte créé par
-- l'API, confirmé par le commentaire de modules/account/routes.ts) — colonnes additives
-- nullables, aucun joueur existant perturbé par ce ALTER TABLE.
--
-- `sports` réutilise l'enum `sport` déjà en place (jamais une liste parallèle qui pourrait
-- diverger). `niveau` (profiles.level, type skill_level) existe déjà depuis le schéma gelé :
-- rien à ajouter pour lui, seule la route pour l'écrire manquait (lot "Fondations" aussi).
ALTER TABLE profiles
  ADD COLUMN city text CHECK (city IN ('ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF', 'AUTRE')),
  ADD COLUMN gender text CHECK (gender IN ('HOMME', 'FEMME')),
  ADD COLUMN sports sport[] NOT NULL DEFAULT '{}';
