-- Chantier iOS (04/09/2026), volet serveur du push : un jeton d'appareil
-- (APNs) par ligne. Le jeton est la clé : un appareil n'appartient qu'à un
-- compte à la fois — un autre joueur qui se connecte sur le même téléphone
-- REPREND le jeton (upsert sur token), jamais deux comptes notifiés sur le
-- même appareil. Table additive, schéma gelé intact.
CREATE TABLE push_devices (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user ON push_devices (user_id);
