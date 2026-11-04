-- Refonte app joueur, lot 6 « Créer un match » (maquette Creer.dc.html, C1 « Un petit mot pour les joueurs ? ») :
-- le mot de l'organisateur, affiché aux joueurs sur la fiche du match (lot 7).
--
-- Jusqu'ici l'écran Créer un match proposait un champ « Description » que l'app n'envoyait jamais au serveur
-- (publishMatch ne l'envoyait pas) : le texte était perdu en silence. Colonne additive, nullable, aucun match
-- existant perturbé ; 140 signes au plus (même plafond que l'ancien champ). Texte brut, jamais interprété.
ALTER TABLE matches
  ADD COLUMN note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 140);
