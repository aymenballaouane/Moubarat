-- Le ROI d'un code promo (revenu généré vs remise accordée) exige de savoir
-- QUELLE réservation a utilisé QUEL code, et pour quel montant de remise —
-- absent du schéma gelé (promo_codes existe, mais bookings n'y référence
-- jamais). Migration additive (mécanisme déjà établi, tranche CRM Analytics
-- + Caisse, module Promos, docs/DECISIONS.md).
ALTER TABLE bookings
  ADD COLUMN promo_code_id uuid REFERENCES promo_codes(id),
  ADD COLUMN discount_da integer NOT NULL DEFAULT 0 CHECK (discount_da >= 0),
  ADD CONSTRAINT discount_only_with_promo
    CHECK (discount_da = 0 OR promo_code_id IS NOT NULL);
