-- Audit produit 22/09/2026 (cadrage multi-centre/scalabilité, finding F1) — la référence de réservation
-- (« COM-0009 ») dérivait le préfixe du NOM DU CENTRE À CHAQUE CRÉATION, et le numéro était limité à 4
-- chiffres (10 000). Deux défauts réels à l'échelle de 15 centres : (a) deux centres dont le nom donne le
-- même préfixe de 3 lettres se disputent les mêmes numéros (absorbé jusqu'ici par un rattrapage sur
-- SAVEPOINT, coûteux et fragile passé quelques collisions) ; (b) renommer un centre changeait le préfixe
-- des PROCHAINES références sans toucher les anciennes, une incohérence visible pour le gérant. Décision
-- Aymen (22/09/2026) : un code fixe, attribué UNE FOIS à la création, unique par construction, qui ne
-- change plus jamais même si le centre est renommé. Additive, schéma gelé intact.
ALTER TABLE venues ADD COLUMN booking_prefix text;

-- Défaut de secours pour tout INSERT qui ne fournit PAS booking_prefix explicitement (aujourd'hui : les
-- venues créées directement en base par les tests, hors de la route superadmin qui, elle, en calcule
-- toujours un — voir platform/venues/routes.ts). 3 lettres déterministes tirées d'une séquence dédiée
-- (26³ = 17 576 combinaisons), jamais un nom à deviner : sans ce défaut, chacun des ~11 fichiers de test qui
-- insèrent une venue « brute » aurait dû être modifié un par un pour fournir une valeur, pour un champ dont
-- la valeur exacte ne leur importe pas.
CREATE SEQUENCE venues_booking_prefix_seq;
CREATE FUNCTION next_booking_prefix() RETURNS text AS $BODY$
DECLARE n bigint := nextval('venues_booking_prefix_seq') - 1;
BEGIN
  RETURN chr(65 + ((n / 676) % 26)::int) || chr(65 + ((n / 26) % 26)::int) || chr(65 + (n % 26)::int);
END;
$BODY$ LANGUAGE plpgsql;
ALTER TABLE venues ALTER COLUMN booking_prefix SET DEFAULT next_booking_prefix();

-- Rétrocompatibilité : chaque centre existant reçoit le préfixe qu'il aurait aujourd'hui (même dérivation
-- que l'ancien bookingReference), en réglant les collisions par une fenêtre glissante sur les lettres du
-- nom, puis par un balayage exhaustif si le nom n'offre vraiment aucune fenêtre libre (jamais atteint pour
-- un nom de centre réel, mais garanti de terminer). Les deux centres réels connus à ce jour (Complexe Ryad,
-- Green Arena Sport) ne se disputent aucun préfixe.
DO $$
DECLARE
  v RECORD;
  letters text;
  candidate text;
  i integer;
  a integer; b integer; c integer;
BEGIN
  FOR v IN SELECT id, name FROM venues ORDER BY created_at, id LOOP
    letters := upper(regexp_replace(v.name, '[^A-Za-z]', '', 'g'));
    IF length(letters) < 3 THEN
      letters := rpad(letters, 3, 'X');
    END IF;

    candidate := NULL;
    -- 1) fenêtres glissantes de 3 lettres consécutives dans le nom (patron d'origine = fenêtre 0).
    FOR i IN 0 .. length(letters) - 3 LOOP
      IF NOT EXISTS (SELECT 1 FROM venues WHERE booking_prefix = substring(letters FROM i + 1 FOR 3)) THEN
        candidate := substring(letters FROM i + 1 FOR 3);
        EXIT;
      END IF;
    END LOOP;

    -- 2) balayage exhaustif (A..Z)^3 si vraiment aucune fenêtre du nom n'est libre — filet de sécurité,
    --    jamais requis en pratique pour un nom de centre réel.
    IF candidate IS NULL THEN
      FOR a IN 0 .. 25 LOOP
        FOR b IN 0 .. 25 LOOP
          FOR c IN 0 .. 25 LOOP
            candidate := chr(65 + a) || chr(65 + b) || chr(65 + c);
            IF NOT EXISTS (SELECT 1 FROM venues WHERE booking_prefix = candidate) THEN
              EXIT;
            ELSE
              candidate := NULL;
            END IF;
          END LOOP;
          EXIT WHEN candidate IS NOT NULL;
        END LOOP;
        EXIT WHEN candidate IS NOT NULL;
      END LOOP;
    END IF;

    UPDATE venues SET booking_prefix = candidate WHERE id = v.id;
  END LOOP;
END $$;

ALTER TABLE venues ALTER COLUMN booking_prefix SET NOT NULL;
ALTER TABLE venues ADD CONSTRAINT venues_booking_prefix_format CHECK (booking_prefix ~ '^[A-Z]{3}$');
ALTER TABLE venues ADD CONSTRAINT venues_booking_prefix_unique UNIQUE (booking_prefix);
