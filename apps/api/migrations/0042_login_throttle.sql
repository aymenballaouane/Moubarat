-- Décision d'Aymen 27/10/2026 : plus de verrou de 15 minutes sur le compte d'un joueur après 5 essais ratés — n'importe qui, avec un pseudo PUBLIC,
-- pouvait ainsi empêcher le vrai joueur de se connecter. À la place : un RALENTISSEMENT progressif (le délai double à chaque échec), compté par
-- (identifiant tapé, adresse de l'appelant) : un inconnu qui s'acharne se ralentit LUI-MÊME, le joueur légitime — qui n'écrit pas depuis la même
-- adresse — n'est jamais retardé par ses essais. La clé est l'empreinte de l'identifiant tapé (numéro normalisé ou pseudo replié), qu'il existe ou non :
-- un identifiant inconnu est ralenti exactement comme un identifiant réel (aucun oracle d'existence). Jamais d'adresse ni d'identifiant en clair.
-- Additive.
CREATE TABLE login_throttle (
  key             text        NOT NULL,
  ip_hash         text        NOT NULL,
  failures        integer     NOT NULL CHECK (failures >= 0),
  next_allowed_at timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, ip_hash)
);
-- Sert la purge opportuniste (lignes inactives depuis plus d'une journée).
CREATE INDEX login_throttle_updated ON login_throttle (updated_at);
