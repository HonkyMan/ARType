import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const environment = { DATABASE_URL: 'postgresql://artype@localhost/artype_test' };

test('configuration accepts HTTPS and HTTP loopback, but rejects other schemes', () => {
  for (const origin of ['https://translate.example.com', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
    assert.equal(loadConfig({ ...environment, PUBLIC_URL: origin }).origin, origin);
  }
  for (const origin of ['ftp://localhost', 'file://localhost', 'http://example.com', 'https://user:pass@example.com']) {
    assert.throws(() => loadConfig({ ...environment, PUBLIC_URL: origin }), origin);
  }
});

test('provider configuration rejects ambiguous destinations and invalid aliases', () => {
  for (const url of ['ftp://localhost/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?token=x', 'https://example.com/v1#part', 'https://example.com/v1?', 'https://example.com/v1#']) {
    assert.throws(() => loadConfig({ ...environment, PROVIDER_BASE_URL: url }), url);
  }
  for (const keys of ['{"invalid alias":"key"}', '{"__proto__":"key"}', '{"main":"line\\nbreak"}']) {
    assert.throws(() => loadConfig({ ...environment, PROVIDER_KEYS: keys }), keys);
  }
});

test('server port and administrator addresses fail early on invalid configuration', () => {
  for (const port of ['0', '-1', '65536', 'NaN', '1.5']) {
    assert.throws(() => loadConfig({ ...environment, PORT: port }), port);
  }
  assert.throws(() => loadConfig({ ...environment, ADMIN_EMAILS: 'not an email' }));
  assert.deepEqual(loadConfig({ ...environment, ADMIN_EMAILS: ' Admin@Example.com , admin@example.com ' }).adminEmails, ['admin@example.com']);
});
