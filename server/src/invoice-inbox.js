import { z } from 'zod';
import { requirePlatformAdmin } from './access.js';
import { validate, uuid } from './schemas.js';
import { ledgerNumbers } from './billing.js';

// Optional operator inbox: a read-only projection of durable payment orders.
// Removing this module/route does not change ordering, settlement or app access.
export function installInvoiceInbox(app, {pool, config}) {
  app.get('/api/invoice-requests', async (req,res) => {
    requirePlatformAdmin(req.user,config);
    const {status,after} = validate(z.object({
      status:z.enum(['pending','paid','all']).default('pending'),after:uuid.optional(),
    }).strict(),req.query);
    const rows = (await pool.query(`SELECT p.id,p.tenant_id,p.amount_cents,p.currency,p.status,p.created_at,p.paid_at,
      t.name AS workspace_name,u.email AS requested_by
      FROM payment_orders p JOIN tenants t ON t.id=p.tenant_id JOIN users u ON u.id=p.created_by
      WHERE ($1='all' OR p.status=$1) AND ($2::uuid IS NULL OR (p.created_at,p.id) <
        (SELECT created_at,id FROM payment_orders WHERE id=$2))
      ORDER BY p.created_at DESC,p.id DESC LIMIT 51`,[status,after || null])).rows;
    const pending = (await pool.query("SELECT count(*)::int n FROM payment_orders WHERE status='pending'")).rows[0].n;
    res.json({requests:rows.slice(0,50).map(ledgerNumbers),pending_count:pending,next_cursor:rows.length>50?rows[49].id:null});
  });
}
