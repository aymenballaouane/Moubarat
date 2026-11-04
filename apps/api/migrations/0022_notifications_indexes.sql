-- Audit multi-centre 22/09/2026 (socle 2e centre, cadrage §2, finding S3/S6) — deux requêtes réelles sur
-- `notifications` n'étaient couvertes par AUCUN index adapté : seul `notifications_unread (user_id) WHERE
-- read_at IS NULL` existe (schéma gelé), un index PARTIEL qui exclut justement les lignes déjà lues.
--
-- 1) GET /me/notifications (modules/notifications/routes.ts) : `WHERE user_id = ? ORDER BY created_at DESC
--    LIMIT 100`, TOUTES les notifications (lues comprises) — l'index partiel ne le sert pas.
-- 2) sweepMatchReminders (modules/notifications/reminders.ts), à CHAQUE consultation de match ou de
--    notifications : `NOT EXISTS (... WHERE user_id = ? AND type = 'MATCH_REMINDER' AND ref_id = matches.id)`
--    — une notification de rappel déjà LUE tombe hors de l'index partiel, la vérification d'idempotence
--    retombe alors sur un balayage filtré sur `user_id` seul, plus large qu'elle ne devrait.
--
-- Additif, schéma gelé intact.
CREATE INDEX notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_type_ref ON notifications (user_id, type, ref_id);

-- GET /me/matches (modules/matches/routes.ts) filtre notamment `matches.organizer_id = ?` — aucun index sur
-- cette colonne (`matches_search` porte sport/status/venue_id/time_range, pas organizer_id).
CREATE INDEX matches_organizer ON matches (organizer_id);
