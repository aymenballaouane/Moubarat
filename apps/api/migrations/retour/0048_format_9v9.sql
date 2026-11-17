-- RETOUR ARRIÈRE de la migration 0048 (format 9v9). Jamais appliqué par le migrateur (il ne lit que migrations/*.sql) : à exécuter
-- À LA MAIN, une seule fois, avec psql, après avoir redéployé un code d'API d'avant la phase 9v9.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/retour/0048_format_9v9.sql
--
-- PostgreSQL ne sait pas retirer une valeur d'un type énuméré : le type est recréé sans le 9v9, puis chaque colonne qui l'utilise
-- (seule ou en tableau, trouvées dans le catalogue) y est convertie. Le script REFUSE de s'exécuter tant qu'une ligne utilise encore
-- le 9v9 (un terrain qui le propose, un tarif, une réservation, un match…) : rien n'est supprimé en silence. Décider d'abord, avec
-- Aymen, du sort de ces lignes (retirer le format des terrains dans le CRM, par exemple).

BEGIN;

DO $$
DECLARE col record; n bigint; total bigint := 0;
BEGIN
  FOR col IN
    SELECT c.relname AS tbl, a.attname AS att, (t.typname = '_match_format') AS is_array
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = current_schema()
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname IN ('match_format', '_match_format')
    WHERE a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF col.is_array THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE %I @> ARRAY[''9v9'']::match_format[]', col.tbl, col.att) INTO n;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I WHERE %I = ''9v9''', col.tbl, col.att) INTO n;
    END IF;
    IF n > 0 THEN RAISE NOTICE '%.% : % ligne(s) en 9v9', col.tbl, col.att, n; END IF;
    total := total + n;
  END LOOP;
  IF total > 0 THEN
    RAISE EXCEPTION 'Retour arrière de 0048 refusé : % ligne(s) utilisent encore le format 9v9 (détail ci-dessus). Décider de leur sort avant de relancer.', total;
  END IF;
END $$;

ALTER TYPE match_format RENAME TO match_format_avant_retour;
CREATE TYPE match_format AS ENUM ('5v5','6v6','7v7','8v8','11v11','DOUBLE','SIMPLE','3v3');

DO $$
DECLARE col record;
BEGIN
  FOR col IN
    SELECT c.relname AS tbl, a.attname AS att, (t.typname = '_match_format_avant_retour') AS is_array
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = current_schema()
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname IN ('match_format_avant_retour', '_match_format_avant_retour')
    WHERE a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF col.is_array THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE match_format[] USING %I::text[]::match_format[]', col.tbl, col.att, col.att);
    ELSE
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE match_format USING %I::text::match_format', col.tbl, col.att, col.att);
    END IF;
  END LOOP;
END $$;

DROP TYPE match_format_avant_retour;
DELETE FROM schema_migrations WHERE name = '0048_format_9v9';

COMMIT;
