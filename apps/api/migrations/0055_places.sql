-- Lot B, phase 6 « Nos lieux d'abord » (19/11/2026, GO d'Aymen sur la maquette) — les terrains hors centres partenaires, ajoutés par
-- les joueurs (épingle ou adresse), par la console ou par un fichier importé, vérifiés par Moubarat avant d'être montrés à tous.
-- Un match libre peut se rattacher à un lieu (`matches.place_id`) : « 12 matchs joués ici ». Les données ne viennent JAMAIS de Google
-- (conditions de Google) ; un lieu vérifié peut être ajouté À LA MAIN à OpenStreetMap (`on_osm`).
-- Additive : aucune ligne existante n'est modifiée. Retour arrière à la main : migrations/retour/0055_places.sql.

CREATE TABLE places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  -- Le nom replié (minuscules, sans accents ni espaces superflus) : recherche et doublons.
  name_key text NOT NULL,
  area text CHECK (area IS NULL OR char_length(area) BETWEEN 1 AND 60),
  address text CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 120),
  wilaya text NOT NULL CHECK (char_length(wilaya) BETWEEN 2 AND 40),
  lat double precision NOT NULL CHECK (lat BETWEEN 18 AND 38),
  lng double precision NOT NULL CHECK (lng BETWEEN -9 AND 12.5),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'HIDDEN')),
  source text NOT NULL CHECK (source IN ('PLAYER', 'CONSOLE', 'IMPORT')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  on_osm boolean NOT NULL DEFAULT false,
  merged_into uuid REFERENCES places(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CONSTRAINT places_merged_hidden CHECK (merged_into IS NULL OR status = 'HIDDEN'),
  CONSTRAINT places_not_self_merged CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE INDEX places_by_position ON places (lat, lng) WHERE status <> 'HIDDEN';
CREATE INDEX places_by_status ON places (status, created_at DESC);
CREATE INDEX places_by_creator ON places (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE matches ADD COLUMN place_id uuid REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE matches ADD CONSTRAINT matches_place_id_free CHECK (place_id IS NULL OR venue_id IS NULL);
CREATE INDEX matches_by_place ON matches (place_id) WHERE place_id IS NOT NULL;

-- « Signaler une erreur » sur un lieu : mauvais nom, mauvaise position, terrain fermé, autre.
CREATE TABLE place_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('WRONG_NAME', 'WRONG_POSITION', 'CLOSED', 'OTHER')),
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 280),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'HANDLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);
CREATE UNIQUE INDEX place_reports_one_open ON place_reports (place_id, reporter_id) WHERE status = 'OPEN';
CREATE INDEX place_reports_by_place ON place_reports (place_id) WHERE status = 'OPEN';
