-- Refonte app joueur, lot 7 (règle 3, NOUVELLE — « une seule place par joueur, on choisit son équipe, sa paire au padel »,
-- changement d'équipe tant que les inscriptions sont ouvertes) : l'équipe (A ou B) de chaque inscrit.
--
-- Colonne additive, nullable : une ligne sans équipe reste valide (inscrit d'avant la règle, ou écrit par un script qui ne la
-- connaît pas) — elle compte dans le match mais dans aucune équipe. Le CORE reste l'arbitre (places par équipe = moitié de la
-- capacité, packages/core rules/match.ts) ; la base ne porte que la contrainte d'intégrité (A ou B).
--
-- Rattrapage des inscrits ACTIFS existants (aucune donnée supprimée ni modifiée, uniquement la nouvelle colonne) : l'organisateur
-- ouvre l'équipe A, puis les inscrits suivants (par ordre d'inscription) alternent B, A, B… — la même répartition que la
-- maquette (A0 B0 A1 B1…), donc jamais plus de la moitié de la capacité dans une équipe tant que le match n'a pas dépassé sa
-- capacité (ce que le core interdit déjà). Un match issu d'un défi a deux inscrits : capitaine émetteur A, accepteur B.
ALTER TABLE match_players
  ADD COLUMN team text CHECK (team IN ('A', 'B'));

UPDATE match_players mp
   SET team = CASE WHEN ranked.rn % 2 = 1 THEN 'A' ELSE 'B' END
  FROM (
    SELECT p.match_id, p.user_id,
           row_number() OVER (PARTITION BY p.match_id ORDER BY (p.user_id = m.organizer_id) DESC, p.joined_at, p.user_id) AS rn
      FROM match_players p
      JOIN matches m ON m.id = p.match_id
     WHERE p.status = 'JOINED'
  ) ranked
 WHERE mp.match_id = ranked.match_id AND mp.user_id = ranked.user_id;
