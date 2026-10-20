import { createHash } from 'node:crypto';
import { access } from './access.js';
import { transaction } from './database.js';
import { billingPeriod, billingSettings, reconcileTenantBilling } from './billing.js';
import { membershipEnabled, seatedMembership } from './membership-policy.js';
import { fail } from './errors.js';

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestData = body => ({member_ids: [...body.member_ids].sort(), enabled: body.enabled});

async function quote(db, tenant, body) {
  if (tenant.plan !== 'business') fail(403, 'business_required');
  const members = (await db.query('SELECT * FROM memberships WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
    [tenant.id, body.member_ids])).rows;
  if (members.length !== body.member_ids.length) fail(404, 'member_missing');
  if (tenant.role === 'admin' && members.some(m => m.role !== 'member')) fail(403, 'owner_required');
  return quoteAccessForMembers(db, tenant, members, body.enabled);
}

// Also used for not-yet-inserted invitations; the caller holds the tenant lock.
export async function quoteAccessForMembers(db, tenant, members, enabled) {
  // Keep the price stable until this transaction commits.
  await db.query('SELECT singleton FROM billing_settings WHERE singleton FOR SHARE');
  const prices = await billingSettings(db);
  const period = await billingPeriod(db);
  const next = new Date(period + 'T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  const subscription = (await db.query('SELECT 1 FROM subscription_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period])).rowCount > 0;
  const paid = new Set((await db.query('SELECT email FROM seat_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period])).rows.map(r => r.email));
  const balance = Number((await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenant.id])).rows[0]?.balance_cents || 0);
  const unpaid = members.filter(m => !paid.has(m.email));
  const enabledOutside = (await db.query(`SELECT count(*)::int n FROM memberships m WHERE tenant_id=$1
    AND NOT(id=ANY($2::uuid[])) AND product_enabled AND ${seatedMembership}`, [tenant.id, members.filter(m => m.persisted !== false).map(m => m.id)])).rows[0].n;
  let blocked = null;
  if (enabled) {
    if (tenant.status !== 'active' || tenant.access_until && new Date(tenant.access_until) <= new Date()) blocked = 'tenant_inactive';
    else if (!tenant.renewal_enabled) blocked = 'renewal_paused';
    else if (members.some(m => !membershipEnabled(m))) blocked = 'members_inactive';
    else if (enabledOutside + members.length > tenant.seats) blocked = 'seats_full';
  }
  const base = enabled && !subscription ? prices.business_price_cents : 0;
  const seats = enabled ? unpaid.length * prices.unit_price_cents : 0;
  const total = base + seats;
  if (!blocked && enabled && balance < total) blocked = 'insufficient_balance';
  const result = {
    enabled: enabled, period, next_period: next.toISOString().slice(0,10),
    selected_count: members.length, changed_count: members.filter(m => m.product_enabled !== enabled).length,
    members: members.map(m => ({id:m.id,email:m.email,product_enabled:m.product_enabled})),
    new_paid_seats: enabled ? unpaid.length : 0,
    already_paid_seats: enabled ? members.length - unpaid.length : 0,
    base_cents: base, seats_cents: seats, total_cents: total,
    unit_price_cents: prices.unit_price_cents,
    can_manage_balance: tenant.role !== 'admin',
    balance_cents: tenant.role === 'admin' ? null : balance,
    missing_cents: tenant.role === 'admin' ? null : Math.max(0,total-balance),
    allowed: !blocked, blocked,
  };
  // The caller confirms an exact snapshot. A changed month, price, membership,
  // capacity or balance requires another visible quote, never a larger charge.
  result.quote_token = fingerprint({result,balance,seats:tenant.seats,
    members:members.map(m=>[m.id,m.status,m.expires_at,m.product_enabled]),renewal:tenant.renewal_enabled});
  return result;
}

export async function quoteMemberAccess(pool, config, user, tenantId, body) {
  return transaction(pool, async db => quote(db,
    await access(db, tenantId, user, config, {manage:true,lock:true}), requestData(body)));
}

export async function changeMemberAccess(pool, config, user, tenantId, body) {
  return transaction(pool, async db => {
    const tenant = await access(db, tenantId, user, config, {manage:true,lock:true});
    const request = requestData(body);
    // Audit rows for this operation are also its durable replay journal.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['member-access:' + body.idempotency_key]);
    const prior = (await db.query('SELECT * FROM audit WHERE id=$1', [body.idempotency_key])).rows[0];
    if (prior) {
      if (prior.action !== 'members.product' || prior.tenant_id !== tenantId || prior.actor_id !== user.id ||
          fingerprint(requestData(prior.details.request)) !== fingerprint(request)) fail(409, 'idempotency_conflict');
      return prior.details.result;
    }
    const current = await quote(db, tenant, request);
    if (current.quote_token !== body.quote_token) fail(409, 'access_quote_changed');
    if (!current.allowed) fail(current.blocked === 'insufficient_balance' ? 402 : 409, current.blocked);
    await db.query('UPDATE memberships SET product_enabled=$3 WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
      [tenantId, request.member_ids, request.enabled]);
    if (request.enabled) {
      const paid = await reconcileTenantBilling(db, tenantId, current.period, current.members.map(m => m.email));
      if (paid.required_cents) fail(409, 'access_quote_changed');
    }
    const result = {changed_count:current.changed_count,charged_cents:current.total_cents,enabled:request.enabled,next_period:current.next_period};
    await db.query("INSERT INTO audit(id,actor_id,action,tenant_id,details) VALUES($1,$2,'members.product',$3,$4)",
      [body.idempotency_key,user.id,tenantId,{request,result}]);
    return result;
  });
}
