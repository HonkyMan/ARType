import { activateMemberships, operator } from '../access.js';
import { transaction } from '../database.js';
import { reconcileTenantBilling, productAccess } from '../billing.js';

export function installProfile(app, { pool, config }) {
  app.get('/api/me', async (req, res) => {
    await transaction(pool, db => activateMemberships(db, req.user.email));
    const isOperator = operator(req.user, config);
    const result = isOperator
      ? await pool.query(`SELECT t.*,'operator' AS role FROM tenants t
          WHERE t.personal_owner_id=$1 OR EXISTS(SELECT 1 FROM memberships m
            WHERE m.tenant_id=t.id AND m.email=$2 AND m.status='active') ORDER BY t.created_at`, [req.user.id, req.user.email])
      : await pool.query(`
        SELECT t.*,m.role FROM tenants t JOIN memberships m ON t.id=m.tenant_id
        WHERE m.email=$1 AND m.status='active' ORDER BY t.created_at
      `, [req.user.email]);
    const tenants = [];
    for (const tenant of result.rows) {
      const entitlement = await transaction(pool, async db => {
        await reconcileTenantBilling(db, tenant.id);
        return productAccess(db, tenant.id, req.user.email);
      });
      tenants.push({
        id: tenant.id, name: tenant.name, plan: tenant.plan, renewal_enabled: tenant.renewal_enabled, role: tenant.role, status: tenant.status,
        languages: tenant.languages, revision: tenant.revision, access_until: tenant.access_until,
        ...entitlement,
      });
    }
    res.json({ user: req.user, csrf: req.session.csrf, operator: isOperator, tenants,
      features:{invoice_inbox:config.invoiceInboxEnabled !== false} });
  });
}
