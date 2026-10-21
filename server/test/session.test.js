import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authMiddleware, hash, issueSession, makeGoogle} from '../src/auth.js';

const config = {origin: 'https://artype.example'};
const token = 'browser-token-with-at-least-20-characters';
const session = {
  token_hash: hash(token), user_id: 'user-id', email: 'member@example.com', name: 'Member',
  csrf: 'expected-csrf', kind: 'web', platform_admin: false,
};

function middlewareFor(row = session) {
  return authMiddleware({query: async () => ({rows: row ? [row] : []})}, config);
}

function request(headers = {}, method = 'POST') {
  return {headers: {cookie: `other=a=b; artype_session=${token}`, ...headers}, method};
}

test('browser sessions require both the exact origin and the session CSRF token for writes', async () => {
  const auth = middlewareFor();
  for (const headers of [
    {},
    {origin: config.origin},
    {'x-csrf-token': session.csrf},
    {origin: config.origin + '.attacker.example', 'x-csrf-token': session.csrf},
    {origin: config.origin, 'x-csrf-token': 'wrong'},
  ]) {
    await assert.rejects(auth(request(headers), {}, () => assert.fail('accepted invalid browser write')), {
      status: 403, code: 'csrf',
    });
  }
  const req = request({origin: config.origin, 'x-csrf-token': session.csrf});
  let called = false;
  await auth(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.deepEqual(req.user, {
    id: 'user-id', email: 'member@example.com', name: 'Member', platform_admin: false,
  });
});

test('desktop bearer sessions authorize writes without a browser cookie or CSRF token', async () => {
  const req = {method: 'POST', headers: {authorization: `Bearer ${token}`}};
  let called = false;
  await middlewareFor({...session, kind: 'desktop'})(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.user.id, session.user_id);
});

test('a web session cannot be used as a bearer token even alongside a valid cookie', async () => {
  await assert.rejects(
    middlewareFor()(request({authorization: `Bearer ${token}`}), {}, () => assert.fail('accepted browser bearer')),
    {status: 401, code: 'session_expired'},
  );
});

test('missing or revoked sessions never call the authenticated handler', async () => {
  await assert.rejects(
    middlewareFor()({method: 'GET', headers: {}}, {}, () => assert.fail('accepted missing session')),
    {status: 401, code: 'sign_in_required'},
  );
  await assert.rejects(
    middlewareFor(null)(request({}, 'GET'), {}, () => assert.fail('accepted revoked session')),
    {status: 401, code: 'session_expired'},
  );
});

test('session tokens are stored as hashes with distinct browser and desktop expiry periods', async () => {
  const writes = [];
  const client = {query: async (sql, parameters) => { writes.push(parameters); }};
  const browser = await issueSession(client, 'web-user', 'web');
  const desktop = await issueSession(client, 'desktop-user', 'desktop');
  for (const [issued, saved] of [[browser, writes[0]], [desktop, writes[1]]]) {
    assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(issued.csrf, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(issued.token, issued.csrf);
    assert.equal(saved[0], hash(issued.token));
    assert.equal(saved[2], issued.csrf);
  }
  assert.notEqual(browser.token, desktop.token);
  assert.deepEqual(writes.map(row => row.slice(3)), [['web', '7 days'], ['desktop', '30 days']]);
});

test('Google authorization binds state and nonce and sends a PKCE challenge, never the verifier', () => {
  const google = makeGoogle({...config, googleClientId: 'test-client', googleClientSecret: 'test-secret'});
  const url = new URL(google.authorizationURL({state: 'test-state', nonce: 'test-nonce', verifier: 'private-verifier'}));
  assert.equal(url.searchParams.get('redirect_uri'), config.origin + '/auth/google/callback');
  assert.equal(url.searchParams.get('state'), 'test-state');
  assert.equal(url.searchParams.get('nonce'), 'test-nonce');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(hash('private-verifier'), 'hex').toString('base64url'));
  assert.equal(url.toString().includes('private-verifier'), false);
});
