CREATE TABLE users(id uuid PRIMARY KEY, sub text NOT NULL UNIQUE, email text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE tenants(
  id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  plan text NOT NULL DEFAULT 'business' CHECK(plan IN ('plus','business')),
  personal_owner_id uuid UNIQUE REFERENCES users(id),
  created_by uuid REFERENCES users(id), creation_key uuid,
  UNIQUE(created_by,creation_key), CHECK((created_by IS NULL)=(creation_key IS NULL)),
  renewal_enabled boolean NOT NULL DEFAULT true,
  CHECK((plan='plus')=(personal_owner_id IS NOT NULL)),
  seats int NOT NULL DEFAULT 10 CHECK(seats BETWEEN 1 AND 100000),
  monthly_characters bigint NOT NULL DEFAULT 1000000 CHECK(monthly_characters BETWEEN 1 AND 1000000000000),
  max_text int NOT NULL DEFAULT 5000 CHECK(max_text BETWEEN 1 AND 20000),
  rpm int NOT NULL DEFAULT 60 CHECK(rpm BETWEEN 1 AND 10000),
  concurrency int NOT NULL DEFAULT 8 CHECK(concurrency BETWEEN 1 AND 500),
  model text NOT NULL, credential text NOT NULL, instructions text NOT NULL DEFAULT '',
  languages jsonb NOT NULL DEFAULT '["ru","en"]', access_until timestamptz, revision int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships(
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','admin','member')),
  status text NOT NULL CHECK(status IN ('invited','active','disabled')),
  product_enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  UNIQUE(tenant_id,email));
CREATE TABLE sessions(
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('web','desktop')), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE oauth_states(
  state_hash text PRIMARY KEY, cookie_hash text NOT NULL, nonce text NOT NULL,
  verifier text NOT NULL, device_id uuid, expires_at timestamptz NOT NULL);
CREATE TABLE devices(
  id uuid PRIMARY KEY, poll_hash text NOT NULL, challenge text NOT NULL, code text NOT NULL,
  user_id uuid REFERENCES users(id), expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false);
CREATE TABLE usage(
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL, characters int NOT NULL CHECK(characters>0),
  status text NOT NULL CHECK(status IN ('pending','success','failed')),
  input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0, duration_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id));
CREATE INDEX usage_tenant_time ON usage(tenant_id,created_at);
CREATE INDEX membership_email ON memberships(email);
CREATE TABLE audit(
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  tenant_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE provider_credentials(
  alias text PRIMARY KEY, ciphertext text NOT NULL, base_url text, default_model text,
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_admins(
  email text PRIMARY KEY, added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE billing_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),unit_price_cents int NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 100000000),plus_price_cents int NOT NULL DEFAULT 500 CHECK(plus_price_cents BETWEEN 0 AND 100000000),business_price_cents int NOT NULL DEFAULT 1000 CHECK(business_price_cents BETWEEN 0 AND 100000000),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'));
INSERT INTO billing_settings(singleton,unit_price_cents) VALUES(true,500) ON CONFLICT DO NOTHING;
CREATE TABLE tenant_wallets(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),balance_cents bigint NOT NULL DEFAULT 0 CHECK(balance_cents BETWEEN 0 AND 9000000000000));
CREATE TABLE balance_ledger(
  id uuid PRIMARY KEY, sequence bigserial UNIQUE NOT NULL, tenant_id uuid NOT NULL REFERENCES tenants(id),
  delta_cents bigint NOT NULL, balance_before bigint NOT NULL, balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 9000000000000),
  kind text NOT NULL CHECK(kind IN ('credit','adjustment','seat_charge','subscription_charge')), reason text NOT NULL,
  idempotency_key text NOT NULL, request jsonb NOT NULL, actor_id uuid REFERENCES users(id),
  source text NOT NULL CHECK(source IN ('manual','system','payment')),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,idempotency_key),CHECK(balance_after=balance_before+delta_cents));
CREATE INDEX ledger_tenant_sequence ON balance_ledger(tenant_id,sequence DESC);
CREATE TABLE seat_charges(
  tenant_id uuid NOT NULL REFERENCES tenants(id),email text NOT NULL,period date NOT NULL,
  unit_price_cents int NOT NULL CHECK(unit_price_cents>=0),ledger_id uuid NOT NULL UNIQUE REFERENCES balance_ledger(id),
  PRIMARY KEY(tenant_id,email,period));
CREATE OR REPLACE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'balance ledger is immutable'; END; $$;
CREATE TRIGGER immutable_balance_ledger BEFORE UPDATE OR DELETE ON balance_ledger FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
-- Expiration cleanup and tenant authorization remain indexed as data grows.
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX devices_expiry ON devices(expires_at);
CREATE INDEX usage_pending_time ON usage(created_at) WHERE status='pending';
CREATE INDEX membership_renewal ON memberships(tenant_id,email) WHERE product_enabled;

-- Onboarding defaults are controlled by platform administrators, never clients.
CREATE TABLE plan_defaults(
  plan text PRIMARY KEY CHECK(plan IN ('plus','business')),
  registration_enabled boolean NOT NULL DEFAULT false,
  credential text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '',
  monthly_characters bigint NOT NULL DEFAULT 1000000 CHECK(monthly_characters BETWEEN 1 AND 1000000000000),
  seats int NOT NULL DEFAULT 100 CHECK(seats BETWEEN 1 AND 100000),
  languages jsonb NOT NULL DEFAULT '["en","ru","bn","hi","zh","es","fr","ar","pt","id"]'
);
INSERT INTO plan_defaults(plan,seats) VALUES('plus',1),('business',100);
CREATE TABLE subscription_charges(
  tenant_id uuid NOT NULL REFERENCES tenants(id), period date NOT NULL,
  plan text NOT NULL CHECK(plan IN ('plus','business')),
  amount_cents int NOT NULL CHECK(amount_cents>=0),
  ledger_id uuid NOT NULL UNIQUE REFERENCES balance_ledger(id),
  PRIMARY KEY(tenant_id,period)
);
CREATE TABLE payment_orders(
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 9000000000000),
  currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
  idempotency_key uuid NOT NULL, provider text, provider_reference text,
  ledger_id uuid UNIQUE REFERENCES balance_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
  UNIQUE(tenant_id,idempotency_key), UNIQUE(provider,provider_reference),
  CHECK((status='paid')=(ledger_id IS NOT NULL))
);
CREATE INDEX payment_orders_tenant_time ON payment_orders(tenant_id,created_at DESC);
