-- SUPERADMIN V1 : identité plateforme (email + mot de passe), séparée des
-- joueurs (users, téléphone + OTP) — jamais le même mécanisme, jamais la même
-- table. Un individu peut avoir les deux identités sans lien entre elles.
CREATE TABLE platform_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  name                  text NOT NULL,
  is_superadmin         boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
