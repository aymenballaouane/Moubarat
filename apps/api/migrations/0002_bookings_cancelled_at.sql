-- La formule canonique de fiabilité client (clientReliabilityV1, ops.ts)
-- distingue une annulation EARLY (>24h avant le coup d'envoi, neutre) d'une
-- LATE (<24h, pénalisée) via cancellationKind(bookingStartMs, cancelledAtMs).
-- Le schéma gelé ne trace pas QUAND une réservation a été annulée — sans cet
-- horodatage, cette distinction est incalculable pour de vraies données
-- (tranche CRM Analytics + Caisse, module Clients, docs/DECISIONS.md).
ALTER TABLE bookings
  ADD COLUMN cancelled_at timestamptz;
