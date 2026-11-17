-- 0049 — Photo principale d'un centre (lot « Match libre », phase photos — option A choisie par Aymen le 17/11/2026 : dans la base,
-- coût 0, aucune dépendance). UNE photo par centre (le premier des quatre emplacements du CRM, « Photo d'ambiance »), en DEUX tailles
-- déjà réduites dans le navigateur du gérant : `large` (bande de la fiche, ~1600×800) et `card` (cartes, ~640×320).
--
-- Table à part (jamais dans `venues`) : la liste des centres ne charge jamais les images. `version` change à chaque envoi : l'app
-- l'ajoute à l'adresse de l'image (`?v=`), ce qui permet un cache d'un an sans jamais montrer une ancienne photo.
-- Additif : aucune ligne existante touchée. Retour arrière : migrations/retour/0049_venue_photo.sql.

CREATE TABLE venue_photos (
  venue_id   uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  mime       text NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  large      bytea NOT NULL CHECK (octet_length(large) BETWEEN 1 AND 900000),
  card       bytea NOT NULL CHECK (octet_length(card) BETWEEN 1 AND 250000),
  version    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
