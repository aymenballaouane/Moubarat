-- Audit général (07-08/09/2026), finding D2 — le module Caisse était géré par
-- un état React purement local (`modulesCaisse`, App.tsx), jamais persisté :
-- remis à `false` à chaque rechargement, invisible à toute autre session que
-- celle qui vient de l'activer. Un compte RECEPTION (qui a bien la permission
-- CASH_SESSION) ne pouvait donc jamais atteindre l'écran en pratique. Colonne
-- persistée, lue par tous à la connexion, modifiable par Manager+ (EDIT_PROFILE,
-- même permission qui verrouillait déjà le bouton). Additive, schéma gelé intact.
ALTER TABLE venues ADD COLUMN cash_module_enabled boolean NOT NULL DEFAULT false;
