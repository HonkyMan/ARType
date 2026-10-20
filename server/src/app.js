import express from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { access, activateMemberships, audit, credentialList, fail, HttpError, operator, reserve, transaction, uid } from './store.js';
import { hash, installAuth } from './auth.js';
import { providerPayload } from './provider.js';
import {encryptCredential} from './credentials.js';
import {installAdministration} from './administration.js';
import {installDownloads} from './downloads.js';
import {installBilling,productAccess,reconcileTenantBilling,walletDetails,memberProductStatuses} from './billing.js';

const languages=['en','ru','zh','hi','es','fr','ar','bn','pt','id'];
const uuid=z.string().uuid();
const email=z.email().max(254).transform(x=>x.trim().toLowerCase());
const settings=z.object({name:z.string().trim().min(1).max(120),status:z.enum(['active','suspended']),seats:z.number().int().min(1).max(100000),
  monthly_characters:z.number().int().min(1).max(1e12),max_text:z.number().int().min(1).max(20000),rpm:z.number().int().min(1).max(10000),
  concurrency:z.number().int().min(1).max(500),model:z.string().trim().min(1).max(200),credential:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  instructions:z.string().max(8000),languages:z.array(z.enum(languages)).min(1).max(10).refine(a=>new Set(a).size===a.length),access_until:z.iso.datetime({offset:true}).nullable()});
const validate=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail(422,'invalid_input','Проверьте введённые значения.');return r.data;};
const isSeated="(status='active' OR (status='invited' AND expires_at>clock_timestamp()))";
const csvCell=v=>`"${String(v??'').replace(/^[=+@\-\t\r]/,'\'$&').replaceAll('"','""')}"`;

