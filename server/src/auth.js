import {authMiddleware, cookies, revokeSession, setCookie} from './auth-session.js';
import {createOAuthService} from './auth-oauth.js';
import {createDeviceService} from './auth-device.js';

// Preserve the public entry points used by HTTP composition and test fixtures.
export {hash, secret} from './auth-crypto.js';
export {makeGoogle} from './auth-google.js';
export {authMiddleware, issueSession} from './auth-session.js';

export function installAuth(app, dependencies) {
  const {pool, config, google} = dependencies;
  const oauth = createOAuthService(dependencies);
  const devices = createDeviceService(dependencies);
  const auth = authMiddleware(pool, config);

  app.get('/auth/status', (request, response) => {
    response.json({configured: !!(config.googleClientId && config.googleClientSecret)});
  });

  app.get('/auth/google', async (request, response) => {
    const login = await oauth.start(request.query.device);
    setCookie(response, 'artype_oauth', login.browser, config, 600);
    response.redirect(google.authorizationURL(login.authorization));
  });

  app.get('/auth/google/callback', async (request, response) => {
    const state = await oauth.consumeState(request.query.state, cookies(request).artype_oauth);
    // Clear the browser binding once consumed, including cancelled/failed sign-in.
    setCookie(response, 'artype_oauth', '', config, 0);
    const session = await oauth.complete(state, request.query);
    setCookie(response, 'artype_session', session.token, config, 604800);
    response.redirect(state.device_id ? `/?device=${state.device_id}` : '/');
  });

  app.post('/api/device/start', async (request, response) => {
    response.json(await devices.start(request.body));
  });

  app.post('/api/device/poll', async (request, response) => {
    const session = await devices.poll(request.body);
    response.status(session ? 200 : 202).json(
      session ? {token: session.token, expires_in: 2592000} : {status: 'pending'},
    );
  });

  app.get('/api/device/:id', auth, async (request, response) => {
    response.json(await devices.get(request.params.id));
  });

  app.post('/api/device/:id/approve', auth, async (request, response) => {
    await devices.approve(request.params.id, request.body, request.user.id);
    response.json({ok: true});
  });

  app.post('/api/logout', auth, async (request, response) => {
    await revokeSession(pool, request.session);
    setCookie(response, 'artype_session', '', config, 0);
    response.json({ok: true});
  });

  return auth;
}
