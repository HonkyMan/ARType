import { describeProductAccess } from './entitlements.js';
import { fail } from './errors.js';
import { transaction } from './database.js';
import { seatedMembership } from './membership-policy.js';

export async function billingPeriod(db) {
  return (await db.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-01') AS period")).rows[0].period;
}
export async function billingSettings(db) {
  return (await db.query('SELECT unit_price_cents,plus_price_cents,business_price_cents,currency FROM billing_settings WHERE singleton')).rows[0];
}
const moneyColumns = new Set(['delta_cents', 'balance_before', 'balance_after', 'balance_cents', 'amount_cents']);
export function ledgerNumbers(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, moneyColumns.has(key) ? Number(value) : value]));
}

async function billingDue(db, tenant, period, settings, emails = null) {
  const subscription = await db.query('SELECT 1 FROM subscription_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period]);
  const unpaid = tenant.plan === 'plus' ? {rows: []} : await db.query(`
    SELECT m.email FROM memberships m
    LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$2
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seatedMembership} AND s.email IS NULL
      AND ($3::text[] IS NULL OR m.email=ANY($3)) ORDER BY m.email
  `, [tenant.id, period, emails]);
  const basePrice = settings[tenant.plan + '_price_cents'];
  const baseDue = subscription.rowCount ? 0 : basePrice;
  return {basePrice, baseDue, basePaid: !!subscription.rowCount, unpaid: unpaid.rows, total: baseDue + unpaid.rows.length * settings.unit_price_cents};
}

export async function reconcileTenantBilling(db, tenantId, period, emails = null) {
  // All enrollment, renewal and payment writers lock the workspace first.
  const tenant = (await db.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])).rows[0];
  if (!tenant) fail(404, 'tenant_missing');
  period ??= await billingPeriod(db);
  await db.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [tenantId]);
  const balance = Number((await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenantId])).rows[0].balance_cents);
  const settings = await billingSettings(db);
  const due = await billingDue(db, tenant, period, settings, emails);
  const inactive = tenant.status !== 'active' || !tenant.renewal_enabled || (tenant.access_until && new Date(tenant.access_until) <= new Date());
  if (inactive || balance < due.total) return {pending_seats: due.unpaid.length, required_cents: due.total, missing_cents: Math.max(0, due.total - balance)};
  let remaining = balance;
  async function charge(kind, amount, key, request) {
    const result = await db.query(`
      INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,source)
      VALUES(gen_random_uuid(),$1,-$2::bigint,$3,$4,$5,$5,$6,$7,'system') RETURNING id
    `, [tenantId, amount, remaining, remaining - amount, kind, key, request]);
    remaining -= amount;
    return result.rows[0].id;
  }
  if (!due.basePaid) {
    const id = await charge('subscription_charge', due.baseDue, 'subscription:' + period, {plan: tenant.plan, period, amount_cents: due.baseDue});
    await db.query('INSERT INTO subscription_charges VALUES($1,$2,$3,$4,$5)', [tenantId, period, tenant.plan, due.baseDue, id]);
  }
  if (due.unpaid.length) {
    await db.query(`
      WITH seats AS (
        SELECT email,row_number() OVER(ORDER BY email) AS n FROM unnest($2::text[]) AS email
      ), ledger AS (
        INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,source)
        SELECT gen_random_uuid(),$1,-$4::bigint,$5::bigint-(n-1)*$4::bigint,$5::bigint-n*$4::bigint,
          'seat_charge','seat_charge','seat:'||$3||':'||email,
          jsonb_build_object('email',email,'period',$3::text,'unit_price_cents',$4::int),'system'
        FROM seats ORDER BY n RETURNING id,request
      ) INSERT INTO seat_charges(tenant_id,email,period,unit_price_cents,ledger_id)
        SELECT $1,request->>'email',$3::date,$4,id FROM ledger
    `, [tenantId,due.unpaid.map(member=>member.email),period,settings.unit_price_cents,remaining]);
    remaining -= due.unpaid.length * settings.unit_price_cents;
  }
  await db.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1', [tenantId, remaining]);
  return {pending_seats: 0, required_cents: 0, missing_cents: 0};
}

export async function productAccess(db, tenantId, email, period) {
  period ??= await billingPeriod(db);
  const member = (await db.query(`
    SELECT m.*,t.status AS tenant_status,t.access_until,
      b.tenant_id IS NOT NULL AND (t.plan='plus' OR s.email IS NOT NULL) AS paid
    FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    LEFT JOIN subscription_charges b ON b.tenant_id=t.id AND b.period=$3
    LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$3
    WHERE m.tenant_id=$1 AND m.email=$2
  `, [tenantId, email, period])).rows[0];
  return describeProductAccess(member, member?.tenant_status, member?.access_until, member?.paid, period);
}
export async function memberProductStatuses(db, tenant, members) {
  const period = await billingPeriod(db);
  const charges = await db.query('SELECT email FROM seat_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period]);
  const base = await db.query('SELECT 1 FROM subscription_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period]);
  const paid = new Set(charges.rows.map(row => row.email));
  return members.map(member => ({...member,
    ...describeProductAccess(member, tenant.status, tenant.access_until, !!base.rowCount && (tenant.plan === 'plus' || paid.has(member.email)), period),
  }));
}
export async function walletDetails(db, tenantId) {
  const settings = await billingSettings(db);
  const period = await billingPeriod(db);
  const tenant = (await db.query('SELECT * FROM tenants WHERE id=$1', [tenantId])).rows[0];
  const wallet = await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenantId]);
  const balance = Number(wallet.rows[0]?.balance_cents || 0);
  const due = await billingDue(db, tenant, period, settings);
  const ledger = await db.query(`
    SELECT l.id,l.kind,l.delta_cents,l.balance_before,l.balance_after,l.reason,l.request,l.source,l.created_at,u.email AS actor_email
    FROM balance_ledger l LEFT JOIN users u ON u.id=l.actor_id
    WHERE l.tenant_id=$1 ORDER BY sequence DESC LIMIT 50
  `, [tenantId]);
  const orders = await db.query('SELECT id,amount_cents,currency,status,created_at,paid_at FROM payment_orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tenantId]);
  return {balance_cents: balance, ...settings, period, plan: tenant.plan, renewal_enabled: tenant.renewal_enabled,
    base_price_cents: due.basePrice, subscription_paid: due.basePaid, subscription_due_cents: due.baseDue,
    pending_seats: due.unpaid.length, required_cents: due.total, missing_cents: Math.max(0, due.total - balance),
    entries: ledger.rows.map(ledgerNumbers), orders: orders.rows.map(ledgerNumbers)};
}
export async function renewDueTenants(pool) {
  const period = await billingPeriod(pool);
  let after = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const result = await pool.query(`
      SELECT t.id AS tenant_id FROM tenants t
      WHERE t.id>$2 AND t.status='active' AND t.renewal_enabled AND (t.access_until IS NULL OR t.access_until>clock_timestamp())
      AND (NOT EXISTS(SELECT 1 FROM subscription_charges b WHERE b.tenant_id=t.id AND b.period=$1)
        OR (t.plan='business' AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=t.id AND m.product_enabled AND ${seatedMembership}
          AND NOT EXISTS(SELECT 1 FROM seat_charges s WHERE s.tenant_id=t.id AND s.email=m.email AND s.period=$1))))
      ORDER BY t.id LIMIT 100
    `, [period, after]);
    if (!result.rows.length) return;
    for (const row of result.rows) await transaction(pool, db => reconcileTenantBilling(db, row.tenant_id));
    after = result.rows.at(-1).tenant_id;
  }
}
