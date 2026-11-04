-- Règle 21 (Réservation prise par téléphone, « C'est bien toi ? » — décisions d'Aymen du 26/10/2026).
-- Le centre saisit un nom et un numéro ; si ce numéro est celui d'un compte joueur, la réservation s'y RATTACHE, en attente de sa réponse :
--   claimed_user_id    le compte rattaché par le numéro (NULL : numéro inconnu, ou réservation sans numéro) ;
--   claim_status       PENDING (en attente) · CONFIRMED (« C'est moi » : la réservation passe à son nom, `by_user_id`) · DECLINED (« Ce n'est pas moi ») ;
--   claim_reminded_at  le rappel de la veille est parti (une seule fois).
-- Tant qu'elle est PENDING ou DECLINED, la réservation reste au nom du centre (`by_user_id` inchangé) : aucune absence, aucune annulation ne concerne le joueur.
-- Additive : aucune donnée touchée.
ALTER TABLE bookings ADD COLUMN claimed_user_id uuid REFERENCES users(id);
ALTER TABLE bookings ADD COLUMN claim_status text CHECK (claim_status IN ('PENDING', 'CONFIRMED', 'DECLINED'));
ALTER TABLE bookings ADD COLUMN claim_reminded_at timestamptz;
ALTER TABLE bookings ADD CONSTRAINT bookings_claim_consistent CHECK ((claimed_user_id IS NULL) = (claim_status IS NULL));
CREATE INDEX bookings_pending_claims ON bookings (claimed_user_id) WHERE claim_status = 'PENDING';