export function createApp({pool,config,google,translate}) {
  const app=express();app.disable('x-powered-by');
  if(config.trustProxy)app.set('trust proxy',1);
  const throttle=new Map();
  app.use(express.json({limit:'100kb'}));
  app.use(async(req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Cache-Control':'no-store'});
    if(config.secure)res.set('Strict-Transport-Security','max-age=31536000');
    if(req.path.startsWith('/api/device') || req.path==='/auth/google') {
      let key=req.ip,limit=200;
      // An office can have many legitimate devices behind one public IP.
      // Only a valid pairing secret earns a separate polling allowance.
      if(req.path==='/api/device/poll' && uuid.safeParse(req.body?.id).success && typeof req.body?.poll_token==='string' && req.body.poll_token.length<=200) {
        const d=await pool.query('SELECT id FROM devices WHERE id=$1 AND poll_hash=$2 AND expires_at>now()',[req.body.id,hash(req.body.poll_token)]);
        if(d.rowCount){key='device:'+d.rows[0].id;limit=30;}
      }
      const now=Date.now(),entry=throttle.get(key);
      if(!entry || entry.until<now){if(throttle.size>10000)for(const [k,v] of throttle)if(v.until<now)throttle.delete(k);throttle.set(key,{n:1,until:now+60000})}
      else if(++entry.n>limit)return res.status(429).json({error:{code:'rate_limit',message:'Подождите минуту и повторите вход.'}});
    }next();
  });
  app.get('/health',async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',service:'ARType'})});
  const auth=installAuth(app,{pool,config,google,validate,z});
  app.use('/api',auth);
  installAdministration(app,{pool,config,validate,email});
  installDownloads(app,{config,auth});
  installBilling(app,{pool,config,validate,uuid});
  app.get('/api/me',async(req,res)=>{
    await transaction(pool,c=>activateMemberships(c,req.user.email));
    const ts=operator(req.user,config)
      ? await pool.query("SELECT t.*,'operator' AS role FROM tenants t ORDER BY created_at")
      : await pool.query("SELECT t.*,m.role FROM tenants t JOIN memberships m ON t.id=m.tenant_id WHERE m.email=$1 AND m.status='active' ORDER BY t.created_at",[req.user.email]);
    const tenants=[];
    for(const t of ts.rows){
      const entitlement=await transaction(pool,async c=>{await reconcileTenantBilling(c,t.id);return productAccess(c,t.id,req.user.email)});
      tenants.push({id:t.id,name:t.name,role:t.role,status:t.status,languages:t.languages,revision:t.revision,access_until:t.access_until,...entitlement});
    }
    res.json({user:req.user,csrf:req.session.csrf,operator:operator(req.user,config),tenants});
  });
  app.get('/api/tenants',async(req,res)=>{
    if(!operator(req.user,config))fail(403,'operator_required','Требуются права оператора.');
    const r=await pool.query(`SELECT t.*,(SELECT count(*)::int FROM memberships WHERE tenant_id=t.id AND product_enabled AND ${isSeated}) AS used_seats,
      COALESCE((SELECT sum(characters) FROM usage WHERE tenant_id=t.id AND status='success' AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS used_characters FROM tenants t ORDER BY created_at`);
    const connections=await credentialList(pool,config);
    res.json({tenants:r.rows,credentials:connections.map(c=>c.alias),connections,default_model:config.defaultModel||''});
  });
  app.get('/api/provider-credentials',async(req,res)=>{
    if(!operator(req.user,config))fail(403,'operator_required','Требуются права оператора.');
    res.json({credentials:await credentialList(pool,config),can_manage:!!config.credentialEncryptionKey,provider_base_url:config.providerBaseURL,default_model:config.defaultModel||''});
  });
  app.put('/api/provider-credentials/:alias',async(req,res)=>{
    if(!operator(req.user,config))fail(403,'operator_required','Требуются права оператора.');
    const alias=validate(settings.shape.credential,req.params.alias);
    const b=validate(z.object({key:z.string().trim().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
      base_url:z.url().max(2048).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}).transform(v=>v.replace(/\/+$/,'')).optional(),
      default_model:z.string().trim().min(1).max(200).optional()}).strict().refine(v=>Object.keys(v).length>0),req.body);
    if(!config.credentialEncryptionKey)fail(503,'encryption_not_configured','Нужно задать CREDENTIAL_ENCRYPTION_KEY в конфигурации сервера и пересоздать API.');
    await transaction(pool,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['provider:'+alias]);
      const existing=(await c.query('SELECT * FROM provider_credentials WHERE alias=$1',[alias])).rows[0];
      const previousURL=existing?.base_url||config.providerBaseURL;
      if(!b.key && (!existing&&!config.providerKeys[alias] || b.base_url&&b.base_url!==previousURL))fail(422,'provider_key_required','Для нового подключения или смены адреса введите API-ключ заново.');
      const ciphertext=b.key?encryptCredential(b.key,config.credentialEncryptionKey,alias):existing?.ciphertext||encryptCredential(config.providerKeys[alias],config.credentialEncryptionKey,alias);
      await c.query(`INSERT INTO provider_credentials(alias,ciphertext,updated_by,base_url,default_model) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(alias) DO UPDATE SET ciphertext=$2,updated_by=$3,base_url=$4,default_model=$5,updated_at=now()`,
        [alias,ciphertext,req.user.id,b.base_url||previousURL,b.default_model??existing?.default_model??config.defaultModel??'']);
      await audit(c,req.user,'provider.credential.update',null);
    });res.json({ok:true});
  });
  app.post('/api/tenants',async(req,res)=>{
    if(!operator(req.user,config))fail(403,'operator_required','Требуются права оператора.');
    const b=validate(settings.partial().extend({name:settings.shape.name,model:settings.shape.model,credential:settings.shape.credential,owner_email:email}).strict(),req.body);
    const id=uid();
    await transaction(pool,async c=>{
      const {owner_email,...fields}=b;fields.id=id;
      const keys=Object.keys(fields),vals=Object.entries(fields).map(([k,v])=>k==='languages'?JSON.stringify(v):v);
      await c.query(`INSERT INTO tenants(${keys.join(',')}) VALUES(${vals.map((_,i)=>'$'+(i+1)).join(',')})`,vals);
      await c.query("INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled) VALUES($1,$2,$3,'owner','invited',false)",[uid(),id,owner_email]);
      await audit(c,req.user,'tenant.create',id);
    });res.status(201).json({id});
  });
  app.get('/api/tenants/:id',async(req,res)=>{
    const id=validate(uuid,req.params.id),t=await access(pool,id,req.user,config,{manage:true});
    const billing=await transaction(pool,async c=>{await reconcileTenantBilling(c,id);return ['owner','operator'].includes(t.role)?walletDetails(c,id):null});
    const members=await memberProductStatuses(pool,t,(await pool.query('SELECT * FROM memberships WHERE tenant_id=$1 ORDER BY role,email',[id])).rows);
    const usage=(await pool.query(`SELECT count(*) FILTER(WHERE status='success')::int AS requests,
      COALESCE(sum(characters) FILTER(WHERE status='success'),0)::bigint AS characters,
      COALESCE(sum(input_tokens),0)::bigint AS input_tokens,COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
      count(*) FILTER(WHERE status='failed')::int AS failures FROM usage WHERE tenant_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[id])).rows[0];
    const recent=(await pool.query('SELECT u.created_at,u.characters,u.status,u.duration_ms,p.email FROM usage u JOIN users p ON p.id=u.user_id WHERE tenant_id=$1 ORDER BY u.created_at DESC LIMIT 30',[id])).rows;
    res.json({tenant:t,members,usage,recent,billing});
  });
  app.patch('/api/tenants/:id',async(req,res)=>{
    const id=validate(uuid,req.params.id),b=validate(settings.partial().strict(),req.body);
    if(!Object.keys(b).length)fail(422,'empty_update','Нет изменений.');
    await transaction(pool,async c=>{
      await access(c,id,req.user,config,{manage:true,lock:true});
      if(!operator(req.user,config) && Object.keys(b).some(k=>!['name','instructions','languages'].includes(k)))fail(403,'operator_required','Лимиты и подключение меняет оператор сервиса.');
      if(b.seats && (await c.query(`SELECT count(*)::int n FROM memberships WHERE tenant_id=$1 AND product_enabled AND ${isSeated}`,[id])).rows[0].n>b.seats)fail(409,'seats_in_use','Сначала отключите лишних участников.');
      const entries=Object.entries(b);
      await c.query(`UPDATE tenants SET ${entries.map(([k],i)=>`${k}=$${i+2}`).join(',')},revision=revision+1 WHERE id=$1`,[id,...entries.map(([k,v])=>k==='languages'?JSON.stringify(v):v)]);
      await audit(c,req.user,'tenant.update',id);
    });res.json({ok:true});
  });
  app.post('/api/tenants/:id/members',async(req,res)=>{
    const id=validate(uuid,req.params.id),b=validate(z.object({email,role:z.enum(['owner','admin','member'])}).strict(),req.body);
    await transaction(pool,async c=>{
      const t=await access(c,id,req.user,config,{manage:true,lock:true});
      if(t.role==='admin' && b.role!=='member')fail(403,'owner_required','Назначать администраторов может владелец.');
      const existing=(await c.query('SELECT * FROM memberships WHERE tenant_id=$1 AND email=$2',[id,b.email])).rows[0];
      if(t.role==='admin'&&existing&&existing.role!=='member')fail(403,'owner_required','Администратор организации может управлять только участниками.');
      if(existing && (existing.role!=='owner'||existing.product_enabled))fail(409,'already_member','Email уже добавлен. Измените существующего участника.');
      const productEnabled=existing?true:b.role!=='owner';
      const n=(await c.query(`SELECT count(*)::int n FROM memberships WHERE tenant_id=$1 AND product_enabled AND ${isSeated}`,[id])).rows[0].n;
      if(productEnabled&&n>=t.seats)fail(409,'seats_full','Все места заняты.');
      if(existing)await c.query('UPDATE memberships SET product_enabled=true WHERE id=$1',[existing.id]);
      else await c.query("INSERT INTO memberships(id,tenant_id,email,role,status,product_enabled) VALUES($1,$2,$3,$4,'invited',$5)",[uid(),id,b.email,b.role,productEnabled]);
      await reconcileTenantBilling(c,id);
      await audit(c,req.user,'member.invite',id);
    });res.status(201).json({ok:true,login_url:config.origin,expires_in_days:7});
  });
  app.patch('/api/tenants/:id/members/:member',async(req,res)=>{
    const id=validate(uuid,req.params.id),member=validate(uuid,req.params.member);
    const b=validate(z.object({role:z.enum(['owner','admin','member']).optional(),status:z.enum(['active','disabled','invited']).optional(),product_enabled:z.boolean().optional()}).strict(),req.body);
    if(!Object.keys(b).length)fail(422,'empty_update','Нет изменений.');
    await transaction(pool,async c=>{
      const t=await access(c,id,req.user,config,{manage:true,lock:true});
      const m=(await c.query('SELECT * FROM memberships WHERE id=$1 AND tenant_id=$2',[member,id])).rows[0];
      if(!m)fail(404,'member_missing','Участник не найден.');
      if(t.role==='admin' && (m.role!=='member' || (b.role && b.role!=='member')))fail(403,'owner_required','Требуются права владельца.');
      const next={...m,...b};
      if(m.role==='owner' && m.status!=='disabled' && (next.role!=='owner' || next.status==='disabled') &&
        !(await c.query("SELECT id FROM memberships WHERE tenant_id=$1 AND id!=$2 AND role='owner' AND status='active'",[id,member])).rowCount)fail(409,'last_owner','Сначала назначьте другого владельца и дождитесь его входа.');
      const wasSeated=m.product_enabled&&(m.status==='active' || (m.status==='invited' && new Date(m.expires_at)>new Date()));
      if(!wasSeated && next.product_enabled && next.status!=='disabled' && (await c.query(`SELECT count(*)::int n FROM memberships WHERE tenant_id=$1 AND product_enabled AND ${isSeated}`,[id])).rows[0].n>=t.seats)fail(409,'seats_full','Все места заняты.');
      await c.query("UPDATE memberships SET role=$1,status=$2,product_enabled=$3,expires_at=now()+interval '7 days' WHERE id=$4",[next.role,next.status,next.product_enabled,member]);
      await reconcileTenantBilling(c,id);
      await audit(c,req.user,'member.update',id);
    });res.json({ok:true});
  });
  app.get('/api/tenants/:id/usage.csv',async(req,res)=>{
    const id=validate(uuid,req.params.id);await access(pool,id,req.user,config,{manage:true});
    const rows=(await pool.query(`SELECT date_trunc('day',u.created_at AT TIME ZONE 'UTC')::date AS day,p.email,count(*)::int AS requests,
      sum(characters) AS characters,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens
      FROM usage u JOIN users p ON p.id=u.user_id WHERE tenant_id=$1 AND status='success'
      AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' GROUP BY day,p.email ORDER BY day,p.email`,[id])).rows;
    res.set('Content-Disposition',`attachment; filename="artype-usage-${id}.csv"`).type('text/csv').send('\uFEFF'+['day,email,requests,characters,input_tokens,output_tokens',...rows.map(r=>Object.values(r).map(csvCell).join(','))].join('\r\n'));
  });
  app.post('/api/translate',async(req,res)=>{
    const b=validate(z.object({tenant_id:uuid,request_id:uuid,text:z.string().min(1).max(40000).refine(t=>t.trim().length>0),
      source:z.enum(languages).nullable().optional(),target:z.enum(languages),style:z.enum(['faithful','formal','casual','polished']).default('faithful')}).strict(),req.body);
    const reserved=await reserve(pool,req.user,b,config);const start=Date.now();
    let result;
    try {
      result=await translate(providerPayload(b,reserved.tenant),reserved.tenant.credential,reserved.providerKey,reserved.providerBaseURL);
      if(typeof result.text!=='string' || !result.text.trim())throw new Error('Empty response');
      await pool.query("UPDATE usage SET status='success',input_tokens=$1,output_tokens=$2,duration_ms=$3 WHERE id=$4",[result.input_tokens||0,result.output_tokens||0,Date.now()-start,reserved.id]);
    }catch{
      await pool.query("UPDATE usage SET status='failed',duration_ms=$1 WHERE id=$2",[Date.now()-start,reserved.id]);
      fail(502,'provider_unavailable','Не удалось выполнить перевод. Исходный текст сохранён. Повторите позже.');
    }
    res.type('text/event-stream');
    res.send(`data: ${JSON.stringify({choices:[{delta:{content:result.text}}]})}\n\ndata: [DONE]\n\n`);
  });
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{etag:false,maxAge:0}));
  app.use((req,res)=>res.status(404).json({error:{code:'not_found',message:'Страница не найдена.'}}));
  app.use((e,req,res,next)=>{
    if(res.headersSent)return next(e);
    const status=e instanceof HttpError?e.status:e.type==='entity.too.large'?413:e instanceof SyntaxError?400:500;
    if(status===500)console.error(JSON.stringify({event:'request_error',code:e.code||'internal',path:req.route?.path||'unknown'}));
    res.status(status).json({error:{code:e instanceof HttpError?e.code:'request_failed',message:e instanceof HttpError?e.message:status===500?'Ошибка сервера. Повторите позже.':'Некорректный запрос.'}});
  });return app;
}
