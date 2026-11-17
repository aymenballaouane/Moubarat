-- 0048 — Format 9v9 (lot « Match libre », phase 9v9 — GO d'Aymen du 16/11/2026 : « règles, base, CRM, aucun prix par défaut »).
--
-- Une seule valeur ajoutée au type énuméré `match_format` (schéma gelé : packages/core/schema.sql, jamais modifié), placée entre
-- le 8v8 et le 11v11. Aucune ligne n'est modifiée ; aucun terrain ne propose le 9v9 tant qu'un centre ne l'ajoute pas lui-même
-- dans le CRM, avec un prix qu'il saisit (aucun prix par défaut).
--
-- PostgreSQL 16 accepte ADD VALUE dans une transaction (le migrateur en ouvre une par migration) tant que la nouvelle valeur n'y
-- est pas utilisée — ce fichier ne l'utilise pas.
-- Retour arrière : migrations/retour/0048_format_9v9.sql (à la main, refusé tant qu'une ligne utilise le 9v9).

ALTER TYPE match_format ADD VALUE IF NOT EXISTS '9v9' BEFORE '11v11';
