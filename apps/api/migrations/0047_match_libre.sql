-- 0047 — Match libre (lot « Match libre », phase 5 — GO d'Aymen du 16/11/2026 : « migration réversible, rien de destructif »).
--
-- Un match peut désormais se jouer AILLEURS que chez un centre partenaire : pas de centre, pas de terrain, pas de prix, pas de
-- réservation ; à la place, le lieu saisi par l'organisateur (nom ou adresse), sa commune si connue, sa wilaya.
--
-- Changement uniquement ADDITIF ou RELÂCHANT : deux colonnes perdent leur NOT NULL, trois colonnes nullables s'ajoutent, deux
-- contraintes CHECK verrouillent la forme. Aucune ligne existante n'est modifiée (toutes ont un centre et un terrain : la
-- contrainte se valide sur elles telle quelle). Retour arrière : migrations/retour/0047_match_libre.sql (à la main, refusé tant
-- qu'un match libre existe — jamais une suppression silencieuse).
--
-- Ce qui ne change pas : les clés étrangères (venue_id, field_id) et la clé composite de la migration 0029 ignorent une valeur
-- NULL ; les déclencheurs d'isolation entre centres (0029) ne s'appliquent qu'à un match de centre ; l'immuabilité de venue_id
-- et field_id (0029) empêche un match libre de devenir un match de centre (ou l'inverse) après coup.

ALTER TABLE matches ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN field_id DROP NOT NULL;

ALTER TABLE matches
  ADD COLUMN place_name   text,
  ADD COLUMN place_area   text,
  ADD COLUMN place_wilaya text;

-- Un match a un centre ET un terrain, OU un lieu libre — jamais les deux, jamais aucun. Un match libre n'a ni réservation, ni
-- défi (un défi se joue chez un centre), ni prix.
ALTER TABLE matches ADD CONSTRAINT matches_place_kind CHECK (
  (venue_id IS NOT NULL AND field_id IS NOT NULL AND place_name IS NULL AND place_area IS NULL AND place_wilaya IS NULL)
  OR
  (venue_id IS NULL AND field_id IS NULL AND booking_id IS NULL AND challenge_id IS NULL
   AND place_name IS NOT NULL AND place_wilaya IS NOT NULL AND price_per_player_da = 0)
);

-- Longueurs : les mêmes bornes que la règle du core (createFreeMatch) — la base reste l'arbitre final.
ALTER TABLE matches ADD CONSTRAINT matches_place_lengths CHECK (
  (place_name IS NULL OR char_length(place_name) BETWEEN 2 AND 80)
  AND (place_area IS NULL OR char_length(place_area) <= 60)
  AND (place_wilaya IS NULL OR char_length(place_wilaya) BETWEEN 2 AND 40)
);
