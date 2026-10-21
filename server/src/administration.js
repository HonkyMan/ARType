import { audit } from './audit.js';
import { fail } from './errors.js';
import { requirePlatformAdmin } from './access.js';
import { transaction } from './database.js';

export function installAdministration(app, { pool, config, validate, email }) {
  app.get('/api/platform-admins', async (req, res) => {
    requirePlatformAdmin(req.user, config);
    const result = await pool.query('SELECT email,created_at FROM platform_admins ORDER BY email');
    const administrators = new Map(result.rows.map(admin => [admin.email, { ...admin, protected: false }]));
    for (const address of config.adminEmails) {
      administrators.set(address, { email: address, protected: true, created_at: null });
    }
    res.json({ administrators: [...administrators.values()].sort((a, b) => a.email.localeCompare(b.email)) });
  });
  for (const method of ['put', 'delete']) {
    app[method]('/api/platform-admins/:email', async (req, res) => {
      requirePlatformAdmin(req.user, config);
      const target = validate(email, req.params.email);
      await transaction(pool, async db => {
        await db.query('SELECT pg_advisory_xact_lock(63821018)');
        // Recheck under the administration lock: another admin may have revoked
        // the caller after authentication but before this mutation acquired it.
        if (!config.adminEmails.includes(req.user.email)) {
          const current = await db.query('SELECT 1 FROM platform_admins WHERE email=$1', [req.user.email]);
          if (!current.rowCount) fail(403, 'operator_required');
        }
        if (method === 'delete') {
          if (config.adminEmails.includes(target)) {
            fail(409, 'protected_admin');
          }
          if (target === req.user.email) fail(409, 'self_removal');
          const result = await db.query('DELETE FROM platform_admins WHERE email=$1', [target]);
          if (result.rowCount) await audit(db, req.user, 'platform.admin.remove', null, { email: target });
        } else if (!config.adminEmails.includes(target)) {
          const result = await db.query(`
            INSERT INTO platform_admins(email,added_by) VALUES($1,$2) ON CONFLICT DO NOTHING
          `, [target, req.user.id]);
          if (result.rowCount) await audit(db, req.user, 'platform.admin.add', null, { email: target });
        }
      });
      res.json({ ok: true });
    });
  }
}
