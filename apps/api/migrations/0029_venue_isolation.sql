-- Isolation entre centres, garantie PAR LA BASE (audit juridique et technique du 25/09/2026, P0-4a — demande d'Aymen).
--
-- Constat : « ce terrain est de ce centre » n'était vérifié que route par route, dans le code. Le déplacement d'une
-- réservation l'avait oublié : un membre du centre A pouvait la déplacer sur le terrain du centre B. Ici, la base refuse,
-- quel que soit le code qui tente d'écrire — celui d'aujourd'hui comme un bug futur. C'est une contrainte d'INTÉGRITÉ
-- (la base est l'arbitre final, comme pour `no_double_booking`), pas une règle métier : elle n'exprime aucune politique,
-- seulement « deux lignes liées appartiennent au même centre ».
--
-- Trois mécanismes, chacun là où il est le plus fort (docs/DECISIONS.md, 25/09/2026) :
--   A. CLÉ ÉTRANGÈRE COMPOSITE (déclarative, appliquée par le moteur) là où la table porte déjà DEUX colonnes de centre :
--      matches, challenges, closures  →  (field_id, venue_id) référence fields (id, venue_id).
--   B. TRIGGERS là où le centre n'est atteignable que par une jointure (une réservation n'a pas de colonne de centre :
--      son centre EST celui de son terrain) ou par une référence polymorphe (ratings) ou un tableau (promo_codes.field_ids).
--   C. IMMUABILITÉ du rattachement : une fois posée, la colonne qui dit « à quel centre / quel terrain » ne change plus
--      (`UPDATE fields SET venue_id = …` déplacerait en silence toutes les réservations d'un terrain vers un autre centre).
--
-- Invariant supplémentaire demandé par Aymen : un match se joue sur le terrain de sa réservation.
--
-- Erreurs : SQLSTATE 23514 (check_violation) et message « VENUE_ISOLATION: … » pour les triggers ; 23503
-- (foreign_key_violation) sur une contrainte `*_venue_fk` pour les clés composites. L'API les journalise sous
-- l'événement `venue_isolation_violation` (server.ts) — atteindre l'une d'elles est un BUG du code appelant.
--
-- Contournement possible, à connaître : un super-utilisateur peut désactiver les triggers (`session_replication_role =
-- replica`, restauration, réplication logique). Vrai aussi des clés étrangères, qui sont elles-mêmes des triggers internes.
-- Le rôle de l'API ne doit pas avoir ce droit (docs/PASSATION.md §4.11).
--
-- Additif, schéma gelé intact. Tables minuscules à l'échelle du pilote ; les clés sont posées NOT VALID puis validées
-- (verrou plus faible sur une grosse table).

-- ---------------------------------------------------------------- 0. pré-contrôle : refuser net si la base viole déjà un invariant
DO $$
DECLARE
  n_matches_field int; n_challenges_field int; n_challenges_partial int; n_closures_field int;
  n_booking_promo int; n_booking_match_venue int; n_booking_match_field int; n_match_booking_field int;
  n_challenge_match int; n_rating_venue int; n_promo_fields int;
BEGIN
  SELECT count(*) INTO n_matches_field FROM matches m JOIN fields f ON f.id = m.field_id WHERE f.venue_id <> m.venue_id;
  SELECT count(*) INTO n_challenges_field FROM challenges c JOIN fields f ON f.id = c.field_id WHERE c.venue_id IS DISTINCT FROM f.venue_id;
  SELECT count(*) INTO n_challenges_partial FROM challenges WHERE (field_id IS NULL) <> (venue_id IS NULL);
  SELECT count(*) INTO n_closures_field FROM closures c JOIN fields f ON f.id = c.field_id WHERE f.venue_id <> c.venue_id;
  SELECT count(*) INTO n_booking_promo FROM bookings b JOIN fields f ON f.id = b.field_id JOIN promo_codes p ON p.id = b.promo_code_id WHERE p.venue_id <> f.venue_id;
  SELECT count(*) INTO n_booking_match_venue FROM bookings b JOIN fields f ON f.id = b.field_id JOIN matches m ON m.id = b.match_id WHERE m.venue_id <> f.venue_id;
  SELECT count(*) INTO n_booking_match_field FROM bookings b JOIN matches m ON m.id = b.match_id WHERE m.field_id <> b.field_id;
  SELECT count(*) INTO n_match_booking_field FROM matches m JOIN bookings b ON b.id = m.booking_id WHERE b.field_id <> m.field_id;
  SELECT count(*) INTO n_challenge_match FROM challenges c JOIN matches m ON m.id = c.match_id WHERE c.venue_id IS NOT NULL AND m.venue_id <> c.venue_id;
  SELECT count(*) INTO n_rating_venue FROM ratings r JOIN matches m ON m.id = r.match_id WHERE r.target_type = 'VENUE' AND r.target_id <> m.venue_id;
  SELECT count(*) INTO n_promo_fields FROM promo_codes p, unnest(p.field_ids) fid
    WHERE NOT EXISTS (SELECT 1 FROM fields f WHERE f.id = fid AND f.venue_id = p.venue_id);
  IF n_matches_field + n_challenges_field + n_challenges_partial + n_closures_field + n_booking_promo + n_booking_match_venue
     + n_booking_match_field + n_match_booking_field + n_challenge_match + n_rating_venue + n_promo_fields > 0 THEN
    RAISE EXCEPTION 'Migration 0029 refusée : des lignes existantes violent l''isolation entre centres — matches/terrain %, défis/terrain %, défis à moitié renseignés %, fermetures/terrain %, réservations/promo %, réservations/match (centre) %, réservations/match (terrain) %, matchs/réservation (terrain) %, défis/match %, notes de centre %, promos/terrains %. Corriger ces lignes (à la main, avec le centre concerné) avant de relancer.',
      n_matches_field, n_challenges_field, n_challenges_partial, n_closures_field, n_booking_promo, n_booking_match_venue,
      n_booking_match_field, n_match_booking_field, n_challenge_match, n_rating_venue, n_promo_fields;
  END IF;
END $$;

-- ---------------------------------------------------------------- A. clés étrangères composites
-- Cible commune : un terrain ET son centre, ensemble. `id` étant déjà la clé primaire, l'unicité (id, venue_id) est
-- automatique ; il faut seulement la DÉCLARER pour qu'une clé étrangère puisse la référencer.
ALTER TABLE fields ADD CONSTRAINT fields_id_venue_key UNIQUE (id, venue_id);

ALTER TABLE matches ADD CONSTRAINT matches_field_venue_fk
  FOREIGN KEY (field_id, venue_id) REFERENCES fields (id, venue_id) NOT VALID;
ALTER TABLE matches VALIDATE CONSTRAINT matches_field_venue_fk;

-- MATCH FULL : (terrain ET centre) ou (ni l'un ni l'autre) — jamais un terrain sans centre.
ALTER TABLE challenges ADD CONSTRAINT challenges_field_venue_fk
  FOREIGN KEY (field_id, venue_id) REFERENCES fields (id, venue_id) MATCH FULL NOT VALID;
ALTER TABLE challenges VALIDATE CONSTRAINT challenges_field_venue_fk;

-- field_id NULL = « tout le centre » : la clé n'est alors pas évaluée (MATCH SIMPLE), le centre reste NOT NULL.
ALTER TABLE closures ADD CONSTRAINT closures_field_venue_fk
  FOREIGN KEY (field_id, venue_id) REFERENCES fields (id, venue_id) NOT VALID;
ALTER TABLE closures VALIDATE CONSTRAINT closures_field_venue_fk;

-- ---------------------------------------------------------------- B. triggers de cohérence
-- Un seul point de sortie d'erreur, pour que l'API les reconnaisse (préfixe stable « VENUE_ISOLATION: »).
CREATE FUNCTION venue_isolation_violation(what text, detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VENUE_ISOLATION: %', what USING ERRCODE = 'check_violation', DETAIL = detail;
END $$;

-- Réservation : son centre n'existe que par son terrain. Elle ne change jamais de centre, sa promo et son match sont de
-- son centre, et un match rattaché se joue sur SON terrain (donc son terrain ne change plus une fois le match créé).
CREATE FUNCTION bookings_venue_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_new uuid; v_old uuid; v_other uuid; m_field uuid;
BEGIN
  SELECT venue_id INTO v_new FROM fields WHERE id = NEW.field_id;
  IF TG_OP = 'UPDATE' AND NEW.field_id IS DISTINCT FROM OLD.field_id THEN
    SELECT venue_id INTO v_old FROM fields WHERE id = OLD.field_id;
    IF v_old IS DISTINCT FROM v_new THEN
      PERFORM venue_isolation_violation('une réservation ne change jamais de centre',
        format('réservation %s : terrain %s (centre %s) → terrain %s (centre %s)', NEW.id, OLD.field_id, v_old, NEW.field_id, v_new));
    END IF;
    IF NEW.match_id IS NOT NULL THEN
      PERFORM venue_isolation_violation('le terrain d''une réservation ne change plus une fois son match créé',
        format('réservation %s, match %s', NEW.id, NEW.match_id));
    END IF;
  END IF;
  IF NEW.promo_code_id IS NOT NULL THEN
    SELECT venue_id INTO v_other FROM promo_codes WHERE id = NEW.promo_code_id;
    IF v_other IS DISTINCT FROM v_new THEN
      PERFORM venue_isolation_violation('le code promo d''une réservation est de son centre',
        format('réservation %s (centre %s), promo %s (centre %s)', NEW.id, v_new, NEW.promo_code_id, v_other));
    END IF;
  END IF;
  IF NEW.match_id IS NOT NULL THEN
    SELECT venue_id, field_id INTO v_other, m_field FROM matches WHERE id = NEW.match_id;
    IF v_other IS DISTINCT FROM v_new THEN
      PERFORM venue_isolation_violation('le match d''une réservation est de son centre',
        format('réservation %s (centre %s), match %s (centre %s)', NEW.id, v_new, NEW.match_id, v_other));
    END IF;
    IF m_field IS DISTINCT FROM NEW.field_id THEN
      PERFORM venue_isolation_violation('un match se joue sur le terrain de sa réservation',
        format('réservation %s (terrain %s), match %s (terrain %s)', NEW.id, NEW.field_id, NEW.match_id, m_field));
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- `UPDATE OF` : ne se déclenche pas sur un simple changement de statut (le chemin chaud).
CREATE TRIGGER bookings_venue_guard BEFORE INSERT OR UPDATE OF field_id, promo_code_id, match_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_venue_guard();

-- Match : la réservation dont il vient est sur SON terrain (ce qui, avec la clé composite ci-dessus, implique le même centre).
CREATE FUNCTION matches_booking_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b_field uuid;
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    SELECT field_id INTO b_field FROM bookings WHERE id = NEW.booking_id;
    IF b_field IS DISTINCT FROM NEW.field_id THEN
      PERFORM venue_isolation_violation('un match se joue sur le terrain de sa réservation',
        format('match %s (terrain %s), réservation %s (terrain %s)', NEW.id, NEW.field_id, NEW.booking_id, b_field));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matches_booking_guard BEFORE INSERT OR UPDATE OF booking_id, field_id ON matches
  FOR EACH ROW EXECUTE FUNCTION matches_booking_guard();

-- Défi : le match issu du défi est du centre du défi (quand le défi en a un).
CREATE FUNCTION challenges_match_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m_venue uuid;
BEGIN
  IF NEW.match_id IS NOT NULL AND NEW.venue_id IS NOT NULL THEN
    SELECT venue_id INTO m_venue FROM matches WHERE id = NEW.match_id;
    IF m_venue IS DISTINCT FROM NEW.venue_id THEN
      PERFORM venue_isolation_violation('le match d''un défi est du centre du défi',
        format('défi %s (centre %s), match %s (centre %s)', NEW.id, NEW.venue_id, NEW.match_id, m_venue));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER challenges_match_guard BEFORE INSERT OR UPDATE OF match_id, venue_id ON challenges
  FOR EACH ROW EXECUTE FUNCTION challenges_match_guard();

-- Note d'un centre : la cible est le centre où le match s'est joué (référence polymorphe : aucune clé étrangère ne peut
-- l'exprimer, `target_id` désigne un joueur, un centre ou un match selon `target_type`).
CREATE FUNCTION ratings_venue_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m_venue uuid;
BEGIN
  IF NEW.target_type = 'VENUE' THEN
    SELECT venue_id INTO m_venue FROM matches WHERE id = NEW.match_id;
    IF m_venue IS DISTINCT FROM NEW.target_id THEN
      PERFORM venue_isolation_violation('la note d''un centre vise le centre du match noté',
        format('note %s : cible %s, match %s (centre %s)', NEW.id, NEW.target_id, NEW.match_id, m_venue));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ratings_venue_guard BEFORE INSERT OR UPDATE OF target_type, target_id, match_id ON ratings
  FOR EACH ROW EXECUTE FUNCTION ratings_venue_guard();

-- Promo : les terrains ciblés (tableau — aucune clé étrangère possible sur un tableau) sont TOUS du centre de la promo.
CREATE FUNCTION promo_codes_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.field_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.field_ids) AS fid
    WHERE NOT EXISTS (SELECT 1 FROM fields f WHERE f.id = fid AND f.venue_id = NEW.venue_id)
  ) THEN
    PERFORM venue_isolation_violation('les terrains d''une promo sont tous du centre de la promo',
      format('promo %s (centre %s), terrains %s', NEW.id, NEW.venue_id, NEW.field_ids));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promo_codes_fields_guard BEFORE INSERT OR UPDATE OF field_ids, venue_id ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION promo_codes_fields_guard();

-- ---------------------------------------------------------------- C. immuabilité du rattachement
-- Une fonction générique : la colonne à protéger est l'argument du trigger. Un « UPDATE … SET col = col » (sans
-- changement de valeur) passe ; seul un vrai changement est refusé.
CREATE FUNCTION forbid_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE col text := TG_ARGV[0];
BEGIN
  IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
    PERFORM venue_isolation_violation(format('%s.%s ne change jamais une fois posé', TG_TABLE_NAME, col),
      format('ligne %s : %s → %s', to_jsonb(OLD) ->> 'id', to_jsonb(OLD) ->> col, to_jsonb(NEW) ->> col));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fields_venue_immutable BEFORE UPDATE OF venue_id ON fields
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('venue_id');
CREATE TRIGGER matches_venue_immutable BEFORE UPDATE OF venue_id ON matches
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('venue_id');
CREATE TRIGGER matches_field_immutable BEFORE UPDATE OF field_id ON matches
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('field_id');
CREATE TRIGGER closures_venue_immutable BEFORE UPDATE OF venue_id ON closures
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('venue_id');
CREATE TRIGGER closures_field_immutable BEFORE UPDATE OF field_id ON closures
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('field_id');
CREATE TRIGGER promo_codes_venue_immutable BEFORE UPDATE OF venue_id ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('venue_id');
CREATE TRIGGER cash_sessions_venue_immutable BEFORE UPDATE OF venue_id ON cash_sessions
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('venue_id');
CREATE TRIGGER recurring_bookings_field_immutable BEFORE UPDATE OF field_id ON recurring_bookings
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('field_id');
CREATE TRIGGER pricing_rules_field_immutable BEFORE UPDATE OF field_id ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_owner_change('field_id');
