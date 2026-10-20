import { readFile } from 'node:fs/promises';
import { transaction } from './database.js';

const versions = [1, 2, 3, 4, 5];

export async function migrate(pool) {
  await transaction(pool, async client => {
    // Transaction-scoped lock is released even on migration failure or disconnect.
    await client.query('SELECT pg_advisory_xact_lock(63821017)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_versions(
      version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query('SELECT version FROM schema_versions')).rows.map(row => row.version));
    if ([...applied].some(version => !versions.includes(version))) {
      throw new Error('Database schema is newer than this server; refusing to start');
    }
    for (const version of versions) {
      if (applied.has(version)) continue;
      const file = new URL(`./migrations/${String(version).padStart(3, '0')}.sql`, import.meta.url);
      await client.query(await readFile(file, 'utf8'));
      await client.query('INSERT INTO schema_versions(version) VALUES($1)', [version]);
    }
  });
}
