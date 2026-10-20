import {access} from './access.js';
import {transaction, uid} from './database.js';
import {quoteAccessForMembers, fingerprint} from './member-access.js';
import {reconcileTenantBilling} from './billing.js';
import {fail} from './errors.js';

const requestData = body => ({
  emails: [...new Set(body.emails.map(email => email.trim().toLowerCase()))].sort(),
  role: body.role, enabled: body.enabled,
});

async function quote(db, tenant, request) {
  if (tenant.plan !== 'business') fail(403, 'business_required');
  if (tenant.role === 'admin' && request.role !== 'member') fail(403, 'owner_required');
  const existing = new Set((await db.query(
    'SELECT email FROM memberships WHERE tenant_id=$1 AND email=ANY($2::text[])',
    [tenant.id, request.emails],
  )).rows.map(row => row.email));
  const emails = request.emails.filter(email => !existing.has(email));
  const members = emails.map(email => ({
    id: email, email, role: request.role, status: 'active', product_enabled: false, persisted: false,
  }));
  const result = await quoteAccessForMembers(db, tenant, members, request.enabled && emails.length > 0);
  result.enabled = request.enabled;
  result.invitation = true;
  result.skipped_emails = [...existing].sort();
  if (!emails.length) { result.allowed = false; result.blocked = 'no_new_members'; }
  result.quote_token = fingerprint({request, quote:result});
  return result;
}

export async function quoteInvitations(pool, config, user, tenantId, body) {
  return transaction(pool, async db => quote(db,
    await access(db, tenantId, user, config, {manage:true, lock:true}), requestData(body)));
}

export async function inviteMembers(pool, config, user, tenantId, body) {
  return transaction(pool, async db => {
    const tenant = await access(db, tenantId, user, config, {manage:true, lock:true});
    const request = requestData(body);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['member-invitations:' + body.idempotency_key]);
    const prior = (await db.query('SELECT * FROM audit WHERE id=$1', [body.idempotency_key])).rows[0];
    if (prior) {
      if (prior.action !== 'members.invite' || prior.tenant_id !== tenantId || prior.actor_id !== user.id ||
          fingerprint(requestData(prior.details.request)) !== fingerprint(request)) fail(409, 'idempotency_conflict');
      return prior.details.result;
    }
    const current = await quote(db, tenant, request);
    if (current.quote_token !== body.quote_token) fail(409, 'access_quote_changed');
    if (!current.allowed) fail(current.blocked === 'insufficient_balance' ? 402 : 409, current.blocked);
    const emails = current.members.map(member => member.email);
    await db.query(`INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled)
      SELECT unnest($1::uuid[]),$2,unnest($3::text[]),$4,'invited',$5`,
    [emails.map(() => uid()), tenantId, emails, request.role, request.enabled]);
    if (request.enabled) {
      const paid = await reconcileTenantBilling(db, tenantId, current.period, emails);
      if (paid.required_cents) fail(409, 'access_quote_changed');
    }
    const result = {invited_count:emails.length, skipped_emails:current.skipped_emails,
      charged_cents:current.total_cents, enabled:request.enabled};
    await db.query("INSERT INTO audit(id,actor_id,action,tenant_id,details) VALUES($1,$2,'members.invite',$3,$4)",
      [body.idempotency_key, user.id, tenantId, {request,result}]);
    return result;
  });
}
