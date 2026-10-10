-- Extend identities without changing existing user IDs, sessions or entitlements.
ALTER TABLE arviva_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE arviva_users ADD COLUMN phone text UNIQUE
  CHECK (phone ~ '^\+861[3-9][0-9]{9}$');
ALTER TABLE arviva_users ADD CONSTRAINT arviva_users_identity_required
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Keep existing email challenges intact, including already delivered codes.
CREATE TABLE arviva_phone_verification_challenges (
  phone text PRIMARY KEY CHECK (phone ~ '^\+861[3-9][0-9]{9}$'),
  challenge_id uuid NOT NULL UNIQUE,
  code_digest text NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'consumed', 'failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  delivered_at timestamptz
);

-- One ledger preserves shared IP limits across email and SMS. Only keyed
-- digests enter this ledger; each event belongs to exactly one channel.
ALTER TABLE arviva_auth_events ALTER COLUMN email_digest DROP NOT NULL;
ALTER TABLE arviva_auth_events ADD COLUMN phone_digest text
  CHECK (phone_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE arviva_auth_events ADD CONSTRAINT arviva_auth_events_identity_required
  CHECK ((email_digest IS NOT NULL) <> (phone_digest IS NOT NULL));
CREATE INDEX arviva_auth_events_phone_idx ON arviva_auth_events (kind, phone_digest, created_at);
CREATE INDEX arviva_auth_events_sms_day_idx ON arviva_auth_events (created_at)
  WHERE kind = 'send' AND phone_digest IS NOT NULL;
