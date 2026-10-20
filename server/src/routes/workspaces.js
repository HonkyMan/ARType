import { z } from 'zod';
import { validate, uuid, settings } from '../schemas.js';
import { planCatalog, planConfiguration, savePlanConfiguration, createWorkspace, setRenewal } from '../workspaces.js';
import { createPaymentOrder, settleManualPayment } from '../payments.js';
const plan = z.enum(['plus','business']);
const creation = z.object({plan, name: settings.shape.name, idempotency_key: uuid}).strict();
const defaults = settings.pick({credential: true, model: true, monthly_characters: true, seats: true, languages: true}).extend({registration_enabled: z.boolean()}).strict();
const amount = z.number().int().min(1).max(9000000000000);

export function installPublicPlans(app, {pool}) {
  app.get('/api/plans', async (req, res) => res.json(await planCatalog(pool)));
}
export function installWorkspaces(app, {pool, config}) {
  app.get('/api/plan-defaults', async (req,res) => res.json(await planConfiguration(pool, config, req.user)));
  app.put('/api/plan-defaults/:plan', async (req,res) => {
    await savePlanConfiguration(pool, config, req.user, validate(plan, req.params.plan), validate(defaults, req.body));
    res.json({ok: true});
  });
  app.post('/api/workspaces', async (req,res) => res.status(201).json(await createWorkspace(pool, config, req.user, validate(creation, req.body))));
  app.put('/api/tenants/:id/renewal', async (req,res) => {
    await setRenewal(pool, config, req.user, validate(uuid, req.params.id), validate(z.object({enabled:z.boolean()}).strict(), req.body).enabled);
    res.json({ok: true});
  });
  app.post('/api/tenants/:id/payment-orders', async (req,res) => res.status(201).json(await createPaymentOrder(pool, config, req.user,
    validate(uuid, req.params.id), validate(z.object({amount_cents: amount, idempotency_key: uuid}).strict(), req.body))));
  app.post('/api/payment-orders/:id/settle', async (req,res) => res.json(await settleManualPayment(pool, config, req.user,
    validate(uuid, req.params.id), validate(z.object({amount_cents: amount,currency:z.literal('USD'),reference:z.string().trim().min(3).max(200)}).strict(), req.body))));
}
