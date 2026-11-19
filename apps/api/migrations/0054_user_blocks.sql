-- Lot B, phase 4 (18/11/2026, GO d'Aymen ; App Store règle 1.2 et Google Play, contenu créé par les utilisateurs) — bloquer un joueur.
-- Celui qui bloque ne voit plus les matchs organisés par le joueur bloqué ; le joueur bloqué ne peut plus rejoindre les matchs de celui
-- qui bloque (ils disparaissent de ses listes ; par un lien : « Ce match n'est plus disponible. »). Personne n'est prévenu ; les
-- inscriptions déjà faites ne changent pas. Additive. Retour arrière à la main : migrations/retour/0054_user_blocks.sql.

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_by_blocked ON user_blocks (blocked_id);
