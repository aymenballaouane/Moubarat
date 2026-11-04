-- SUPERADMIN V1, étape 5 : modération joueur. Statut appliqué ici et vérifié
-- à chaque résolution de session (auth/guards.ts) — une suspension bloque
-- réellement l'accès, pas seulement un badge visuel côté Superadmin.
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE', 'SUSPENDED'));
