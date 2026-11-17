-- RETOUR ARRIÈRE de la migration 0049 (photo principale d'un centre). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec psql,
-- après avoir redéployé un code d'API d'avant la phase photos.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0049_venue_photo.sql
--
-- Il REFUSE de s'exécuter tant qu'un centre a une photo : supprimer ces photos ferait perdre le travail des gérants. Les retirer d'abord
-- depuis le CRM (bouton « Retirer »), ou décider avec Aymen de les perdre, puis relancer.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM venue_photos;
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0049 refusé : % centre(s) ont une photo. Les retirer d''abord (CRM) avant de relancer.', n;
  END IF;
END $$;

DROP TABLE venue_photos;
DELETE FROM schema_migrations WHERE name = '0049_venue_photo';

COMMIT;
