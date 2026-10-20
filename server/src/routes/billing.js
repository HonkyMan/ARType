import { z } from 'zod';
import { requirePlatformAdmin } from '../access.js';
import { validate, uuid } from '../schemas.js';
import { billingSettings } from '../billing.js';
import { updateUnitPrice, tenantWallet, adjustBalance, dashboard } from '../wallets.js';

const pricing = z.object({ unit_price_cents: z.number().int().min(0).max(100000000) }).strict();
const adjustment = z.object({
  operation: z.enum(['credit', 'set']),
  amount_cents: z.number().int().min(0).max(9000000000000),
  reason: z.string().trim().min(3).max(500),
  idempotency_key: uuid,
}).strict().refine(body => body.operation !== 'credit' || body.amount_cents > 0);

export function installBilling(app, { pool, config }) {
  app.get('/api/billing-settings', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    res.json(await billingSettings(pool));
  });
  app.put('/api/billing-settings', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    const body = validate(pricing, req.body);
    await updateUnitPrice(pool, config, req.user, body.unit_price_cents);
    res.json({ ok: true });
  });
  app.get('/api/tenants/:id/balance', async (req, res) => {
    res.json(await tenantWallet(pool, config, req.user, validate(uuid, req.params.id)));
  });
  app.post('/api/tenants/:id/balance', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    const id = validate(uuid, req.params.id);
    const entry = await adjustBalance(pool, config, req.user, id, validate(adjustment, req.body));
    res.json({ entry });
  });
  app.get('/api/dashboard', async (req, res) => {
    res.json(await dashboard(pool, config, req.user));
  });
}
