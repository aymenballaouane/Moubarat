-- Lot B, phase 1 (18/11/2026, GO d'Aymen) : « C'est ici » enregistre avec un match libre le nom, l'ADRESSE et la position.
-- L'adresse (« Rue Ali Khodja ») est celle sous l'épingle, telle qu'OpenStreetMap la donne ; facultative, 120 signes au plus,
-- jamais sur un match de centre. Additive : aucune ligne existante n'est modifiée.
-- Retour arrière à la main : migrations/retour/0051_match_place_address.sql.

ALTER TABLE matches ADD COLUMN place_address text;

ALTER TABLE matches ADD CONSTRAINT matches_place_address CHECK (
  place_address IS NULL OR (venue_id IS NULL AND char_length(place_address) BETWEEN 1 AND 120)
);
