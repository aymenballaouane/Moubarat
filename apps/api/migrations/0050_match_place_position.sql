-- 0050 — Position d'un match libre (lot « Match libre », phase adresses — GO d'Aymen du 18/11/2026 : recherche d'adresses
-- OpenStreetMap + carte Leaflet). Le joueur choisit une adresse proposée, ou pose une épingle sur la carte : la latitude et la
-- longitude du lieu sont gardées avec le match (« Itinéraire » précis, et plus tard les matchs proches).
--
-- Additif : deux colonnes nullables, aucune ligne touchée. Facultatives : un lieu saisi sans épingle reste valable (règle du core).
-- Retour arrière : migrations/retour/0050_match_place_position.sql.

ALTER TABLE matches
  ADD COLUMN place_lat double precision,
  ADD COLUMN place_lng double precision;

-- Les deux ou aucune, valeurs plausibles, et seulement pour un match libre.
ALTER TABLE matches ADD CONSTRAINT matches_place_position CHECK (
  (place_lat IS NULL AND place_lng IS NULL)
  OR (place_lat BETWEEN -90 AND 90 AND place_lng BETWEEN -180 AND 180 AND venue_id IS NULL)
);
