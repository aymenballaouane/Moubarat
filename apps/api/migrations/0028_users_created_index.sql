-- Mise à l'échelle, lot L3 (25/09/2026) — liste paginée des joueurs de la console superadmin.
--
-- GET /platform/users lit désormais les joueurs page par page, plus récents d'abord (`ORDER BY created_at DESC, id DESC
-- LIMIT n+1`, curseur sur ce couple) : sans index, chaque page trierait les 100 000 joueurs pour n'en garder que 50.
-- L'index porte exactement le tri de la requête (départage par id compris), donc la première page comme les suivantes
-- lisent directement les lignes voulues dans l'ordre.
--
-- Additif, schéma gelé intact. Verrouille l'écriture de `users` le temps de la construction (fraction de seconde à
-- 100 000 lignes — voir docs/PASSATION.md §4.7).
CREATE INDEX users_created ON users (created_at DESC, id DESC);
