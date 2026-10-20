import { access, requirePlatformAdmin } from './access.js';
import { audit } from './audit.js';
import { reconcileTenantBilling, walletDetails, memberProductStatuses } from './billing.js';
import { credentialList } from './connections.js';
import { transaction, uid } from './database.js';
import { fail } from './errors.js';
import { membershipEnabled, seatedMembership } from './membership-policy.js';

async function occupiedSeats(db, tenantId) {
  const result = await db.query(`
    SELECT count(*)::int AS count FROM memberships m
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seatedMembership}
  `, [tenantId]);
  return result.rows[0].count;
}

// Columns are supplied by the strict HTTP schema, never raw request keys.
const columnValue = (key, value) => key === 'languages' ? JSON.stringify(value) : value;

export async function listTenants(pool, config, user) {
  requirePlatformAdmin(user, config);
  const result = await pool.query(`
    SELECT t.*,
      (SELECT count(*)::int FROM memberships m
        WHERE m.tenant_id=t.id AND m.product_enabled AND ${seatedMembership}) AS used_seats,
      COALESCE((SELECT sum(characters) FROM usage
        WHERE tenant_id=t.id AND status='success'
          AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS used_characters
    FROM tenants t ORDER BY created_at
  `);
  const connections = await credentialList(pool, config);
  return {
    tenants: result.rows,
    credentials: connections.map(connection => connection.alias),
    connections,
    default_model: config.defaultModel || '',
  };
}

export async function createTenant(pool, config, user, body) {
  requirePlatformAdmin(user, config);
  const id = uid();
  await transaction(pool, async db => {
    const { owner_email, ...fields } = body;
    const entries = Object.entries({ ...fields, id });
    const columns = entries.map(([key]) => key);
    const values = entries.map(([key, value]) => columnValue(key, value));
    const placeholders = values.map((_, index) => `$${index + 1}`);
    await db.query(`INSERT INTO tenants(${columns.join(',')}) VALUES(${placeholders.join(',')})`, values);
    await db.query(`
      INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled)
      VALUES($1,$2,$3,'owner','invited',false)
    `, [uid(), id, owner_email]);
    await audit(db, user, 'tenant.create', id);
  });
  return { id };
}

export async function tenantDetails(pool, config, user, id) {
  const tenant = await access(pool, id, user, config, { manage: true });
  const billing = await transaction(pool, async db => {
    await reconcileTenantBilling(db, id);
    return ['owner', 'operator'].includes(tenant.role) ? walletDetails(db, id) : null;
  });
  const memberships = await pool.query('SELECT * FROM memberships WHERE tenant_id=$1 ORDER BY role,email', [id]);
  const members = await memberProductStatuses(pool, tenant, memberships.rows);
  const usage = await pool.query(`
    SELECT count(*) FILTER(WHERE status='success')::int AS requests,
      COALESCE(sum(characters) FILTER(WHERE status='success'),0)::bigint AS characters,
      COALESCE(sum(input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
      count(*) FILTER(WHERE status='failed')::int AS failures
    FROM usage WHERE tenant_id=$1
      AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  `, [id]);
  const recent = await pool.query(`
    SELECT u.created_at,u.characters,u.status,u.duration_ms,p.email
    FROM usage u JOIN users p ON p.id=u.user_id
    WHERE tenant_id=$1 ORDER BY u.created_at DESC LIMIT 30
  `, [id]);
  return { tenant, members, usage: usage.rows[0], recent: recent.rows, billing };
}

