import { access, requirePlatformAdmin } from './access.js';
import { audit } from './audit.js';
import { transaction, uid } from './database.js';
import { billingSettings, reconcileTenantBilling } from './billing.js';
import { credentialList } from './connections.js';
import { fail } from './errors.js';

export async function planCatalog(db) {
  const prices = await billingSettings(db);
  const defaults = (await db.query('SELECT plan,registration_enabled FROM plan_defaults ORDER BY plan')).rows;
  return {currency: prices.currency, plans: defaults.map(item => ({...item,
    price_cents: prices[item.plan + '_price_cents'], seat_price_cents: item.plan === 'business' ? prices.unit_price_cents : 0,
  }))};
}
export async function planConfiguration(db, config, user) {
  requirePlatformAdmin(user, config);
  return {defaults: (await db.query('SELECT * FROM plan_defaults ORDER BY plan')).rows, connections: await credentialList(db, config)};
}
export async function savePlanConfiguration(pool, config, user, plan, body) {
  requirePlatformAdmin(user, config);
  await transaction(pool, async db => {
    const connections = await credentialList(db, config);
    if (body.registration_enabled && !connections.some(c => c.alias === body.credential)) fail(422, 'provider_missing');
    if (plan === 'plus' && body.seats !== 1) fail(422, 'plus_seats');
    await db.query(`UPDATE plan_defaults SET registration_enabled=$2,credential=$3,model=$4,monthly_characters=$5,seats=$6,languages=$7 WHERE plan=$1`,
      [plan, body.registration_enabled, body.credential, body.model, body.monthly_characters, body.seats, JSON.stringify(body.languages)]);
    await audit(db, user, 'plan.defaults.update', null, {plan});
  });
}
export async function createWorkspace(pool, config, user, body) {
  return transaction(pool, async db => {
    // Serializes retries and the one-personal-workspace constraint per identity.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const retry = (await db.query('SELECT id,plan,name FROM tenants WHERE created_by=$1 AND creation_key=$2', [user.id, body.idempotency_key])).rows[0];
    if (retry) {
      if (retry.plan !== body.plan || retry.name !== body.name) fail(409, 'idempotency_conflict');
      return {id: retry.id, existing: true};
    }
    if (body.plan === 'plus') {
      const existing = await db.query('SELECT id FROM tenants WHERE personal_owner_id=$1', [user.id]);
      if (existing.rowCount) return {id: existing.rows[0].id, existing: true};
    }
    const defaults = (await db.query('SELECT * FROM plan_defaults WHERE plan=$1', [body.plan])).rows[0];
    if (!defaults.registration_enabled) fail(409, 'registration_unavailable');
    if (!(await credentialList(db, config)).some(c => c.alias === defaults.credential)) fail(503, 'provider_missing');
    const id = uid();
    await db.query(`INSERT INTO tenants(id,name,plan,personal_owner_id,seats,monthly_characters,model,credential,languages,created_by,creation_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, body.name, body.plan, body.plan === 'plus' ? user.id : null,
      defaults.seats, defaults.monthly_characters, defaults.model, defaults.credential, JSON.stringify(defaults.languages), user.id, body.idempotency_key]);
    await db.query(`INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled) VALUES($1,$2,$3,'owner','active',$4)`,
      [uid(), id, user.email, body.plan === 'plus']);
    await reconcileTenantBilling(db, id);
    await audit(db, user, 'workspace.create', id, {plan: body.plan});
    return {id};
  });
}
export async function setRenewal(pool, config, user, id, enabled) {
  await transaction(pool, async db => {
    const tenant = await access(db, id, user, config, {manage: true, lock: true});
    if (!['owner','operator'].includes(tenant.role)) fail(403, 'owner_required');
    await db.query('UPDATE tenants SET renewal_enabled=$2 WHERE id=$1', [id, enabled]);
    if (enabled) await reconcileTenantBilling(db, id);
    await audit(db, user, 'subscription.renewal', id, {enabled});
  });
}
