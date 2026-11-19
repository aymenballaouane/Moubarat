-- RETOUR ARRIÈRE de la migration 0054 (joueurs bloqués). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec psql, après avoir
-- redéployé un code d'API d'avant le lot B, phase 4.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0054_user_blocks.sql
--
-- Les blocages sont PERDUS (les joueurs se reverraient). Le script refuse tant qu'un blocage existe — décider d'abord avec Aymen
-- (l'App Store et Google Play exigent un moyen de bloquer : on ne revient en arrière qu'avec un code qui le remplace).
-- Ordre si l'on revient plus loin : 0054, puis 0053, 0052, 0051, 0050, 0049, 0048, 0047.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM user_blocks;
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0054 refusé : % blocage(s) existent. Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

DROP TABLE user_blocks;
DELETE FROM schema_migrations WHERE name = '0054_user_blocks';

COMMIT;
