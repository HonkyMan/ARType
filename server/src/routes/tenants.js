import { z } from 'zod';
import { access, requirePlatformAdmin } from '../access.js';
import { settings, validate, uuid, email } from '../schemas.js';
import { quoteMemberAccess, changeMemberAccess } from '../member-access.js';
import { quoteInvitations, inviteMembers } from '../member-invitations.js';
import {
  listTenants, createTenant, tenantDetails, updateTenant,
  inviteMember, updateMember, tenantUsageReport,
} from '../tenants.js';

const creation = settings.partial().extend({
  name: settings.shape.name,
  model: settings.shape.model,
  credential: settings.shape.credential,
  languages: settings.shape.languages.default(['ru', 'en', 'bn', 'hi', 'zh']),
  owner_email: email,
}).strict();
const invitation = z.object({ email, role: z.enum(['owner', 'admin', 'member']) }).strict();
const invitations = z.object({
  emails:z.array(email).min(1).max(200), role:z.enum(['owner','admin','member']), enabled:z.boolean(),
}).strict();
const membershipChanges = z.object({
  role: z.enum(['owner', 'admin', 'member']).optional(),
  status: z.enum(['active', 'disabled', 'invited']).optional(),
}).strict();
const accessSelection = z.object({
  member_ids: z.array(uuid).min(1).max(1000).refine(ids => new Set(ids).size === ids.length),
  enabled: z.boolean(),
}).strict();
const csvCell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;

export function installTenants(app, { pool, config }) {
  app.get('/api/tenants/:id/language-policy', async (req,res) => {
    const tenant = await access(pool, validate(uuid,req.params.id), req.user, config);
    res.json({tenant_id:tenant.id, languages:tenant.languages});
  });
  app.post('/api/tenants/:id/invitations/quote', async (req,res) => {
    res.json(await quoteInvitations(pool,config,req.user,validate(uuid,req.params.id),validate(invitations,req.body)));
  });
  app.post('/api/tenants/:id/invitations', async (req,res) => {
    const body = validate(invitations.extend({quote_token:z.string().regex(/^[a-f0-9]{64}$/),idempotency_key:uuid}),req.body);
    res.status(201).json(await inviteMembers(pool,config,req.user,validate(uuid,req.params.id),body));
  });
  app.post('/api/tenants/:id/member-access/quote', async (req,res) => {
    res.json(await quoteMemberAccess(pool,config,req.user,validate(uuid,req.params.id),validate(accessSelection,req.body)));
  });
  app.post('/api/tenants/:id/member-access', async (req,res) => {
    const body = validate(accessSelection.extend({quote_token:z.string().regex(/^[a-f0-9]{64}$/),idempotency_key:uuid}),req.body);
    res.json(await changeMemberAccess(pool,config,req.user,validate(uuid,req.params.id),body));
  });
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
