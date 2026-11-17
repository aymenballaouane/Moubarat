-- RETOUR ARRIÈRE de la migration 0047 (match libre). Jamais appliqué par le migrateur (il ne lit que migrations/*.sql) :
-- à exécuter À LA MAIN, une seule fois, avec psql, après avoir redéployé un code d'API d'avant la phase 5.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0047_match_libre.sql
--
-- Il REFUSE de s'exécuter tant qu'un match libre existe : rien n'est supprimé en silence. Décider d'abord, avec Aymen, du sort
-- de ces matchs (les annuler et prévenir leurs inscrits, par exemple), puis les retirer à la main avant de relancer.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM matches WHERE venue_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0047 refusé : % match(s) libre(s) existent encore (matches.venue_id IS NULL). Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

ALTER TABLE matches DROP CONSTRAINT matches_place_lengths;
ALTER TABLE matches DROP CONSTRAINT matches_place_kind;
ALTER TABLE matches DROP COLUMN place_name, DROP COLUMN place_area, DROP COLUMN place_wilaya;
ALTER TABLE matches ALTER COLUMN venue_id SET NOT NULL;
ALTER TABLE matches ALTER COLUMN field_id SET NOT NULL;
DELETE FROM schema_migrations WHERE name = '0047_match_libre';

COMMIT;
