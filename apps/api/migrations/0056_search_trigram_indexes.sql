-- MS-072 (audit final, Lot 2b, 18/11/2026) : les recherches texte du CRM et de la console relisaient toute la table à chaque
-- frappe (CRM : 310 ms pour « 0555 » sur un centre de 17 000 réservations ; console : 120 ms sur 100 000 joueurs), et le coût
-- croît avec le volume. Index trigrammes (extension pg_trgm, standard dans Postgres 16, « trusted » : le propriétaire de la base
-- peut la créer sans superutilisateur) sur les colonnes et les EXPRESSIONS exactement écrites dans les requêtes :
--   - recherche de réservations du CRM : nom saisi (~* sans accents), référence (ILIKE), numéro saisi et numéro du compte
--     joueur réduits à leurs chiffres (regexp_replace … '\D' …) ;
--   - recherche de joueurs de la console : nom et numéro (ILIKE).
-- Une expression d'index doit être recopiée À L'IDENTIQUE dans la requête pour servir : ne pas reformuler l'une sans l'autre
-- (apps/api/src/modules/bookings/routes.ts, recherche ; apps/api/src/platform/users/routes.ts).
-- Création non concurrente (dans la transaction de la migration) : un verrou en écriture le temps de construire l'index,
-- quelques secondes au plus aux volumes du lancement — voir docs/PASSATION.md.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS bookings_reservation_name_trgm ON bookings USING gin (reservation_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_reference_trgm ON bookings USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_customer_phone_digits_trgm ON bookings USING gin ((regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_phone_trgm ON users USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_phone_digits_trgm ON users USING gin ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')) gin_trgm_ops);
