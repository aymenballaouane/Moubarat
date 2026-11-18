-- RETOUR ARRIÈRE de la migration 0053 (alertes web). Jamais appliqué par le migrateur : à exécuter À LA MAIN, avec psql, après avoir
-- redéployé un code d'API d'avant le lot B, phase 3.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0053_web_push.sql
--
-- Les abonnements web sont SUPPRIMÉS (les joueurs concernés ne reçoivent plus d'alertes sur leur téléphone ; elles restent dans la cloche
-- de l'app). Ordre si l'on revient plus loin : 0053, puis 0052, 0051, 0050, 0049, 0048, 0047.

BEGIN;
DELETE FROM push_devices WHERE platform = 'web';
ALTER TABLE push_devices DROP CONSTRAINT push_devices_web_keys;
ALTER TABLE push_devices DROP COLUMN web_keys;
ALTER TABLE push_devices DROP CONSTRAINT push_devices_platform_check;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform IN ('ios', 'android'));
DELETE FROM schema_migrations WHERE name = '0053_web_push';
COMMIT;
