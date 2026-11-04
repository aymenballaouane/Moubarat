-- Demandes d'inscription d'un centre (20/09/2026, demande d'Aymen) : un centre remplit un
-- formulaire PUBLIC (aucun compte) ; la demande atterrit ici, JAMAIS directement dans `venues`
-- (un centre exige une latitude/longitude qu'un formulaire public ne peut pas fournir, et du
-- spam ne doit pas polluer la liste des vrais centres). Le superadmin la convertit en centre en
-- un clic (venue_id renseigné), ou la refuse. Migration additive : rien du schéma gelé n'est modifié.
--
-- Données personnelles (nom, téléphone, email d'un contact) : consentement horodaté obligatoire ;
-- l'adresse IP n'est JAMAIS stockée en clair (empreinte SHA-256 seulement). Politique de
-- conservation / purge des demandes refusées ou non traitées : NON tranchée, à fixer avant que le
-- volume grandisse (voir docs/DECISIONS.md, 20/09/2026).
CREATE TABLE venue_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONVERTED', 'REJECTED')),
  name          text NOT NULL,
  wilaya        text NOT NULL,
  address       text NOT NULL,
  contact_name  text NOT NULL,
  contact_phone text NOT NULL,
  contact_email text NOT NULL,
  sports        text[] NOT NULL CHECK (cardinality(sports) BETWEEN 1 AND 3 AND sports <@ ARRAY['FOOTBALL', 'PADEL', 'BASKET']),
  fields_count  integer CHECK (fields_count IS NULL OR fields_count BETWEEN 1 AND 100),
  message       text,
  consent_at    timestamptz NOT NULL,
  ip_hash       text NOT NULL,
  venue_id      uuid REFERENCES venues(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decided_by    uuid REFERENCES platform_accounts(id) ON DELETE SET NULL
);

CREATE INDEX venue_requests_status_created ON venue_requests (status, created_at DESC);
CREATE INDEX venue_requests_email_recent ON venue_requests (lower(contact_email), created_at DESC);
CREATE INDEX venue_requests_phone_recent ON venue_requests (contact_phone, created_at DESC);
