-- Expiration cleanup and tenant authorization remain indexed as data grows.
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX devices_expiry ON devices(expires_at);
CREATE INDEX usage_pending_time ON usage(created_at) WHERE status='pending';
CREATE INDEX membership_renewal ON memberships(tenant_id,email) WHERE product_enabled;
