-- Refonte app joueur, lot 7 (LienMatch.dc.html, règle 6 « un match sur invitation n'est accessible que par son lien ») : le code court d'un match,
-- celui du lien « moubaratsport.com/m/CODE » que l'organisateur partage.
--
-- Colonne additive, générée PAR LA BASE (valeur par défaut) : tout chemin qui écrit un match — l'API, l'acceptation d'un défi, les scripts de démo, les tests —
-- en reçoit un sans rien changer. 6 signes d'un alphabet sans I, O, 0, 1 (32^6 ≈ 10⁹) : un match « sur invitation » ne doit pas se deviner en essayant des
-- codes ; si l'espace se remplissait un jour, le générateur allonge le code de lui-même. Les matchs existants reçoivent leur code ici.
CREATE OR REPLACE FUNCTION moubarat_new_match_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  len int := 6;
  tries int := 0;
  candidate text;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..len LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM matches WHERE code = candidate) THEN
      RETURN candidate;
    END IF;
    tries := tries + 1;
    IF tries >= 20 THEN len := len + 1; tries := 0; END IF;
  END LOOP;
END
$$;

ALTER TABLE matches ADD COLUMN code text;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM matches WHERE code IS NULL LOOP
    UPDATE matches SET code = moubarat_new_match_code() WHERE id = r.id;
  END LOOP;
END
$$;

ALTER TABLE matches ALTER COLUMN code SET DEFAULT moubarat_new_match_code();
ALTER TABLE matches ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX matches_code_key ON matches (code);
