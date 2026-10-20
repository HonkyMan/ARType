import { z } from 'zod';
import { requirePlatformAdmin } from '../access.js';
import { settings, validate, uuid, email } from '../schemas.js';
import {
  listTenants, createTenant, tenantDetails, updateTenant,
  inviteMember, updateMember, tenantUsageReport,
} from '../tenants.js';

const creation = settings.partial().extend({
  name: settings.shape.name,
  model: settings.shape.model,
  credential: settings.shape.credential,
  owner_email: email,
}).strict();
const invitation = z.object({ email, role: z.enum(['owner', 'admin', 'member']) }).strict();
const membershipChanges = z.object({
  role: z.enum(['owner', 'admin', 'member']).optional(),
  status: z.enum(['active', 'disabled', 'invited']).optional(),
  product_enabled: z.boolean().optional(),
}).strict();
const csvCell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;

export function installTenants(app, { pool, config }) {
  app.get('/api/tenants', async (req, res) => {
    res.json(await listTenants(pool, config, req.user));
  });
  app.post('/api/tenants', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    res.status(201).json(await createTenant(pool, config, req.user, validate(creation, req.body)));
  });
  app.get('/api/tenants/:id', async (req, res) => {
    res.json(await tenantDetails(pool, config, req.user, validate(uuid, req.params.id)));
  });
  app.patch('/api/tenants/:id', async (req, res) => {
    const id = validate(uuid, req.params.id);
    await updateTenant(pool, config, req.user, id, validate(settings.partial().strict(), req.body));
    res.json({ ok: true });
  });
  app.post('/api/tenants/:id/members', async (req, res) => {
    const id = validate(uuid, req.params.id);
    await inviteMember(pool, config, req.user, id, validate(invitation, req.body));
    res.status(201).json({ ok: true, login_url: config.origin, expires_in_days: 7 });
  });
  app.patch('/api/tenants/:id/members/:member', async (req, res) => {
    const id = validate(uuid, req.params.id);
    const memberId = validate(uuid, req.params.member);
    await updateMember(pool, config, req.user, id, memberId, validate(membershipChanges, req.body));
    res.json({ ok: true });
  });
  app.get('/api/tenants/:id/usage.csv', async (req, res) => {
    const id = validate(uuid, req.params.id);
    const rows = await tenantUsageReport(pool, config, req.user, id);
    const csv = [
      'day,email,requests,characters,input_tokens,output_tokens',
      ...rows.map(row => Object.values(row).map(csvCell).join(',')),
    ].join('\r\n');
    res.set('Content-Disposition', `attachment; filename="artype-usage-${id}.csv"`)
      .type('text/csv').send('\uFEFF' + csv);
  });
}
