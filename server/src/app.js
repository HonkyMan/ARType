import express from 'express';
import {errorText, requestLocale} from './localization.js';
import { installPublicPlans, installWorkspaces } from './routes/workspaces.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { installAuth } from './auth.js';
import { installAdministration } from './administration.js';
import { installDownloads } from './downloads.js';
import { installBilling } from './routes/billing.js';
import { installProfile } from './routes/profile.js';
import { installConnections } from './routes/connections.js';
import { installTenants } from './routes/tenants.js';
import { installTranslation } from './routes/translation.js';
import { securityHeaders, pairingThrottle, handleError } from './http.js';
import { validate, email } from './schemas.js';

export function createApp({ pool, config, google, translate }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders(config));
  app.use(express.json({ limit: '100kb' }));
  app.use(pairingThrottle(pool));
  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'ARType' });
  });

  const auth = installAuth(app, { pool, config, google, validate, z });
  installPublicPlans(app, {pool});
  app.use('/api', auth);
  installWorkspaces(app, {pool, config});
  installAdministration(app, { pool, config, validate, email });
  installDownloads(app, { config, auth });
  installBilling(app, { pool, config });
  installProfile(app, { pool, config });
  installConnections(app, { pool, config });
  installTenants(app, { pool, config });
  installTranslation(app, { pool, config, translate });

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { etag: false, maxAge: 0 }));
  app.use((req, res) => res.status(404).json({ error: { code: 'not_found', message: errorText('not_found',requestLocale(req)) } }));
  app.use(handleError);
  return app;
}
