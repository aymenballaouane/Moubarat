-- Lot 3 (création de réservation par clic dans le Planning, 15/09/2026) —
-- décision Aymen : téléphone en texte libre sur une réservation Comptoir/
-- Téléphone créée depuis le CRM, jamais lié à un vrai compte joueur (users).
-- Additive, nullable (une réservation MOUBARAT n'en a pas besoin — le joueur
-- a déjà un compte), schéma gelé intact.
ALTER TABLE bookings ADD COLUMN customer_phone text;
