import {z} from 'zod';
import {access,audit,fail,operator,transaction,uid} from './store.js';

const seated="(m.status='active' OR (m.status='invited' AND m.expires_at>clock_timestamp()))";
const numbers=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['delta_cents','balance_before','balance_after','balance_cents'].includes(key)?Number(value):value]));
export async function billingPeriod(c){return (await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-01') AS period")).rows[0].period;}
export async function billingSettings(c){return {...(await c.query('SELECT unit_price_cents,currency FROM billing_settings WHERE singleton')).rows[0],collection_enabled:true};}

export async function reconcileTenantBilling(c,tenantId,period){
  // All enrollment, renewal and credit operations serialize on the tenant row.
  const tenant=(await c.query('SELECT status,access_until FROM tenants WHERE id=$1 FOR UPDATE',[tenantId])).rows[0];
  if(!tenant)fail(404,'tenant_missing','Организация не найдена.');
  period??=await billingPeriod(c);
  await c.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenantId]);
  const wallet=(await c.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1',[tenantId])).rows[0];
  const settings=await billingSettings(c);
  const unpaid=(await c.query(`SELECT m.email FROM memberships m LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$2
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seated} AND s.email IS NULL ORDER BY m.email`,[tenantId,period])).rows;
  const due=unpaid.length*settings.unit_price_cents;
  let balance=Number(wallet.balance_cents);
  if(tenant.status!=='active'||tenant.access_until&&new Date(tenant.access_until)<=new Date())return {pending_seats:unpaid.length,required_cents:due,missing_cents:Math.max(0,due-balance)};
  if(balance<due)return {pending_seats:unpaid.length,required_cents:due,missing_cents:due-balance};
  if(unpaid.length){
    await c.query(`WITH seats AS(SELECT email,row_number() OVER(ORDER BY email) AS n FROM unnest($2::text[]) AS email),
      ledger AS(INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,source)
        SELECT gen_random_uuid(),$1,-$4::bigint,$5::bigint-(n-1)*$4::bigint,$5::bigint-n*$4::bigint,'seat_charge',
          'Место '||email||' за '||left($3,7),'seat:'||$3||':'||email,
          jsonb_build_object('email',email,'period',$3::text,'unit_price_cents',$4::int),'system' FROM seats RETURNING id,request)
      INSERT INTO seat_charges(tenant_id,email,period,unit_price_cents,ledger_id)
        SELECT $1,request->>'email',$3::date,$4,id FROM ledger`,[tenantId,unpaid.map(m=>m.email),period,settings.unit_price_cents,balance]);
    await c.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1',[tenantId,balance-due]);
  }
  return {pending_seats:0,required_cents:0,missing_cents:0};
}

export async function productAccess(c,tenantId,email,period){
  period??=await billingPeriod(c);
  const m=(await c.query(`SELECT m.*,t.status AS tenant_status,t.access_until,s.email IS NOT NULL AS paid FROM memberships m
    JOIN tenants t ON t.id=m.tenant_id LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$3
    WHERE m.tenant_id=$1 AND m.email=$2`,[tenantId,email,period])).rows[0];
  return describeAccess(m,m?.tenant_status,m?.access_until,m?.paid,period);
}
function describeAccess(m,tenantStatus,accessUntil,paid,period){
  let status='disabled',message='Доступ к программе отключён. Обратитесь к владельцу организации.';
  if(m&&!m.product_enabled&&m.role==='owner'){status='management_only';message='Вы управляете организацией бесплатно. Чтобы пользоваться ARType, добавьте себя как пользователя в кабинете.';}
  else if(m&&m.product_enabled&&m.status!=='disabled'&&(m.status!=='invited'||new Date(m.expires_at)>new Date())){
    if(tenantStatus!=='active'||accessUntil&&new Date(accessUntil)<=new Date()){status='suspended';message='Доступ организации приостановлен. Обратитесь к администратору платформы.';}
    else if(!paid){status='awaiting_payment';message='ARType не работает: не пополнен баланс аккаунта организации. Обратитесь к владельцу организации для оплаты инвойса.';}
    else{status='active';message='Доступ к программе оплачен.';}
  }
  const end=new Date(period+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);
  return {app_status:status,can_translate:status==='active',access_message:message,paid_until:paid?end.toISOString():null};
}
export async function memberProductStatuses(c,t,members){
  const period=await billingPeriod(c),paid=new Set((await c.query('SELECT email FROM seat_charges WHERE tenant_id=$1 AND period=$2',[t.id,period])).rows.map(r=>r.email));
  return members.map(m=>({...m,...describeAccess(m,t.status,t.access_until,paid.has(m.email),period)}));
}

export async function walletDetails(c,tenantId){
  const settings=await billingSettings(c),period=await billingPeriod(c);
  const balance_cents=Number((await c.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1',[tenantId])).rows[0]?.balance_cents||0);
  const pending=(await c.query(`SELECT count(*)::int AS n FROM memberships m LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$2
    WHERE m.tenant_id=$1 AND m.product_enabled AND ${seated} AND s.email IS NULL`,[tenantId,period])).rows[0].n;
  const entries=(await c.query(`SELECT l.id,l.kind,l.delta_cents,l.balance_before,l.balance_after,l.reason,l.created_at,u.email AS actor_email
    FROM balance_ledger l LEFT JOIN users u ON u.id=l.actor_id WHERE l.tenant_id=$1 ORDER BY sequence DESC LIMIT 50`,[tenantId])).rows.map(numbers);
  return {balance_cents,...settings,period,pending_seats:pending,required_cents:pending*settings.unit_price_cents,missing_cents:Math.max(0,pending*settings.unit_price_cents-balance_cents),entries};
}

export function installBilling(app,{pool,config,validate,uuid}){
  const requireAdmin=req=>{if(!operator(req.user,config))fail(403,'operator_required','Требуются права администратора платформы.');};
  app.get('/api/billing-settings',async(req,res)=>{requireAdmin(req);res.json(await billingSettings(pool));});
  app.put('/api/billing-settings',async(req,res)=>{
    requireAdmin(req);const b=validate(z.object({unit_price_cents:z.number().int().min(0).max(100000000)}).strict(),req.body);
    await transaction(pool,async c=>{
      const previous=(await c.query('SELECT unit_price_cents FROM billing_settings WHERE singleton FOR UPDATE')).rows[0].unit_price_cents;
      await c.query('UPDATE billing_settings SET unit_price_cents=$1 WHERE singleton',[b.unit_price_cents]);
      await audit(c,req.user,'billing.price.update',null,{previous_cents:previous,unit_price_cents:b.unit_price_cents});
    });res.json({ok:true});
  });
  app.get('/api/tenants/:id/balance',async(req,res)=>{
    const id=validate(uuid,req.params.id),t=await access(pool,id,req.user,config,{manage:true});
    if(!['owner','operator'].includes(t.role))fail(403,'owner_required','Баланс доступен владельцу организации.');
    const result=await transaction(pool,async c=>{await reconcileTenantBilling(c,id);return walletDetails(c,id)});res.json(result);
  });
  app.post('/api/tenants/:id/balance',async(req,res)=>{
    requireAdmin(req);const id=validate(uuid,req.params.id);
    const b=validate(z.object({operation:z.enum(['credit','set']),amount_cents:z.number().int().min(0).max(9000000000000),reason:z.string().trim().min(3).max(500),idempotency_key:uuid}).strict().refine(b=>b.operation!=='credit'||b.amount_cents>0),req.body);
    const entry=await transaction(pool,async c=>{
      await access(c,id,req.user,config,{lock:true});
      const {idempotency_key,...request}=b;
      const previous=(await c.query('SELECT * FROM balance_ledger WHERE tenant_id=$1 AND idempotency_key=$2',[id,idempotency_key])).rows[0];
      if(previous){if(!Object.entries(request).every(([k,v])=>previous.request[k]===v))fail(409,'idempotency_conflict','Этот идентификатор уже использован для другой операции.');return numbers(previous);}
      await c.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
      const before=Number((await c.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1',[id])).rows[0].balance_cents);
      const after=b.operation==='credit'?before+b.amount_cents:b.amount_cents;
      if(after>9000000000000)fail(422,'balance_too_large','Слишком большой баланс.');
      const result=(await c.query(`INSERT INTO balance_ledger(id,tenant_id,delta_cents,balance_before,balance_after,kind,reason,idempotency_key,request,actor_id,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING *`,[uid(),id,after-before,before,after,b.operation==='credit'?'credit':'adjustment',b.reason,idempotency_key,request,req.user.id])).rows[0];
      await c.query('UPDATE tenant_wallets SET balance_cents=$2 WHERE tenant_id=$1',[id,after]);
      await audit(c,req.user,'billing.balance.'+b.operation,id,{entry_id:result.id,delta_cents:after-before});
      await reconcileTenantBilling(c,id);return numbers(result);
    });res.json({entry});
  });
  app.get('/api/dashboard',async(req,res)=>{
    requireAdmin(req);const period=await billingPeriod(pool),settings=await billingSettings(pool);
    const rows=(await pool.query(`SELECT t.id,t.name,t.status,COALESCE(w.balance_cents,0) AS balance_cents,
      (SELECT count(*)::int FROM memberships m WHERE m.tenant_id=t.id AND m.product_enabled AND ${seated}) AS connected_seats,
      (SELECT count(*)::int FROM seat_charges s WHERE s.tenant_id=t.id AND s.period=$1) AS billed_seats,
      (SELECT COALESCE(sum(unit_price_cents),0) FROM seat_charges s WHERE s.tenant_id=t.id AND s.period=$1) AS invoice_amount_cents,
      (SELECT count(*)::int FROM usage u WHERE u.tenant_id=t.id AND u.created_at>=($1::date::timestamp AT TIME ZONE 'UTC') AND u.created_at<(($1::date+interval '1 month') AT TIME ZONE 'UTC') AND u.status='success') AS requests,
      (SELECT count(DISTINCT user_id)::int FROM usage u WHERE u.tenant_id=t.id AND u.created_at>=($1::date::timestamp AT TIME ZONE 'UTC') AND u.created_at<(($1::date+interval '1 month') AT TIME ZONE 'UTC') AND u.status='success') AS active_users,
      (SELECT max(created_at) FROM usage u WHERE u.tenant_id=t.id) AS last_activity
      FROM tenants t LEFT JOIN tenant_wallets w ON w.tenant_id=t.id ORDER BY t.created_at`,[period])).rows.map(r=>({...r,balance_cents:Number(r.balance_cents),invoice_amount_cents:Number(r.invoice_amount_cents)}));
    res.json({...settings,period,tenants:rows,billed_seats:rows.reduce((n,t)=>n+t.billed_seats,0),invoice_amount_cents:rows.reduce((n,t)=>n+t.invoice_amount_cents,0),connected_seats:rows.reduce((n,t)=>n+t.connected_seats,0)});
  });
}

export async function renewDueTenants(pool){
  const period=await billingPeriod(pool);
  let after='00000000-0000-0000-0000-000000000000';
  while(true){
    const rows=(await pool.query(`SELECT DISTINCT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      LEFT JOIN seat_charges s ON s.tenant_id=m.tenant_id AND s.email=m.email AND s.period=$1
      WHERE m.tenant_id>$2 AND t.status='active' AND (t.access_until IS NULL OR t.access_until>clock_timestamp())
        AND m.product_enabled AND ${seated} AND s.email IS NULL ORDER BY m.tenant_id LIMIT 100`,[period,after])).rows;
    if(!rows.length)return;
    for(const row of rows)await transaction(pool,c=>reconcileTenantBilling(c,row.tenant_id));
    after=rows.at(-1).tenant_id;
  }
}
