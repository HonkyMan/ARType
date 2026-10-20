import {activateMemberships} from './access.js';
import {transaction, uid} from './database.js';
import {fail} from './errors.js';
import {hash, sameSecret, secret} from './auth-crypto.js';
import {issueSession} from './auth-session.js';

export function createOAuthService({pool, config, google, validate, z}) {
  async function start(deviceId) {
    if (!config.googleClientId || !config.googleClientSecret) {
      fail(503, 'google_not_configured',
        'Google-вход ещё не настроен. Администратору нужно задать GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.');
    }
    let device = null;
    if (deviceId) {
      device = validate(z.string().uuid(), deviceId);
      const result = await pool.query(
        'SELECT id FROM devices WHERE id=$1 AND expires_at>now() AND NOT consumed', [device],
      );
      if (!result.rowCount) {
        fail(410, 'device_expired', 'Вход устарел. Начните вход в приложении снова.');
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
      fail(400, 'oauth_state', 'Браузерная сессия входа отсутствует. Начните вход снова.');
    }
    const row = (await pool.query(`
      DELETE FROM oauth_states
      WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *
    `, [hash(state), hash(browser)])).rows[0];
    if (!row) fail(400, 'oauth_state', 'Ссылка входа истекла или уже использована.');
    return row;
  }

  async function complete(row, query) {
    if (query.error) fail(400, 'oauth_cancelled', 'Вход Google отменён. Начните вход снова.');
    const code = validate(z.string().min(1).max(4096), query.code);
    let claims;
    try {
      claims = await google.exchange(code, row.verifier);
    } catch {
      fail(400, 'oauth_failed', 'Не удалось подтвердить вход Google. Начните вход снова.');
    }
    if (!claims || !sameSecret(claims.nonce, row.nonce) || claims.email_verified !== true ||
        typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') {
      fail(400, 'oauth_identity', 'Google не подтвердил личность и email.');
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
        fail(403, 'identity_conflict', 'Email связан с другой учётной записью. Обратитесь к администратору.');
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
