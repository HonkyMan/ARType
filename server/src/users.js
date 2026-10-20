import {z} from 'zod';
import {requirePlatformAdmin} from './access.js';
import {validate} from './schemas.js';

const querySchema = z.object({
  q:z.string().trim().max(120).default(''),
  type:z.enum(['all','personal','business','both','neither']).default('all'),
  page:z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

// A single row per email, including invitations that have not signed in yet.
// Plan flags indicate membership, never payment or entitlement.
export async function listUsers(pool, config, user, input) {
  requirePlatformAdmin(user, config);
  const query = validate(querySchema, input);
  const result = await pool.query(`
    WITH identities AS (
      SELECT email FROM users UNION SELECT email FROM memberships
    ), directory AS (
      SELECT i.email,u.id,u.name,u.id IS NOT NULL AS registered,
        p.id AS personal_tenant_id,p.id IS NOT NULL AS personal,
        COALESCE(b.count,0)::int AS business_count
      FROM identities i LEFT JOIN users u USING(email)
      LEFT JOIN tenants p ON p.personal_owner_id=u.id
      LEFT JOIN (
        SELECT m.email,count(*) AS count FROM memberships m JOIN tenants t ON t.id=m.tenant_id
        WHERE t.plan='business' GROUP BY m.email
      ) b ON b.email=i.email
    ), filtered AS (
      SELECT *,business_count>0 AS business FROM directory
      WHERE (strpos(lower(email),lower($1))>0 OR strpos(lower(COALESCE(name,'')),lower($1))>0)
        AND CASE $2 WHEN 'personal' THEN personal WHEN 'business' THEN business_count>0
          WHEN 'both' THEN personal AND business_count>0
          WHEN 'neither' THEN NOT personal AND business_count=0 ELSE true END
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(page_rows ORDER BY email) FROM (
        SELECT * FROM filtered ORDER BY email LIMIT 50 OFFSET $3
      ) page_rows),'[]'::jsonb) AS users
  `, [query.q, query.type, (query.page-1)*50]);
  return {...result.rows[0], page:query.page, page_size:50};
}

export function installUsers(app, {pool, config}) {
  app.get('/api/users', async (req,res) => {
    res.json(await listUsers(pool,config,req.user,req.query));
  });
}
