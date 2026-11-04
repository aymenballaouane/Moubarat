-- Règle 25 (MODIFIÉE, précisions d'Aymen du 26/10/2026) : absences, demi-absences et restrictions.
-- Une ligne d'`absences` = un événement qui pèse (FULL = absence, HALF = demi-absence : désistement entre H-2 et H-1, annulation tardive d'une réservation).
-- UNE SEULE FOIS PAR MATCH : l'index unique (joueur, match) refuse qu'un joueur soit compté deux fois pour le même match (centre ET organisateur
-- qui déclarent la même absence : la seconde est ignorée). Hors match (une réservation sans match), l'unicité porte sur la réservation.
-- `player_restrictions` : une ligne par restriction posée (niveau 1 = 7 jours, 2 = 30 jours, 3 et plus = blocage sans fin levé à la main) ; le compteur
-- repart à zéro à chaque restriction (le serveur ne compte que les absences postérieures à `starts_at` de la dernière).
-- Additive : aucune donnée touchée.
CREATE TABLE absences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  match_id    uuid REFERENCES matches(id),
  booking_id  uuid REFERENCES bookings(id),
  kind        text NOT NULL CHECK (kind IN ('FULL', 'HALF')),
  source      text NOT NULL CHECK (source IN ('ORGANIZER', 'CENTER', 'LATE_LEAVE', 'LATE_CANCEL')),
  declared_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (match_id IS NOT NULL OR booking_id IS NOT NULL)
);
CREATE UNIQUE INDEX absences_once_per_match ON absences (user_id, match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX absences_once_per_booking ON absences (user_id, booking_id) WHERE match_id IS NULL;
CREATE INDEX absences_by_user ON absences (user_id, created_at);

CREATE TABLE player_restrictions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  level      integer NOT NULL CHECK (level >= 1),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz,
  lifted_at  timestamptz,
  lifted_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_restrictions_by_user ON player_restrictions (user_id, starts_at);
