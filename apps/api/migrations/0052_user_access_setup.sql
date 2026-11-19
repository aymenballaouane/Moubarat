-- Lot B, phase 2 (18/11/2026, GO d'Aymen) : l'inscription courte d'un invité arrivé par le lien d'un match. Il donne son prénom, accepte
-- les accords (écran « Ton numéro », inchangé) et rejoint le match SANS mot de passe : il se reconnectera par code SMS (« Mot de passe
-- oublié »). Jusqu'ici, « pas de mot de passe » voulait dire « accès pas encore mis en place » (règles 28 à 30) ; cette colonne dit
-- désormais quand la passerelle d'accès a été franchie, avec ou sans mot de passe.
--   needsAccessSetup = password_hash IS NULL AND access_setup_at IS NULL
-- Aucune ligne existante n'est modifiée : un compte avec mot de passe n'a jamais besoin de la passerelle, un compte sans mot de passe
-- garde exactement le comportement d'avant. Retour arrière à la main : migrations/retour/0052_user_access_setup.sql.

ALTER TABLE users ADD COLUMN access_setup_at timestamptz;
