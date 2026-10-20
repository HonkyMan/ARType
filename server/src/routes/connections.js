import { z } from 'zod';
import { requirePlatformAdmin } from '../access.js';
import { credentialList, saveConnection } from '../connections.js';
import { settings, validate } from '../schemas.js';
import { providerURL } from '../config.js';

const connectionChanges = z.object({
  key: z.string().trim().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  base_url: z.url().max(2048).refine(value => {
    try { providerURL(value); return true; } catch { return false; }
  }).transform(value => providerURL(value)).optional(),
  default_model: z.string().trim().min(1).max(200).optional(),
}).strict().refine(value => Object.keys(value).length > 0);

export function installConnections(app, { pool, config }) {
  app.get('/api/provider-credentials', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    res.json({
      credentials: await credentialList(pool, config),
      can_manage: !!config.credentialEncryptionKey,
      provider_base_url: config.providerBaseURL,
      default_model: config.defaultModel || '',
    });
  });
  app.put('/api/provider-credentials/:alias', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    const alias = validate(settings.shape.credential, req.params.alias);
    await saveConnection(pool, config, req.user, alias, validate(connectionChanges, req.body));
    res.json({ ok: true });
  });
}
