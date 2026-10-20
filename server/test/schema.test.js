import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { initializeSchema } from '../src/schema.js';

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

test('fresh concurrent initializations converge on one clean schema', async () => {
  await isolatedSchema(async pool => {
    await Promise.all([initializeSchema(pool), initializeSchema(pool)]);
    assert.deepEqual((await pool.query('SELECT id FROM schema_identity')).rows, [{id:'artype-workspaces-v1'}]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM plan_defaults')).rows[0].n, 2);
    assert.equal((await pool.query('SELECT plus_price_cents,business_price_cents,unit_price_cents FROM billing_settings')).rows[0].business_price_cents,1000);
    assert.equal((await pool.query("SELECT to_regclass('schema_versions') AS old")).rows[0].old,null);
  });
});
test('unknown or unversioned schemas stop startup without modifying data', async () => {
  await isolatedSchema(async pool => {
    await pool.query('CREATE TABLE users(id int)');
    await pool.query('INSERT INTO users VALUES(42)');
    await assert.rejects(initializeSchema(pool), /Unsupported/);
    assert.equal((await pool.query('SELECT id FROM users')).rows[0].id,42);
  });
  await isolatedSchema(async pool => {
    await initializeSchema(pool);
    await pool.query("UPDATE schema_identity SET id='future'");
    await assert.rejects(initializeSchema(pool), /Unsupported/);
    assert.equal((await pool.query('SELECT id FROM schema_identity')).rows[0].id,'future');
  });
});
