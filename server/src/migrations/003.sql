CREATE TABLE IF NOT EXISTS platform_admins(
  email text PRIMARY KEY, added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE audit ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS default_model text;
