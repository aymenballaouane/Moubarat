-- P1-12 de l'audit stratégique du CRM (15/11/2026, choix d'Aymen : « prix par séance », architecture « couche séances »).
-- Un abonnement (recurring_bookings, schéma gelé) réserve le même créneau chaque semaine ; ses séances sont calculées à la volée
-- par le core (recurringOccurrence) et n'avaient ni prix ni statut : hors du chiffre d'affaires, de la caisse et des no-shows.
-- Additive, sans toucher au schéma gelé ni au moteur de disponibilité :
--   price_per_session_da  le prix d'UNE séance (NULL : abonnement créé avant ce lot, sans prix — ses séances restent hors CA) ;
--   recurring_occurrences le statut d'une séance, écrit seulement quand le centre le pose (Honorée / Payée / No-show). Le prix y
--                         est FIGÉ à ce moment : changer ensuite le prix de l'abonnement ne réécrit pas l'historique.
-- Une séance sans ligne est « réservée » (à venir, ou passée et pas encore clôturée).
ALTER TABLE recurring_bookings ADD COLUMN price_per_session_da integer CHECK (price_per_session_da IS NULL OR price_per_session_da > 0);

CREATE TABLE recurring_occurrences (
  recurring_id    uuid NOT NULL REFERENCES recurring_bookings(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,          -- jour civil (Alger) où commence la séance
  status          text NOT NULL CHECK (status IN ('HONORED', 'PAID', 'NO_SHOW')),
  price_da        integer NOT NULL CHECK (price_da > 0),
  set_by          uuid NOT NULL,          -- compte du personnel (platform_accounts), comme bookings.by_user_id côté CRM
  set_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recurring_id, occurrence_date)
);
CREATE INDEX recurring_occurrences_by_date ON recurring_occurrences (occurrence_date);
