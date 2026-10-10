-- Unqualified names use the connection's search_path (public by default).
-- Test connections use a newly generated isolated schema.
CREATE TABLE IF NOT EXISTS arviva_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS arviva_verification_challenges (
  email text PRIMARY KEY,
  challenge_id uuid NOT NULL UNIQUE,
  code_digest text NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'consumed', 'failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  delivered_at timestamptz
);

CREATE TABLE IF NOT EXISTS arviva_auth_events (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('send', 'verify')),
  email_digest text NOT NULL CHECK (email_digest ~ '^[a-f0-9]{64}$'),
  ip_digest text NOT NULL CHECK (ip_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS arviva_auth_events_email_idx ON arviva_auth_events (kind, email_digest, created_at);
CREATE INDEX IF NOT EXISTS arviva_auth_events_ip_idx ON arviva_auth_events (kind, ip_digest, created_at);

CREATE TABLE IF NOT EXISTS arviva_sessions (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES arviva_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS arviva_sessions_user_idx ON arviva_sessions (user_id);
CREATE INDEX IF NOT EXISTS arviva_sessions_expiry_idx ON arviva_sessions (expires_at);

CREATE TABLE IF NOT EXISTS arviva_product_entitlements (
  user_id uuid NOT NULL REFERENCES arviva_users(id) ON DELETE CASCADE,
  product_id text NOT NULL CHECK (product_id IN ('module-01', 'module-02')),
  trial_used_at timestamptz,
  paid boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS arviva_product_grants (
  token_digest text NOT NULL REFERENCES arviva_sessions(token_digest) ON DELETE CASCADE,
  product_id text NOT NULL CHECK (product_id IN ('module-01', 'module-02')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (token_digest, product_id)
);
CREATE INDEX IF NOT EXISTS arviva_product_grants_expiry_idx ON arviva_product_grants (expires_at);
