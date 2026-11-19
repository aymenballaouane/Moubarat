-- RETOUR ARRIÈRE de la migration 0050 (position d'un match libre). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec
-- psql, après avoir redéployé un code d'API d'avant la phase adresses.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0050_match_place_position.sql
--
-- Les positions enregistrées sont perdues (le nom du lieu et sa wilaya restent) : le script refuse tant qu'un match à venir en porte
-- une — décider d'abord avec Aymen.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM matches WHERE place_lat IS NOT NULL AND upper(time_range) > now();
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0050 refusé : % match(s) à venir ont une position. Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

ALTER TABLE matches DROP CONSTRAINT matches_place_position;
ALTER TABLE matches DROP COLUMN place_lat, DROP COLUMN place_lng;
DELETE FROM schema_migrations WHERE name = '0050_match_place_position';

COMMIT;