export async function updateTenant(pool, config, user, id, changes) {
  await transaction(pool, async db => {
    const tenant = await access(db, id, user, config, { manage: true, lock: true });
    if (tenant.plan === 'plus' && tenant.role !== 'operator' && Object.keys(changes).some(key => key !== 'name')) fail(403, 'business_required');
    const entries = Object.entries(changes);
    if (!entries.length) fail(422, 'empty_update');
    if (tenant.role !== 'operator' && entries.some(([key]) => !['name', 'instructions', 'languages'].includes(key))) {
      fail(403, 'operator_required');
    }
    if (changes.seats && await occupiedSeats(db, id) > changes.seats) {
      fail(409, 'seats_in_use');
    }
    const assignments = entries.map(([key], index) => `${key}=$${index + 2}`);
    await db.query(`UPDATE tenants SET ${assignments.join(',')},revision=revision+1 WHERE id=$1`, [
      id, ...entries.map(([key, value]) => columnValue(key, value)),
    ]);
    await audit(db, user, 'tenant.update', id);
  });
}

export async function inviteMember(pool, config, user, tenantId, body) {
  await transaction(pool, async db => {
    const tenant = await access(db, tenantId, user, config, { manage: true, lock: true });
    if (tenant.plan === 'plus') fail(403, 'business_required');
    if (tenant.role === 'admin' && body.role !== 'member') {
      fail(403, 'owner_required');
    }
    const result = await db.query('SELECT * FROM memberships WHERE tenant_id=$1 AND email=$2', [tenantId, body.email]);
    const existing = result.rows[0];
    if (tenant.role === 'admin' && existing && existing.role !== 'member') {
      fail(403, 'owner_required');
    }
    if (existing) fail(409, 'already_member');
    // Invitation grants console membership only. Buying app access always uses
    // the explicit quote/confirmation flow, including the owner's own seat.
    await db.query(`
      INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled)
      VALUES($1,$2,$3,$4,'invited',false)
    `, [uid(), tenantId, body.email, body.role]);
    await audit(db, user, 'member.invite', tenantId);
  });
}

export async function updateMember(pool, config, user, tenantId, memberId, changes) {
  if (!Object.keys(changes).length) fail(422, 'empty_update');
  await transaction(pool, async db => {
    const tenant = await access(db, tenantId, user, config, { manage: true, lock: true });
    if (tenant.plan === 'plus') fail(403, 'business_required');
    const result = await db.query('SELECT * FROM memberships WHERE id=$1 AND tenant_id=$2', [memberId, tenantId]);
    const member = result.rows[0];
    if (!member) fail(404, 'member_missing');
    if (tenant.role === 'admin' && (member.role !== 'member' || (changes.role && changes.role !== 'member'))) {
      fail(403, 'owner_required');
    }
    const next = { ...member, ...changes };
    if ((changes.status && changes.status !== member.status) || !membershipEnabled(member)) next.product_enabled = false;
    const removesOwner = member.role === 'owner' && member.status !== 'disabled' &&
      (next.role !== 'owner' || next.status === 'disabled');
    if (removesOwner) {
      const otherOwners = await db.query(`
        SELECT id FROM memberships
        WHERE tenant_id=$1 AND id!=$2 AND role='owner' AND status='active'
      `, [tenantId, memberId]);
      if (!otherOwners.rowCount) {
        fail(409, 'last_owner');
      }
    }
    await db.query(`
      UPDATE memberships SET role=$1,status=$2,product_enabled=$3,
        expires_at=CASE WHEN $5::boolean THEN now()+interval '7 days' ELSE expires_at END
      WHERE id=$4
    `, [next.role, next.status, next.product_enabled, memberId, changes.status === 'invited']);
    await audit(db, user, 'member.update', tenantId);
  });
}

export async function tenantUsageReport(pool, config, user, tenantId) {
  await access(pool, tenantId, user, config, { manage: true });
  const result = await pool.query(`
    SELECT date_trunc('day',u.created_at AT TIME ZONE 'UTC')::date AS day,p.email,
      count(*)::int AS requests,sum(characters) AS characters,
      sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens
    FROM usage u JOIN users p ON p.id=u.user_id
    WHERE tenant_id=$1 AND status='success'
      AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    GROUP BY day,p.email ORDER BY day,p.email
  `, [tenantId]);
  return result.rows;
}
