-- Chantier iOS (04/09/2026), suppression de compte (Apple 5.1.1(v)) — décision
-- d'Aymen : ANONYMISATION, pas effacement dur, pour préserver l'historique
-- de caisse des centres (bookings/payments gardent leur by_user_id). La
-- ligne users reste ; identité remplacée (voir modules/account/routes.ts) ;
-- cette colonne marque le moment de la demande. Additive, schéma gelé intact.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
