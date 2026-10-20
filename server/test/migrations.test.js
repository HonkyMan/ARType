import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../src/migrations.js';

async function isolatedSchema(fn) {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL');
  assert.match(new URL(connectionString).pathname, /_test$/);
  const schema = 'migration_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test('fresh and concurrent migration runs converge on one schema', async () => {
  await isolatedSchema(async pool => {
    await Promise.all([migrate(pool), migrate(pool)]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM billing_settings')).rows[0].n, 1);
    const versions = (await pool.query('SELECT version FROM schema_versions ORDER BY version')).rows.map(r => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4, 5]);
  });
});

test('upgrading a real version-4 schema preserves paid owner, encrypted key and immutable financial history', async () => {
  await isolatedSchema(async pool => {
    await pool.query(await readFile(new URL('./fixtures/schema-v4.sql', import.meta.url), 'utf8'));
    const user = randomUUID(), tenant = randomUUID(), ledger = randomUUID();
    await pool.query("INSERT INTO users VALUES($1,'google-sub','owner@example.com','Owner')", [user]);
    await pool.query("INSERT INTO tenants(id,name,model,credential) VALUES($1,'Existing','model','main')", [tenant]);
    await pool.query("INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled) VALUES($1,$2,'owner@example.com','owner','active',true)", [randomUUID(), tenant]);
    await pool.query("INSERT INTO provider_credentials(alias,ciphertext,updated_by) VALUES('main','preserve-existing-ciphertext',$1)", [user]);
    await pool.query("INSERT INTO tenant_wallets VALUES($1,1500)", [tenant]);
    await pool.query("INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,source) VALUES($1,$2,1500,0,1500,'credit','Invoice','old-invoice','{}','manual')", [ledger, tenant]);
    await migrate(pool);
    await migrate(pool);
    assert.equal((await pool.query('SELECT product_enabled FROM memberships')).rows[0].product_enabled, true);
    assert.equal((await pool.query('SELECT ciphertext FROM provider_credentials')).rows[0].ciphertext, 'preserve-existing-ciphertext');
    assert.equal((await pool.query('SELECT balance_cents FROM tenant_wallets')).rows[0].balance_cents, '1500');
    assert.equal((await pool.query('SELECT id FROM balance_ledger')).rows[0].id, ledger);
    await assert.rejects(pool.query('DELETE FROM balance_ledger'), /immutable/);
  });
});

test('a newer database schema stops startup without modifying its version or data', async () => {
  await isolatedSchema(async pool => {
    await migrate(pool);
    await pool.query('INSERT INTO schema_versions(version) VALUES(999)');
    const id = randomUUID();
    await pool.query("INSERT INTO tenants(id,name,model,credential) VALUES($1,'Future schema tenant','model','main')", [id]);
    await assert.rejects(migrate(pool), /newer|unsupported|unknown/i);
    assert.equal((await pool.query('SELECT count(*)::int n FROM schema_versions WHERE version=999')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT name FROM tenants WHERE id=$1', [id])).rows[0].name, 'Future schema tenant');
  });
});
