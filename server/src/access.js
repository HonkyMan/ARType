import { effectiveLanguages } from './language-policy.js';
import { fail } from './errors.js';

export function operator(user, config) {
  return config.adminEmails.includes(user.email) || user.platform_admin === true;
}

export async function activateMemberships(client, email) {
  const locked = await client.query(`
    SELECT t.id FROM tenants t JOIN memberships m ON t.id=m.tenant_id
    WHERE m.email=$1 AND m.status='invited' ORDER BY t.id FOR UPDATE OF t
  `, [email]);
  if (!locked.rowCount) return;
  await client.query(`
    UPDATE memberships SET status='active'
    WHERE email=$1 AND tenant_id=ANY($2::uuid[])
      AND status='invited' AND expires_at>clock_timestamp()
  `, [email, locked.rows.map(tenant => tenant.id)]);
}

export async function access(client, tenantId, user, config, { manage = false, lock = false } = {}) {
  const tenant = (await client.query(`
    SELECT * FROM tenants WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}
  `, [tenantId])).rows[0];
  if (!tenant) fail(403, 'no_access');

  const membership = (await client.query(`
    SELECT * FROM memberships WHERE tenant_id=$1 AND email=$2
      AND (status='active' OR (status='invited' AND expires_at>clock_timestamp()))
  `, [tenantId, user.email])).rows[0];
  const isPlatformAdmin = operator(user, config);
  if (!isPlatformAdmin && (!membership || (manage && !['owner', 'admin'].includes(membership.role)))) {
    fail(403, 'no_access');
  }
  return { ...tenant, languages: await effectiveLanguages(client, tenant), role: isPlatformAdmin ? 'operator' : membership.role };
}

export function requirePlatformAdmin(user, config) {
  if (!operator(user, config)) {
    fail(403, 'operator_required');
  }
}
