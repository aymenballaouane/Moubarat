-- RETOUR ARRIÈRE de la migration 0051 (adresse d'un match libre). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec
-- psql, après avoir redéployé un code d'API d'avant le lot B, phase 1.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0051_match_place_address.sql
--
-- Les adresses enregistrées sont perdues (le nom du lieu, le quartier, la wilaya et la position restent) : le script refuse tant
-- qu'un match à venir en porte une — décider d'abord avec Aymen. Ordre si l'on revient plus loin : 0051, puis 0050, 0049, 0048, 0047.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM matches WHERE place_address IS NOT NULL AND upper(time_range) > now();
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0051 refusé : % match(s) à venir ont une adresse. Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

ALTER TABLE matches DROP CONSTRAINT matches_place_address;
ALTER TABLE matches DROP COLUMN place_address;
DELETE FROM schema_migrations WHERE name = '0051_match_place_address';

COMMIT;
