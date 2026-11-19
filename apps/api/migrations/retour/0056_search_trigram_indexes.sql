-- RETOUR ARRIÈRE de la migration 0056 (index trigrammes de recherche, audit final Lot 2b). Jamais appliqué par le migrateur : à
-- exécuter À LA MAIN, avec psql, seulement si l'on redéploie un code d'API d'avant le Lot 2 de l'audit final.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0056_search_trigram_indexes.sql
--
-- Rien n'est perdu : ce ne sont que des index (les recherches redeviennent des lectures complètes, plus lentes, mais exactes).
-- L'extension pg_trgm est retirée aussi : aucune autre migration ne s'en sert (à revérifier si une migration ultérieure l'utilise :
-- DROP EXTENSION refuse alors de s'exécuter, ce qui est voulu).

BEGIN;

DROP INDEX IF EXISTS bookings_reservation_name_trgm;
DROP INDEX IF EXISTS bookings_reference_trgm;
DROP INDEX IF EXISTS bookings_customer_phone_digits_trgm;
DROP INDEX IF EXISTS users_name_trgm;
DROP INDEX IF EXISTS users_phone_trgm;
DROP INDEX IF EXISTS users_phone_digits_trgm;
DROP EXTENSION IF EXISTS pg_trgm;
DELETE FROM schema_migrations WHERE name = '0056_search_trigram_indexes';

COMMIT;
