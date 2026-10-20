CREATE TABLE IF NOT EXISTS provider_credentials(
  alias text PRIMARY KEY, ciphertext text NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
