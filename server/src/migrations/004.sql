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
