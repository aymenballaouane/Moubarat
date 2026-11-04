-- Mise à l'échelle, lot L1 (25/09/2026) — sept index, chacun justifié par une MESURE et non par une supposition.
--
-- Méthode : base jetable (cluster Postgres séparé, jamais la base de dev) chargée à l'échelle visée — 100 000 joueurs,
-- 15 centres / 90 terrains, 178 000 réservations, 62 000 matchs, 375 000 inscriptions, 1 000 000 de lignes de journal,
-- 300 000 notifications — puis les VRAIES routes de l'API chronométrées (15 passages, `app.inject`) avec
-- `pg_stat_statements`, et EXPLAIN ANALYZE des requêtes lentes. Avant : chacune de ces requêtes était un balayage
-- séquentiel complet de sa table. Durées d'exécution SQL, avant → après :
--
--   planning CRM (requête réelle de la route, un centre/un jour) 174-337 ms → 1,0 ms  bookings_field_time
--                                                                (7,9 ms avec bookings_time seul : gardé, voir plus bas)
--   analytics CRM 30 jours (bookings d'un centre)               176 ms → 15,7 ms   bookings_field_time / bookings_time
--   Dashboard plateforme : réservations du jour                 207 ms → 6,7 ms    bookings_time
--   Dashboard plateforme : matchs du jour                       108 ms → 0,2 ms    matches_time
--   Journal plateforme, 100 dernières lignes / Dashboard, 10    565 / 418 ms → 0,3 / 0,05 ms   audit_log_at
--   Promos : réservations portant un code                       87 ms → 37 ms      bookings_promo
--   Console : 200 dernières réservations                        197 ms → 1 ms      bookings_created
--   Console : 200 derniers matchs                               114 ms → 1 ms      matches_created
--
-- Côté route (moyenne sur 15 passages) : GET /venues/:id/bookings (planning) 186 → 7 ms ; GET /platform/dashboard
-- 412 → 32 ms ; GET /platform/audit-log 388 → 6 ms ; GET /platform/bookings 345 → 15 ms ; GET /platform/matches
-- 216 → 21 ms ; promos (ROI) 183 → 31 ms ; analytics 30 jours 207 → 84 ms. Les routes joueur (/me/*, /matches,
-- /venues, disponibilité) répondaient déjà en moins de 50 ms : AUCUN index n'y est ajouté.
--
-- Coût en écriture : 5 040 réservations insérées d'un coup, 0,23 ms par ligne avec ces index contre 0,14 ms sans
-- (+0,09 ms) — sur ≈ 500 réservations par jour, négligeable.
--
-- Pourquoi deux index GiST sur bookings : la contrainte `no_double_booking` (schéma gelé) porte déjà un index GiST
-- (field_id, time_range), mais PARTIEL (statuts actifs seulement) — inutilisable pour le planning, qui affiche aussi
-- les annulées. `bookings_field_time` sert les lectures par centre (le planning, l'analytics : l'index est parcouru
-- pour chacun des terrains du centre) ; `bookings_time` sert les lectures sans terrain (comptes du jour du Dashboard).
--
-- Additif, schéma gelé intact. CREATE INDEX (sans CONCURRENTLY, impossible dans le lot d'une migration) verrouille
-- l'ÉCRITURE de la table le temps de la construction : à l'échelle mesurée ci-dessus, 1 s (journal, 1 M de lignes),
-- 4 à 5 s (chaque index GiST de bookings, 178 000 lignes) ; à l'échelle du pilote, quelques millisecondes. À appliquer
-- hors pointe si les tables ont grossi (voir docs/PASSATION.md §4.2).

CREATE INDEX audit_log_at ON audit_log (at DESC);

CREATE INDEX bookings_field_time ON bookings USING gist (field_id, time_range);
CREATE INDEX bookings_time ON bookings USING gist (time_range);
CREATE INDEX bookings_promo ON bookings (promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX bookings_created ON bookings (created_at DESC);

CREATE INDEX matches_created ON matches (created_at DESC);
CREATE INDEX matches_time ON matches USING gist (time_range);
