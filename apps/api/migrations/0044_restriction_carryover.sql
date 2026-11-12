-- Audit final, MS-022 (12/11/2026, décision déléguée par Aymen) : un joueur sous restriction (règle 25) qui supprime son compte puis se
-- réinscrit avec le même numéro repartait libre. La suppression reste TOUJOURS possible (droit à l'effacement) ; seule la restriction EN COURS
-- survit, réduite au strict nécessaire : l'empreinte SHA-256 du numéro (jamais le numéro), le niveau et la date de fin. Aucune autre donnée.
-- Une réinscription avec ce numéro reprend la restriction, puis la ligne est effacée ; une ligne expirée est effacée. Blocage sans fin
-- (ends_at NULL) : la ligne reste tant que le support ne l'a pas levé sur le nouveau compte. Additive.
CREATE TABLE restriction_carryovers (
  phone_hash text PRIMARY KEY,
  level      integer NOT NULL CHECK (level >= 1),
  ends_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
