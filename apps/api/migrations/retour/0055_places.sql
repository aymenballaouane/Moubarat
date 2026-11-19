-- RETOUR ARRIÈRE de la migration 0055 (lieux de la communauté). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec psql,
-- après avoir redéployé un code d'API d'avant le lot B, phase 6.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0055_places.sql
--
-- Les lieux ajoutés par les joueurs et la console sont PERDUS (les matchs gardent leur nom, leur adresse et leur position, copiés sur
-- le match). Le script refuse tant qu'un lieu existe — décider d'abord avec Aymen (exporter la liste depuis la console si besoin).
-- Ordre si l'on revient plus loin : 0055, puis 0054, 0053, 0052, 0051, 0050, 0049, 0048, 0047.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM places;
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0055 refusé : % lieu(x) existent. Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

DROP TABLE place_reports;
ALTER TABLE matches DROP CONSTRAINT matches_place_id_free;
DROP INDEX matches_by_place;
ALTER TABLE matches DROP COLUMN place_id;
DROP TABLE places;
DELETE FROM schema_migrations WHERE name = '0055_places';

COMMIT;
