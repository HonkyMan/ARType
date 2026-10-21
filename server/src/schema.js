import { readFile } from 'node:fs/promises';
import { transaction } from './database.js';

const schemaId = 'artype-workspaces-v1';

export async function initializeSchema(pool) {
  await transaction(pool, async client => {
    // Transaction-scoped lock is released even on initialization failure or disconnect.
    await client.query('SELECT pg_advisory_xact_lock(63821017)');
    const existing = await client.query("SELECT to_regclass('schema_identity') AS identity,to_regclass('users') AS users");
    if (existing.rows[0].identity) {
      const identity = await client.query('SELECT id FROM schema_identity');
      if (identity.rows.length !== 1 || identity.rows[0].id !== schemaId) {
        throw new Error('Unsupported database schema; refusing to start');
      }
      return;
    }
    if (existing.rows[0].users) throw new Error('Unsupported database schema. Provision a fresh workspace database; no automatic legacy conversion is performed.');
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await client.query('CREATE TABLE schema_identity(id text PRIMARY KEY)');
    await client.query('INSERT INTO schema_identity VALUES($1)', [schemaId]);
  });
}
