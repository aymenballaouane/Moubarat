-- Audit général (07/09/2026), finding S1 — la référence de réservation
-- (« RYD-0482 ») dérivait d'un COUNT(*) de tout l'historique du centre, lu
-- hors transaction, puis rattrapé par cinq essais sur la contrainte UNIQUE :
-- six créations simultanées épuisaient les essais (500 sur un créneau libre)
-- et chaque création parcourait toute la table. Une vraie séquence par
-- centre, incrémentée sous verrou de ligne dans la transaction de l'INSERT
-- (modules/bookings/service.ts). Additive, schéma gelé intact.
ALTER TABLE venues ADD COLUMN booking_seq integer NOT NULL DEFAULT 0;

-- Continuité de la numérotation : la séquence repart du nombre de
-- réservations déjà existantes de chaque centre (c'est exactement le
-- « n » que le COUNT(*) aurait renvoyé), jamais de zéro.
UPDATE venues v SET booking_seq = (
  SELECT count(*) FROM bookings b JOIN fields f ON f.id = b.field_id WHERE f.venue_id = v.id
);
