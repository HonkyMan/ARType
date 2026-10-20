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
