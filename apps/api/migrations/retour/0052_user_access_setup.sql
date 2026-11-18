-- RETOUR ARRIÈRE de la migration 0052 (inscription courte d'un invité). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec
-- psql, après avoir redéployé un code d'API d'avant le lot B, phase 2.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0052_user_access_setup.sql
--
-- Sans cette colonne, un compte d'invité (sans mot de passe) serait renvoyé à la passerelle d'accès (pseudo + mot de passe) à sa
-- prochaine connexion — sans rien perdre, mais avec un écran de plus. Le script refuse tant qu'un tel compte existe : décider d'abord avec
-- Aymen. Ordre si l'on revient plus loin : 0052, puis 0051, 0050, 0049, 0048, 0047.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE access_setup_at IS NOT NULL AND password_hash IS NULL AND deleted_at IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0052 refusé : % compte(s) d’invité sans mot de passe. Décider de leur sort avant de relancer.', n;
  END IF;
END $$;

ALTER TABLE users DROP COLUMN access_setup_at;
DELETE FROM schema_migrations WHERE name = '0052_user_access_setup';

COMMIT;
