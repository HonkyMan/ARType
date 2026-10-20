import { access, requirePlatformAdmin } from './access.js';
import { audit } from './audit.js';
import { transaction, uid } from './database.js';
import { reconcileTenantBilling, ledgerNumbers } from './billing.js';
import { fail } from './errors.js';

export async function createPaymentOrder(pool, config, user, tenantId, body) {
  return transaction(pool, async db => {
    const tenant = await access(db, tenantId, user, config, {manage: true, lock: true});
    if (!['owner','operator'].includes(tenant.role)) fail(403, 'owner_required');
    const previous = (await db.query('SELECT * FROM payment_orders WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, body.idempotency_key])).rows[0];
    if (previous) {
      if (Number(previous.amount_cents) !== body.amount_cents) fail(409, 'idempotency_conflict');
      return ledgerNumbers(previous);
    }
    return ledgerNumbers((await db.query(`INSERT INTO payment_orders(id,tenant_id,created_by,amount_cents,idempotency_key)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [uid(), tenantId, user.id, body.amount_cents, body.idempotency_key])).rows[0]);
  });
}

/** Trusted payment boundary. Call only after an adapter has verified the provider
 * signature and authoritative payment amount/currency. Never expose directly to
 * a browser route. The current manual adapter requires platform-admin access. */
export async function settlePayment(pool, {orderId, amountCents, currency, provider, reference, actor = null}) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 9000000000000 ||
      typeof provider !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(provider) ||
      typeof reference !== 'string' || !reference.trim() || reference.length > 200) fail(422, 'invalid_input');
  return transaction(pool, async db => {
    const order = (await db.query('SELECT * FROM payment_orders WHERE id=$1', [orderId])).rows[0];
    if (!order) fail(404, 'payment_missing');
    // Every path locks workspace before order, consistent with billing writers.
    await db.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [order.tenant_id]);
    const current = (await db.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!provider || !reference || Number(current.amount_cents) !== amountCents || current.currency !== currency) fail(409, 'payment_mismatch');
    if (current.status === 'paid') {
      if (current.provider !== provider || current.provider_reference !== reference) fail(409, 'payment_conflict');
      return ledgerNumbers(current);
    }
    if (current.status !== 'pending') fail(409, 'payment_closed');
    // A provider reference is globally unique, including across workspaces.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['payment:' + JSON.stringify([provider, reference])]);
    if ((await db.query('SELECT id FROM payment_orders WHERE provider=$1 AND provider_reference=$2', [provider, reference])).rowCount) fail(409, 'payment_conflict');
    await db.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [current.tenant_id]);
    const before = Number((await db.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1', [current.tenant_id])).rows[0].balance_cents);
    const after = before + amountCents;
    if (after > 9000000000000) fail(422, 'balance_too_large');
    const ledgerId = uid();
    await db.query(`INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,actor_id,source)
      VALUES($1,$2,$3,$4,$5,'credit',$6,$7,$8,$9,'payment')`, [ledgerId, current.tenant_id, amountCents, before, after,
      reference, 'payment:' + orderId, {order_id: orderId, provider, reference, currency, amount_cents: amountCents}, actor?.id || null]);
    await db.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1', [current.tenant_id, after]);
    await db.query("UPDATE payment_orders SET status='paid',provider=$2,provider_reference=$3,ledger_id=$4,paid_at=now() WHERE id=$1", [orderId, provider, reference, ledgerId]);
    if (actor) await audit(db, actor, 'payment.settle', current.tenant_id, {order_id: orderId, ledger_id: ledgerId});
    await reconcileTenantBilling(db, current.tenant_id);
    return ledgerNumbers((await db.query('SELECT * FROM payment_orders WHERE id=$1', [orderId])).rows[0]);
  });
}
export async function settleManualPayment(pool, config, user, orderId, body) {
  requirePlatformAdmin(user, config);
  return settlePayment(pool, {orderId, amountCents: body.amount_cents, currency: body.currency, provider: 'manual', reference: body.reference, actor: user});
}
