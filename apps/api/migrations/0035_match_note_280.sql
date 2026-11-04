-- Refonte app joueur, lot 7 (maquette MotAuxJoueurs.dc.html) : l'écran « Ton mot aux joueurs » compte jusqu'à 280 signes (« 139 / 280 »),
-- pas 140 comme la première version de la colonne (0033, lot 6, écrite avant d'avoir lu cette maquette). Le plafond de la colonne suit.
-- Aucune donnée touchée : seul le CHECK est remplacé, par un plafond plus large.
ALTER TABLE matches DROP CONSTRAINT matches_note_check;
ALTER TABLE matches ADD CONSTRAINT matches_note_len CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 280);
