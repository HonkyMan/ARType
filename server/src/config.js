import { z } from 'zod';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const credentialAlias = z.string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));

function endpoint(value, { name, originOnly = false, allowLoopback = true }) {
  const url = new URL(value);
  const localHTTP = allowLoopback && url.protocol === 'http:' && loopbackHosts.has(url.hostname);
  if (url.protocol !== 'https:' && !localHTTP) {
    throw new Error(`${name} requires HTTPS (HTTP is allowed only on loopback)`);
  }
  // Empty `?` and `#` delimiters still affect URL suffix composition, although
  // URL.search/hash are empty for these inputs.
  if (url.username || url.password || /[?#]/.test(url.href) || (originOnly && url.pathname !== '/')) {
    throw new Error(`${name} must not contain credentials, query, fragment${originOnly ? ' or path' : ''}`);
  }
  return url;
}

export function providerURL(value, { allowLoopback = false } = {}) {
  return endpoint(value, { name: 'Provider URL', allowLoopback }).href.replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const origin = endpoint(env.PUBLIC_URL || 'http://127.0.0.1:8080', {
    name: 'PUBLIC_URL',
    originOnly: true,
  });
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

  const adminEmails = [...new Set((env.ADMIN_EMAILS || '').split(',')
    .map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (adminEmails.some(value => !z.email().max(254).safeParse(value).success)) {
    throw new Error('ADMIN_EMAILS must contain valid email addresses');
  }

  const keys = JSON.parse(env.PROVIDER_KEYS || '{}');
  if (!keys || Array.isArray(keys) || typeof keys !== 'object' ||
      Object.entries(keys).some(([alias, key]) =>
        !credentialAlias.safeParse(alias).success || typeof key !== 'string' ||
        /[\s\x00-\x1f\x7f]/.test(key))) {
    throw new Error('PROVIDER_KEYS must map valid credential aliases to single-line keys');
  }
  if (env.CREDENTIAL_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_ENCRYPTION_KEY)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain 32 random bytes as 64 hex characters');
  }

  return {
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    databaseURL: env.DATABASE_URL,
    adminEmails,
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY || '',
    defaultModel: env.DEFAULT_MODEL || '',
    downloadDirectory: env.DOWNLOADS_DIRECTORY || '',
    providerBaseURL: providerURL(env.PROVIDER_BASE_URL || 'https://openrouter.ai/api/v1', { allowLoopback: true }),
    providerKeys: Object.assign(Object.create(null), keys),
    port,
    trustProxy: env.TRUST_PROXY === '1',
  };
}
