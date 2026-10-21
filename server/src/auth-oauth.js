import {activateMemberships} from './access.js';
import {transaction, uid} from './database.js';
import {fail} from './errors.js';
import {hash, sameSecret, secret} from './auth-crypto.js';
import {issueSession} from './auth-session.js';

export function createOAuthService({pool, config, google, validate, z}) {
  async function start(deviceId) {
    if (!config.googleClientId || !config.googleClientSecret) {
      fail(503, 'google_not_configured');
    }
    let device = null;
    if (deviceId) {
      device = validate(z.string().uuid(), deviceId);
      const result = await pool.query(
        'SELECT id FROM devices WHERE id=$1 AND expires_at>now() AND NOT consumed', [device],
      );
      if (!result.rowCount) {
        fail(410, 'device_expired');
      }
    }

    const state = secret();
    const browser = secret();
    const nonce = secret();
    const verifier = secret();
    await pool.query(`
      INSERT INTO oauth_states(state_hash,cookie_hash,nonce,verifier,device_id,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')
    `, [hash(state), hash(browser), nonce, verifier, device]);
    return {browser, authorization: {state, nonce, verifier}};
  }

  async function consumeState(stateValue, browser) {
    const state = validate(z.string().min(20).max(200), stateValue);
    if (!browser) {
      fail(400, 'oauth_state');
    }
    const row = (await pool.query(`
      DELETE FROM oauth_states
      WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *
    `, [hash(state), hash(browser)])).rows[0];
    if (!row) fail(400, 'oauth_state');
    return row;
  }

  async function complete(row, query) {
    if (query.error) fail(400, 'oauth_cancelled');
    const code = validate(z.string().min(1).max(4096), query.code);
    let claims;
    try {
      claims = await google.exchange(code, row.verifier);
    } catch {
      fail(400, 'oauth_failed');
    }
    if (!claims || !sameSecret(claims.nonce, row.nonce) || claims.email_verified !== true ||
        typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') {
      fail(400, 'oauth_identity');
    }
    const email = validate(z.email().max(254), claims.email.toLowerCase());

    return transaction(pool, async client => {
      // Serialize both identifiers in a stable order, including first sign-in.
      for (const key of [`email:${email}`, `sub:${claims.sub}`].sort()) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      }
      const existing = (await client.query(
        'SELECT id,sub FROM users WHERE email=$1 OR sub=$2 FOR UPDATE', [email, claims.sub],
      )).rows;
      if (existing.some(user => user.sub !== claims.sub)) {
        fail(403, 'identity_conflict');
      }
      const id = existing[0]?.id || uid();
      const user = (await client.query(`
        INSERT INTO users(id,sub,email,name) VALUES($1,$2,$3,$4)
        ON CONFLICT(sub) DO UPDATE SET email=$3,name=$4 RETURNING id
      `, [id, claims.sub, email, String(claims.name || email).slice(0, 200)])).rows[0];
      await activateMemberships(client, email);
      return issueSession(client, user.id, 'web');
    });
  }

  return {start, consumeState, complete};
}
