import { requirePlatformAdmin } from './access.js';
import { audit } from './audit.js';
import { encryptCredential } from './credentials.js';
import { transaction } from './database.js';
import { fail } from './errors.js';

export async function credentialList(client, config) {
  const rows = (await client.query(`
    SELECT alias,updated_at,base_url,default_model FROM provider_credentials ORDER BY alias
  `)).rows;
  const savedAliases = new Set(rows.map(row => row.alias));
  const saved = rows.map(row => ({
    ...row,
    base_url: row.base_url || config.providerBaseURL,
    default_model: row.default_model ?? config.defaultModel ?? '',
    source: 'admin',
  }));
  const environment = Object.keys(config.providerKeys)
    .filter(alias => config.providerKeys[alias] && !savedAliases.has(alias))
    .map(alias => ({
      alias,
      source: 'environment',
      updated_at: null,
      base_url: config.providerBaseURL,
      default_model: config.defaultModel || '',
    }));
  return [...saved, ...environment];
}

export async function saveConnection(pool, config, user, alias, changes, { createOnly = false } = {}) {
  requirePlatformAdmin(user, config);
  if (!config.credentialEncryptionKey) {
    fail(503, 'encryption_not_configured');
  }
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['provider:' + alias]);
    const result = await db.query('SELECT * FROM provider_credentials WHERE alias=$1', [alias]);
    const existing = result.rows[0];
    if (createOnly && (existing || config.providerKeys[alias])) {
      fail(409, 'connection_exists');
    }
    // Compare canonical destinations so spelling alone does not rotate a key.
    const previousURL = new URL(existing?.base_url || config.providerBaseURL).href.replace(/\/+$/, '');
    const missingKey = !existing && !config.providerKeys[alias];
    const destinationChanged = changes.base_url && changes.base_url !== previousURL;
    if (!changes.key && (missingKey || destinationChanged)) {
      fail(422, 'provider_key_required');
    }
    const ciphertext = changes.key
      ? encryptCredential(changes.key, config.credentialEncryptionKey, alias)
      : existing?.ciphertext || encryptCredential(config.providerKeys[alias], config.credentialEncryptionKey, alias);
    await db.query(`
      INSERT INTO provider_credentials(alias,ciphertext,updated_by,base_url,default_model) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(alias) DO UPDATE SET ciphertext=$2,updated_by=$3,base_url=$4,default_model=$5,updated_at=now()
    `, [
      alias, ciphertext, user.id, changes.base_url || previousURL,
      changes.default_model ?? existing?.default_model ?? config.defaultModel ?? '',
    ]);
    await audit(db, user, 'provider.credential.update', null);
  });
}
