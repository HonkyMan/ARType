import {fail} from './errors.js';
import {hash, sameSecret, secret} from './auth-crypto.js';

export function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '')
    .split(';')
    .map(part => part.trim().split(/=(.*)/s).slice(0, 2))
    .filter(pair => pair.length === 2));
}

export function setCookie(response, name, value, config, maxAge) {
  response.append('Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`);
}

export async function issueSession(client, userId, kind) {
  const token = secret();
  const csrf = secret();
  await client.query(`
    INSERT INTO sessions(token_hash,user_id,csrf,kind,expires_at)
    VALUES($1,$2,$3,$4,now()+$5::interval)
  `, [hash(token), userId, csrf, kind, kind === 'desktop' ? '30 days' : '7 days']);
  return {token, csrf};
}

export async function revokeSession(pool, session) {
  await pool.query('DELETE FROM sessions WHERE token_hash=$1', [session.token_hash]);
}

export function authMiddleware(pool, config) {
  return async (request, response, next) => {
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
    const token = bearer || cookies(request).artype_session;
    if (!token) fail(401, 'sign_in_required');

    const session = (await pool.query(`
      SELECT s.*,u.id,u.email,u.name,
        EXISTS(SELECT 1 FROM platform_admins a WHERE a.email=u.email) AS platform_admin
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE token_hash=$1 AND expires_at>now()
    `, [hash(token)])).rows[0];
    if (!session || (bearer && session.kind !== 'desktop')) {
      fail(401, 'session_expired');
    }

    const browserWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !bearer;
    if (browserWrite &&
        (request.headers.origin !== config.origin || !sameSecret(request.headers['x-csrf-token'], session.csrf))) {
      fail(403, 'csrf');
    }

    request.user = {
      id: session.user_id, email: session.email, name: session.name,
      platform_admin: session.platform_admin,
    };
    request.session = session;
    next();
  };
}
