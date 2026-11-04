-- Unicité du nom d'affichage des joueurs (25/09/2026, décision d'Aymen).
--
-- Contexte. `users.name` est un vrai nom OU un pseudo, au choix du joueur, et sert aussi à CHERCHER et INVITER un
-- joueur (invitation d'équipe : aucun numéro de téléphone ne circule jamais entre joueurs). Pour qu'un nom désigne un
-- seul joueur, il doit être unique. Rien ne l'imposait : sur la base locale, 10 noms étaient partagés par 22 comptes.
--
-- Règle. Deux noms sont « le même » s'ils ne diffèrent que par la casse ou par les espaces (au début, à la fin ou
-- répétés) : « Karim Z. », « karim z. » et « KARIM   Z. » sont un seul nom. La clé de comparaison est calculée par UNE
-- fonction SQL, `display_name_key`, utilisée par l'index d'unicité ET par toutes les requêtes de l'API (recherche d'une
-- invitation, inscription, changement de nom) : la règle n'existe qu'à un seul endroit, l'index et le code ne peuvent
-- pas diverger. La casse est repliée avec ICU (« Éric » = « éric » quel que soit le réglage de langue de la base) :
-- un `lower()` simple ne replie que l'ASCII quand la base est créée avec la locale « C » (c'est le cas de la base
-- locale de développement), et l'unicité changerait alors d'un environnement à l'autre.
--
-- Comptes existants en doublon. Le PLUS ANCIEN garde son nom (date de création, puis identifiant). Les autres sont
-- MARQUÉS (`name_change_required`) : ils gardent leur nom tel quel jusqu'à leur prochaine connexion, où l'app leur
-- demande de choisir un autre nom (écran non contournable, comme le consentement aux CGU). Tant qu'ils n'ont pas
-- changé, un compte marqué n'occupe pas le nom (il est hors de l'index) et n'est pas trouvé par la recherche : c'est
-- le plus ancien que l'on trouve. Aucun nom n'est modifié en silence.
--
-- Comptes supprimés (`deleted_at`) : tous anonymisés sous le même nom « Joueur supprimé » — hors de l'index.
--
-- Additif, schéma gelé intact. Verrouille l'écriture de `users` le temps de la construction de l'index (fraction de
-- seconde à 100 000 lignes — voir docs/PASSATION.md §4.7).

-- ICU est requis par la clé de comparaison. Toute distribution courante de PostgreSQL 16 l'inclut ; sinon on
-- s'arrête ICI avec un message clair plutôt que de dégrader l'unicité sans le dire.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
    RAISE EXCEPTION 'ICU_REQUIRED : la collation "und-x-icu" est absente — PostgreSQL doit être compilé avec ICU (voir docs/PASSATION.md, unicité du nom d''affichage)';
  END IF;
END $$;

CREATE FUNCTION display_name_key(name text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT lower(regexp_replace(btrim(name), '\s+', ' ', 'g') COLLATE "und-x-icu") $$;

ALTER TABLE users ADD COLUMN name_change_required boolean NOT NULL DEFAULT false;

-- Le plus ancien de chaque groupe garde son nom, les suivants sont marqués.
UPDATE users u SET name_change_required = true
  FROM (
    SELECT id, row_number() OVER (PARTITION BY display_name_key(name) ORDER BY created_at, id) AS rn
      FROM users
     WHERE deleted_at IS NULL
  ) d
 WHERE u.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX users_display_name_uq ON users (display_name_key(name))
  WHERE deleted_at IS NULL AND NOT name_change_required;
