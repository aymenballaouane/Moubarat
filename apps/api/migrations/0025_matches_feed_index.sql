-- Fil des matchs à venir (F2, cadrage multi-centre/scalabilité 22/09/2026) : GET /matches filtre
-- désormais sur `upper(time_range) > now()` (matches/routes.ts) plutôt que sur le seul statut
-- stocké, paresseusement synchronisé — l'index existant `matches_search` (schema.sql, gelé) est
-- construit sur `lower(time_range)`, pas `upper`, et ne sert pas ce filtre. Index dédié sur
-- l'expression réellement utilisée.
CREATE INDEX matches_feed_upcoming ON matches (visibility, status, upper(time_range));
