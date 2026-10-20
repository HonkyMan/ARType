import {errorText, requestLocale} from './localization.js';
import { hash } from './auth.js';
import { uuid } from './schemas.js';
import { HttpError } from './errors.js';

export function securityHeaders(config) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Cache-Control': 'no-store',
    });
    if (config.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

export function pairingThrottle(pool) {
  const throttle = new Map();
  return async (req, res, next) => {
    if (!req.path.startsWith('/api/device') && req.path !== '/auth/google') return next();
    let key = req.ip;
    let limit = 200;
    // An office may share one IP. Only a valid pairing secret earns its own
    // polling allowance; random device ids do not bypass the shared IP limit.
    if (req.path === '/api/device/poll' && uuid.safeParse(req.body?.id).success &&
        typeof req.body?.poll_token === 'string' && req.body.poll_token.length <= 200) {
      const result = await pool.query(
        'SELECT id FROM devices WHERE id=$1 AND poll_hash=$2 AND expires_at>now()',
        [req.body.id, hash(req.body.poll_token)],
      );
      if (result.rowCount) {
        key = 'device:' + result.rows[0].id;
        limit = 30;
      }
    }
    const now = Date.now();
    const entry = throttle.get(key);
    if (!entry || entry.until < now) {
      if (throttle.size > 10000) {
        for (const [candidate, value] of throttle) {
          if (value.until < now) throttle.delete(candidate);
        }
      }
      throttle.set(key, { n: 1, until: now + 60000 });
    } else if (++entry.n > limit) {
      return res.status(429).json({ error: { code: 'rate_limit', message: errorText('rate_limit',requestLocale(req)) } });
    }
    next();
  };
}

export function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error instanceof HttpError ? error.status :
    error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
  if (status === 500) {
    // Do not log upstream bodies, submitted text, cookies or credentials.
    console.error(JSON.stringify({ event: 'request_error', code: error.code || 'internal', path: req.route?.path || 'unknown' }));
  }
  const code = error instanceof HttpError ? error.code : status === 500 ? 'internal' : 'request_failed';
  const locale = requestLocale(req);
  const message = errorText(code,locale,error.params);
  res.set('Content-Language',locale);
  if (req.path.startsWith('/auth/')) {
    const escape = text => text.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const back = locale === 'ru' ? 'Вернуться ко входу' : 'Back to sign in';
    return res.status(status).type('html').send(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARType</title><link rel="stylesheet" href="/style.css"><main class="workspace"><h1>ARType</h1><div class="error" role="alert">${escape(message)}</div><a class="button" href="/">${back}</a></main></html>`);
  }
  res.status(status).json({error:{code,message,params:error.params || {}}});
}
