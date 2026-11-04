-- SUPERADMIN V1 : sessions plateforme, miroir exact de `sessions` (Player)
-- mais entièrement indépendantes — guard séparé, jamais dans resolveSession().
CREATE TABLE platform_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX platform_sessions_active ON platform_sessions (account_id) WHERE revoked_at IS NULL;
