import { access, requirePlatformAdmin } from './access.js';
import { audit } from './audit.js';
import { transaction, uid } from './database.js';
import { fail } from './errors.js';
import { billingSettings, billingPeriod, reconcileTenantBilling, walletDetails, ledgerNumbers } from './billing.js';
import { seatedMembership } from './membership-policy.js';

export async function updateUnitPrice(pool, config, user, unitPrice) {
  requirePlatformAdmin(user, config);
  await transaction(pool, async db => {
    const result = await db.query('SELECT unit_price_cents FROM billing_settings WHERE singleton FOR UPDATE');
    await db.query('UPDATE billing_settings SET unit_price_cents=$1 WHERE singleton', [unitPrice]);
    await audit(db, user, 'billing.price.update', null, {
      previous_cents: result.rows[0].unit_price_cents, unit_price_cents: unitPrice,
    });
  });
}

export async function tenantWallet(pool, config, user, tenantId) {
  const tenant = await access(pool, tenantId, user, config, { manage: true });
  if (!['owner', 'operator'].includes(tenant.role)) {
    fail(403, 'owner_required', 'Баланс доступен владельцу организации.');
  }
  return transaction(pool, async db => {
    await reconcileTenantBilling(db, tenantId);
    return walletDetails(db, tenantId);
  });
}

export async function adjustBalance(pool, config, user, tenantId, body) {
  requirePlatformAdmin(user, config);
  return transaction(pool, async db => {
    await access(db, tenantId, user, config, { lock: true });
    const { idempotency_key, ...request } = body;
    const existing = await db.query(
      'SELECT * FROM balance_ledger WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, idempotency_key],
    );
    const previous = existing.rows[0];
    if (previous) {
      if (!Object.entries(request).every(([key, value]) => previous.request[key] === value)) {
        fail(409, 'idempotency_conflict', 'Этот идентификатор уже использован для другой операции.');
      }
      return ledgerNumbers(previous);
    }
    await db.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [tenantId]);
    const wallet = await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [tenantId]);
    const before = Number(wallet.rows[0].balance_cents);
    const after = body.operation === 'credit' ? before + body.amount_cents : body.amount_cents;
    if (after > 9000000000000) fail(422, 'balance_too_large', 'Слишком большой баланс.');
    const result = await db.query(`
      INSERT INTO balance_ledger(
        id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,actor_id,source
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING *
    `, [
      uid(), tenantId, after - before, before, after,
      body.operation === 'credit' ? 'credit' : 'adjustment',
      body.reason, idempotency_key, request, user.id,
    ]);
    await db.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1', [tenantId, after]);
    await audit(db, user, 'billing.balance.' + body.operation, tenantId, {
      entry_id: result.rows[0].id, delta_cents: after - before,
    });
    await reconcileTenantBilling(db, tenantId);
    return ledgerNumbers(result.rows[0]);
  });
}

export async function dashboard(pool, config, user) {
  requirePlatformAdmin(user, config);
  const period = await billingPeriod(pool);
  const settings = await billingSettings(pool);
  const result = await pool.query(`
    SELECT t.id,t.name,t.status,COALESCE(w.balance_cents,0) AS balance_cents,
      (SELECT count(*)::int FROM memberships m
        WHERE m.tenant_id=t.id AND m.product_enabled AND ${seatedMembership}) AS connected_seats,
      (SELECT count(*)::int FROM seat_charges s WHERE s.tenant_id=t.id AND s.period=$1) AS billed_seats,
      (SELECT COALESCE(sum(unit_price_cents),0) FROM seat_charges s
        WHERE s.tenant_id=t.id AND s.period=$1) AS invoice_amount_cents,
      (SELECT count(*)::int FROM usage u WHERE u.tenant_id=t.id
        AND u.created_at>=($1::date::timestamp AT TIME ZONE 'UTC')
        AND u.created_at<(($1::date+interval '1 month') AT TIME ZONE 'UTC')
        AND u.status='success') AS requests,
      (SELECT count(DISTINCT user_id)::int FROM usage u WHERE u.tenant_id=t.id
        AND u.created_at>=($1::date::timestamp AT TIME ZONE 'UTC')
        AND u.created_at<(($1::date+interval '1 month') AT TIME ZONE 'UTC')
        AND u.status='success') AS active_users,
      (SELECT max(created_at) FROM usage u WHERE u.tenant_id=t.id) AS last_activity
    FROM tenants t LEFT JOIN tenant_wallets w ON w.tenant_id=t.id ORDER BY t.created_at
  `, [period]);
  const tenants = result.rows.map(row => ({
    ...row, balance_cents: Number(row.balance_cents), invoice_amount_cents: Number(row.invoice_amount_cents),
  }));
  return {
    ...settings, period, tenants,
    billed_seats: tenants.reduce((sum, tenant) => sum + tenant.billed_seats, 0),
    invoice_amount_cents: tenants.reduce((sum, tenant) => sum + tenant.invoice_amount_cents, 0),
    connected_seats: tenants.reduce((sum, tenant) => sum + tenant.connected_seats, 0),
  };
}
