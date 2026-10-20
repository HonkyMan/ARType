import { describeProductAccess } from './entitlements.js';
import { fail } from './errors.js';
import { transaction } from './database.js';
import { seatedMembership } from './membership-policy.js';

export async function billingPeriod(db) {
  const result = await db.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-01') AS period");
  return result.rows[0].period;
}

export async function billingSettings(db) {
  const result = await db.query('SELECT unit_price_cents,currency FROM billing_settings WHERE singleton');
  return { ...result.rows[0], collection_enabled: true };
}

const moneyColumns = new Set(['delta_cents', 'balance_before', 'balance_after', 'balance_cents']);
export function ledgerNumbers(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, moneyColumns.has(key) ? Number(value) : value]));
}

export async function reconcileTenantBilling(db, tenantId, period) {
  // Enrollment, renewal and credits share this lock. Charge the entire unpaid
  // batch atomically; already paid seats remain valid when a later batch cannot pay.
  const result = await db.query('SELECT status,access_until FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
  const tenant = result.rows[0];
  if (!tenant) fail(404, 'tenant_missing', 'Организация не найдена.');
  period ??= await billingPeriod(db);
  await db.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [tenantId]);
  const wallet = await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenantId]);
  const settings = await billingSettings(db);
  const unpaid = await db.query(`
    SELECT m.email FROM memberships m
    LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$2
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seatedMembership} AND s.email IS NULL
    ORDER BY m.email
  `, [tenantId, period]);
  const due = unpaid.rows.length * settings.unit_price_cents;
  const balance = Number(wallet.rows[0].balance_cents);
  const inactive = tenant.status !== 'active' || (tenant.access_until && new Date(tenant.access_until) <= new Date());
  if (inactive || balance < due) {
    return { pending_seats: unpaid.rows.length, required_cents: due, missing_cents: Math.max(0, due - balance) };
  }
  if (unpaid.rows.length) {
    await db.query(`
      WITH seats AS (
        SELECT email,row_number() OVER(ORDER BY email) AS n FROM unnest($2::text[]) AS email
      ), ledger AS (
        INSERT INTO balance_ledger(
          id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,source
        ) SELECT gen_random_uuid(),$1,-$4::bigint,$5::bigint-(n-1)*$4::bigint,$5::bigint-n*$4::bigint,
          'seat_charge','Место '||email||' за '||left($3,7),'seat:'||$3||':'||email,
          jsonb_build_object('email',email,'period',$3::text,'unit_price_cents',$4::int),'system'
        FROM seats RETURNING id,request
      ) INSERT INTO seat_charges(tenant_id,email,period,unit_price_cents,ledger_id)
        SELECT $1,request->>'email',$3::date,$4,id FROM ledger
    `, [tenantId, unpaid.rows.map(member => member.email), period, settings.unit_price_cents, balance]);
    await db.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1', [tenantId, balance - due]);
  }
  return { pending_seats: 0, required_cents: 0, missing_cents: 0 };
}

export async function productAccess(db, tenantId, email, period) {
  period ??= await billingPeriod(db);
  const result = await db.query(`
    SELECT m.*,t.status AS tenant_status,t.access_until,s.email IS NOT NULL AS paid
    FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$3
    WHERE m.tenant_id=$1 AND m.email=$2
  `, [tenantId, email, period]);
  const member = result.rows[0];
  return describeProductAccess(member, member?.tenant_status, member?.access_until, member?.paid, period);
}

export async function memberProductStatuses(db, tenant, members) {
  const period = await billingPeriod(db);
  const charges = await db.query('SELECT email FROM seat_charges WHERE tenant_id=$1 AND period=$2', [tenant.id, period]);
  const paid = new Set(charges.rows.map(row => row.email));
  return members.map(member => ({
    ...member,
    ...describeProductAccess(member, tenant.status, tenant.access_until, paid.has(member.email), period),
  }));
}

export async function walletDetails(db, tenantId) {
  const settings = await billingSettings(db);
  const period = await billingPeriod(db);
  const wallet = await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenantId]);
  const balance = Number(wallet.rows[0]?.balance_cents || 0);
  const pending = await db.query(`
    SELECT count(*)::int AS count FROM memberships m
    LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$2
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seatedMembership} AND s.email IS NULL
  `, [tenantId, period]);
  const ledger = await db.query(`
    SELECT l.id,l.kind,l.delta_cents,l.balance_before,l.balance_after,l.reason,l.created_at,u.email AS actor_email
    FROM balance_ledger l LEFT JOIN users u ON u.id=l.actor_id
    WHERE l.tenant_id=$1 ORDER BY sequence DESC LIMIT 50
  `, [tenantId]);
  const required = pending.rows[0].count * settings.unit_price_cents;
  return {
    balance_cents: balance, ...settings, period,
    pending_seats: pending.rows[0].count,
    required_cents: required, missing_cents: Math.max(0, required - balance),
    entries: ledger.rows.map(ledgerNumbers),
  };
}

export async function renewDueTenants(pool) {
  const period = await billingPeriod(pool);
  let after = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const result = await pool.query(`
      SELECT DISTINCT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$1
      WHERE m.tenant_id>$2 AND t.status='active' AND (t.access_until IS NULL OR t.access_until>clock_timestamp())
        AND m.product_enabled AND ${seatedMembership} AND s.email IS NULL
      ORDER BY m.tenant_id LIMIT 100
    `, [period, after]);
    if (!result.rows.length) return;
    for (const row of result.rows) {
      // Recompute the period after locking: a run may cross a UTC month boundary.
      await transaction(pool, db => reconcileTenantBilling(db, row.tenant_id));
    }
    after = result.rows.at(-1).tenant_id;
  }
}
