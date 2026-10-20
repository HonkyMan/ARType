CREATE TABLE IF NOT EXISTS schema_versions(version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, sub text NOT NULL UNIQUE, email text NOT NULL UNIQUE, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS tenants(
        id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
        seats int NOT NULL DEFAULT 10 CHECK(seats BETWEEN 1 AND 100000),
        monthly_characters bigint NOT NULL DEFAULT 1000000 CHECK(monthly_characters BETWEEN 1 AND 1000000000000),
        max_text int NOT NULL DEFAULT 5000 CHECK(max_text BETWEEN 1 AND 20000),
        rpm int NOT NULL DEFAULT 60 CHECK(rpm BETWEEN 1 AND 10000),
        concurrency int NOT NULL DEFAULT 8 CHECK(concurrency BETWEEN 1 AND 500),
        model text NOT NULL, credential text NOT NULL, instructions text NOT NULL DEFAULT '',
        languages jsonb NOT NULL DEFAULT '["ru","en"]', access_until timestamptz, revision int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS memberships(
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL,
        role text NOT NULL CHECK(role IN ('owner','admin','member')),
        status text NOT NULL CHECK(status IN ('invited','active','disabled')),
        expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
        UNIQUE(tenant_id,email));
      CREATE TABLE IF NOT EXISTS sessions(
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL,
        kind text NOT NULL CHECK(kind IN ('web','desktop')), expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS oauth_states(
        state_hash text PRIMARY KEY, cookie_hash text NOT NULL, nonce text NOT NULL,
        verifier text NOT NULL, device_id uuid, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(
        id uuid PRIMARY KEY, poll_hash text NOT NULL, challenge text NOT NULL, code text NOT NULL,
        user_id uuid REFERENCES users(id), expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false);
      CREATE TABLE IF NOT EXISTS usage(
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
        request_id uuid NOT NULL, characters int NOT NULL CHECK(characters>0),
        status text NOT NULL CHECK(status IN ('pending','success','failed')),
        input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0, duration_ms int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS usage_tenant_time ON usage(tenant_id,created_at);
      CREATE INDEX IF NOT EXISTS membership_email ON memberships(email);
      CREATE TABLE IF NOT EXISTS audit(
        id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
        tenant_id uuid, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS provider_credentials(
        alias text PRIMARY KEY, ciphertext text NOT NULL,
        updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO schema_versions(version) VALUES(2) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS platform_admins(
        email text PRIMARY KEY, added_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE audit ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS base_url text;
      ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS default_model text;
      INSERT INTO schema_versions(version) VALUES(3) ON CONFLICT DO NOTHING;
      ALTER TABLE memberships ADD COLUMN IF NOT EXISTS product_enabled boolean NOT NULL DEFAULT true;
      UPDATE memberships SET product_enabled=false WHERE role='owner' AND NOT EXISTS(SELECT 1 FROM schema_versions WHERE version=4);
      CREATE TABLE IF NOT EXISTS billing_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),unit_price_cents int NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 100000000),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'));
      INSERT INTO billing_settings(singleton,unit_price_cents) VALUES(true,500) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS tenant_wallets(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),balance_cents bigint NOT NULL DEFAULT 0 CHECK(balance_cents BETWEEN 0 AND 9000000000000));
      CREATE TABLE IF NOT EXISTS balance_ledger(
        id uuid PRIMARY KEY, sequence bigserial UNIQUE NOT NULL, tenant_id uuid NOT NULL REFERENCES tenants(id),
        delta_cents bigint NOT NULL, balance_before bigint NOT NULL, balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 9000000000000),
        kind text NOT NULL CHECK(kind IN ('credit','adjustment','seat_charge')), reason text NOT NULL,
        idempotency_key text NOT NULL, request jsonb NOT NULL, actor_id uuid REFERENCES users(id),
        source text NOT NULL CHECK(source IN ('manual','system','payment')),created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,idempotency_key),CHECK(balance_after=balance_before+delta_cents));
      CREATE INDEX IF NOT EXISTS ledger_tenant_sequence ON balance_ledger(tenant_id,sequence DESC);
      CREATE TABLE IF NOT EXISTS seat_charges(
        tenant_id uuid NOT NULL REFERENCES tenants(id),email text NOT NULL,period date NOT NULL,
        unit_price_cents int NOT NULL CHECK(unit_price_cents>=0),ledger_id uuid NOT NULL UNIQUE REFERENCES balance_ledger(id),
        PRIMARY KEY(tenant_id,email,period));
      CREATE OR REPLACE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'balance ledger is immutable'; END; $$;
      DROP TRIGGER IF EXISTS immutable_balance_ledger ON balance_ledger;
      CREATE TRIGGER immutable_balance_ledger BEFORE UPDATE OR DELETE ON balance_ledger FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
      INSERT INTO schema_versions(version) VALUES(4) ON CONFLICT DO NOTHING;
