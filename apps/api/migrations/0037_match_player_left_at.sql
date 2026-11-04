-- Règle 4 (MODIFIÉE, 26/10/2026 — trois temps) : partir d'un match entre H-2 et H-1 compte comme une demi-absence.
-- Pour la compter (fiabilité, Lot 10) il faut savoir QUAND l'inscrit est parti : `left_at`, posé au départ (LEFT), remis à NULL s'il se réinscrit.
-- Additive : aucune donnée touchée ; les départs antérieurs restent à NULL (inconnus, jamais comptés comme tardifs).
ALTER TABLE match_players ADD COLUMN left_at timestamptz;
