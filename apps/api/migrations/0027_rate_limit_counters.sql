-- Mise à l'échelle, lot L2 (25/09/2026) — compteurs de limitation de débit PARTAGÉS entre instances d'API.
--
-- Avant : cinq compteurs en MÉMOIRE du processus (codes SMS par IP et globaux, connexions plateforme par IP, demandes
-- publiques d'inscription d'un centre par IP et globales). Avec deux instances, chacune comptait pour elle seule : les
-- plafonds étaient doublés et imprévisibles derrière un répartiteur. Désormais ils vivent ici.
--
-- Un compteur = une ligne (clé, début de fenêtre). Fenêtre FIXE (heure, ou jour d'Alger) : l'incrément est un seul
-- INSERT … ON CONFLICT DO UPDATE … RETURNING hits — atomique sous concurrence, sans verrou applicatif, sans Redis.
-- Conséquence assumée par rapport à l'ancienne fenêtre glissante : à cheval sur deux fenêtres, un client peut faire
-- jusqu'à deux fois le plafond en quelques secondes (fin d'une fenêtre + début de la suivante). Acceptable pour un
-- garde-fou anti-abus / plafond de coût ; jamais une facturation exacte.
--
-- Purge : les lignes de fenêtres échues n'ont plus aucune utilité. L'API en supprime opportunément (1 appel sur 100
-- environ, tout ce qui a plus de deux jours) — aucune tâche planifiée requise. Volume : une ligne par (limiteur, IP,
-- fenêtre) ; quelques milliers de lignes au plus.
--
-- Additif, schéma gelé intact.
CREATE TABLE rate_limit_counters (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL CHECK (hits >= 0),
  PRIMARY KEY (key, window_start)
);
-- Sert la purge (`WHERE window_start < …`), la clé primaire servant déjà les incréments.
CREATE INDEX rate_limit_counters_window ON rate_limit_counters (window_start);
