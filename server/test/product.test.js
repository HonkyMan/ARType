import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createApp } from '../src/app.js';
import { initializeSchema } from '../src/schema.js';
import { transaction } from '../src/database.js';
import {billingPeriod,reconcileTenantBilling,productAccess} from '../src/billing.js';
import {setRenewal} from '../src/workspaces.js';

const pool = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL});
const origin = 'http://127.0.0.1:43189';
const config = {origin, adminEmails:['operator@example.com'], googleClientId:'test-client', googleClientSecret:'test-secret',
  providerKeys:{main:'server-only-key'}, providerBaseURL:'https://example.com/v1', credentialEncryptionKey:'ab'.repeat(32),secure:false};
let server, url, upstreamCalls, upstreamCredentials, upstreamUrls, upstreamFail, googleClaims;
const claimsByCode=new Map();
const hash = s => createHash('sha256').update(s).digest('hex');
async function actor(email) {
  const id=randomUUID(), token=randomUUID(), csrf=randomUUID();
  await pool.query('INSERT INTO users(id,sub,email,name) VALUES($1,$2,$3,$3)',[id,id,email]);
  await pool.query("INSERT INTO sessions(token_hash,user_id,csrf,kind,expires_at) VALUES($1,$2,$3,'web',now()+interval '1 day')",[hash(token),id,csrf]);
  return {id,token,csrf,email};
}
async function call(path, {actor:a, method='GET', body, headers={}}={}) {
  const r=await fetch(url+path,{method, headers:{...(a?{Cookie:`artype_session=${a.token}`,'X-CSRF-Token':a.csrf,Origin:origin}:{}),
    ...(body?{'Content-Type':'application/json'}:{}), ...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  let data; const text=await r.text(); try{data=JSON.parse(text)}catch{data=text} return {status:r.status,data,headers:r.headers};
}
async function memberAccess(user, tenantId, emails, enabled=true) {
  const ids=(await pool.query('SELECT id FROM memberships WHERE tenant_id=$1 AND email=ANY($2::text[]) ORDER BY id',[tenantId,emails])).rows.map(r=>r.id);
  const selection={member_ids:ids,enabled};
  const quote=await call(`/api/tenants/${tenantId}/member-access/quote`,{actor:user,method:'POST',body:selection});
  if(quote.status!==200)return quote;
  return call(`/api/tenants/${tenantId}/member-access`,{actor:user,method:'POST',body:{...selection,quote_token:quote.data.quote_token,idempotency_key:randomUUID()}});
}
async function tenant(op, owner, overrides={}, {paidOwner=true}={}) {
  const r=await call('/api/tenants',{actor:op,method:'POST',body:{name:'Acme',owner_email:owner,model:'test-model',credential:'main',...overrides}});
  assert.equal(r.status,201,JSON.stringify(r.data));
  if(paidOwner){
    assert.equal((await call(`/api/tenants/${r.data.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:100000,reason:'Test prepaid seats',idempotency_key:randomUUID()}})).status,200);
    assert.equal((await memberAccess(op,r.data.id,[owner])).status,200);
  }return r.data;
}
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to an isolated PostgreSQL database');
  assert.match(new URL(process.env.TEST_DATABASE_URL).pathname, /_test$/, 'Test database must end in _test');
  await initializeSchema(pool);
  config.downloadDirectory=await mkdtemp(join(tmpdir(),'artype-download-test-'));
  server=createApp({pool,config,google:{authorizationURL:({state})=>`https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange:async(code)=>claimsByCode.get(code)||googleClaims}, translate:async(payload,alias,key,baseURL)=>{
      upstreamCalls.push(payload);upstreamCredentials.push(key);upstreamUrls.push(baseURL); if(upstreamFail)throw new Error('provider internal secret');
      await new Promise(r=>setTimeout(r,30)); return {text:'Hello world',input_tokens:10,output_tokens:3};
    }}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r)); url=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r)); await pool.end();if(config.downloadDirectory)await rm(config.downloadDirectory,{recursive:true,force:true})});
beforeEach(async()=>{await pool.query('TRUNCATE users,tenants,memberships,sessions,oauth_states,devices,usage,audit RESTART IDENTITY CASCADE');await pool.query('UPDATE billing_settings SET unit_price_cents=500,plus_price_cents=500,business_price_cents=1000');upstreamCalls=[];upstreamCredentials=[];upstreamUrls=[];upstreamFail=false;});

test('only platform administrators grant global access; revocation applies to existing sessions',async()=>{
  const op=await actor('operator@example.com'),employee=await actor('employee@example.com'),owner=await actor('owner@example.com');
  const path='/api/platform-admins/'+encodeURIComponent('employee@example.com');
  const t=await tenant(op,'owner@example.com');
  assert.equal((await call('/api/platform-admins',{actor:owner})).status,403);
  assert.equal((await call(path,{actor:owner,method:'PUT',body:{}})).status,403);
  assert.equal((await call(path,{actor:op,method:'PUT',body:{}})).status,200);
  assert.equal((await call('/api/me',{actor:employee})).data.operator,true);
  assert.equal((await call('/api/tenants',{actor:employee})).status,200);
  assert.equal((await call('/api/platform-admins/'+encodeURIComponent('operator@example.com'),{actor:employee,method:'DELETE'})).status,409);
  assert.equal((await call(path,{actor:employee,method:'DELETE'})).status,409);
  assert.equal((await call(path,{actor:op,method:'DELETE'})).status,200);
  assert.equal((await call('/api/tenants',{actor:employee})).status,403);
  assert.equal((await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:'localadmin@example.com',role:'admin'}})).status,201);
  const localAdmin=await actor('localadmin@example.com');
  assert.equal((await call('/api/me',{actor:localAdmin})).data.operator,false);
  assert.equal((await call(path,{actor:localAdmin,method:'PUT',body:{}})).status,403);
});

test('connection metadata routes each tenant and changing destinations requires an explicit key',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const path='/api/provider-credentials/custom';
  assert.equal((await call(path,{actor:op,method:'PUT',body:{key:'new-provider-key',base_url:'https://provider.example/v1',default_model:'model-one'}})).status,200);
  assert.equal((await call(path,{actor:op,method:'PUT',body:{default_model:'model-two'}})).status,200);
  const t=await tenant(op,'owner@example.com',{credential:'custom',model:'chosen-model'});
  const request=()=>call('/api/translate',{actor:owner,method:'POST',body:{tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'en'}});
  assert.equal((await request()).status,200);
  assert.equal(upstreamUrls.at(-1),'https://provider.example/v1');
  assert.equal(upstreamCalls.at(-1).model,'chosen-model');
  assert.equal(upstreamCredentials.at(-1),'new-provider-key');
  assert.equal((await call(path,{actor:op,method:'PUT',body:{base_url:'https://other.example/v1'}})).status,422);
  for(const base_url of ['http://unsafe.example/v1','https://user:password@provider.example/v1','https://provider.example/v1?token=secret','https://provider.example/v1#fragment','https://provider.example/v1?','https://provider.example/v1#']){
    assert.equal((await call(path,{actor:op,method:'PUT',body:{key:'key',base_url}})).status,422);
  }
  const listing=await call('/api/provider-credentials',{actor:op});
  assert.equal(listing.data.credentials.find(c=>c.alias==='custom').default_model,'model-two');
  assert.ok(!JSON.stringify(listing.data).includes('new-provider-key'));
  assert.equal((await call(`/api/tenants/${t.id}`,{actor:owner,method:'PATCH',body:{credential:'main'}})).status,403);
});

test('creating connections cannot replace stored or environment credentials, even concurrently', async () => {
  const op = await actor('operator@example.com'), owner = await actor('owner@example.com');
  const body = {key:'unique-provider-key', base_url:'https://provider.example/v1', default_model:'model-one'};
  const path = '/api/provider-credentials/unique';
  assert.equal((await call(path, {actor:owner, method:'POST', body})).status, 403);
  const responses = await Promise.all([
    call(path, {actor:op, method:'POST', body}),
    call(path, {actor:op, method:'POST', body}),
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(), [201,409]);
  const original = (await pool.query("SELECT ciphertext FROM provider_credentials WHERE alias='unique'")).rows[0].ciphertext;
  assert.equal((await call(path, {actor:op, method:'POST', body:{...body,key:'overwrite-attempt'}})).status,409);
  assert.equal((await pool.query("SELECT ciphertext FROM provider_credentials WHERE alias='unique'")).rows[0].ciphertext,original);
  assert.equal((await call('/api/provider-credentials/main', {actor:op,method:'POST',body})).status,409);
  assert.equal((await call(path, {actor:op, method:'PUT', body:{default_model:'model-two'}})).status,200);
  assert.equal((await pool.query("SELECT ciphertext FROM provider_credentials WHERE alias='unique'")).rows[0].ciphertext,original);
});

test('Bengali, Hindi and Chinese reach the managed profile and translation prompt; tenant restrictions still apply', async () => {
  const op = await actor('operator@example.com'), owner = await actor('owner@example.com');
  const t = await tenant(op,'owner@example.com');
  const profile = (await call('/api/me',{actor:owner})).data;
  assert.deepEqual(profile.tenants[0].languages, ['ru','en','bn','hi','zh']);
  for (const [target,name] of [['bn','Bengali'],['hi','Hindi'],['zh','Chinese']]) {
    const result = await call('/api/translate',{actor:owner,method:'POST',body:{
      tenant_id:t.id,request_id:randomUUID(),text:'Привет, команда!',source:'ru',target,
    }});
    assert.equal(result.status,200);
    assert.match(upstreamCalls.at(-1).messages[0].content,new RegExp(name));
  }
  assert.equal((await call(`/api/tenants/${t.id}`,{actor:owner,method:'PATCH',body:{languages:['ru','en']}})).status,200);
  const result = await call('/api/translate',{actor:owner,method:'POST',body:{
    tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'bn',
  }});
  assert.equal(result.status,422);
  assert.equal(upstreamCalls.length,3);
});

test('published installer downloads require login and expose only manifest-listed files',async()=>{
  const member=await actor('member@example.com');
  const filename='ARType-0.1.18-test.exe',bytes='test-installer-bytes';
  const entry={filename,platform:'windows-x64',version:'0.1.18',signing:'unsigned-validation',sha256:hash(bytes),size_bytes:Buffer.byteLength(bytes),service_url:origin};
  await writeFile(join(config.downloadDirectory,filename),bytes);
  await writeFile(join(config.downloadDirectory,'private.txt'),'private-data');
  await writeFile(join(config.downloadDirectory,'manifest.json'),JSON.stringify({files:[entry]}));
  assert.equal((await call('/api/downloads')).status,401);
  const listing=await call('/api/downloads',{actor:member});assert.equal(listing.status,200);
  assert.equal(listing.data.files[0].url,'/downloads/'+filename);
  assert.equal(listing.data.files[0].sha256,hash(bytes));
  assert.equal((await call('/downloads/'+filename)).status,401);
  const download=await call('/downloads/'+filename,{actor:member});assert.equal(download.status,200);assert.equal(download.data,bytes);
  assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await call('/downloads/private.txt',{actor:member})).status,404);
  assert.equal((await call('/downloads/manifest.json',{actor:member})).status,404);
  await rm(join(config.downloadDirectory,'manifest.json'));
  assert.deepEqual((await call('/api/downloads',{actor:member})).data.files,[]);
});

test('saving a legacy noncanonical provider URL preserves its key when the destination is unchanged', async () => {
  const op = await actor('operator@example.com');
  const path = '/api/provider-credentials/legacy';
  assert.equal((await call(path, { actor: op, method: 'PUT', body: {
    key: 'legacy-fixture-key', base_url: 'https://api.example.com/v1', default_model: 'old-model',
  } })).status, 200);
  await pool.query("UPDATE provider_credentials SET base_url='https://API.EXAMPLE.COM:443/v1' WHERE alias='legacy'");
  const ciphertext = (await pool.query("SELECT ciphertext FROM provider_credentials WHERE alias='legacy'")).rows[0].ciphertext;
  const saved = await call(path, { actor: op, method: 'PUT', body: {
    base_url: 'https://API.EXAMPLE.COM:443/v1', default_model: 'new-model',
  } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const row = (await pool.query("SELECT * FROM provider_credentials WHERE alias='legacy'")).rows[0];
  assert.equal(row.ciphertext, ciphertext);
  assert.equal(row.default_model, 'new-model');
  assert.equal(row.base_url, 'https://api.example.com/v1');
  assert.equal((await call(path, { actor: op, method: 'PUT', body: {
    base_url: 'https://different.example.com/v1',
  } })).status, 422);
});

test('only platform administrators set prices and post idempotent balance entries; owners see their own balance',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com'),other=await actor('other@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false}),path=`/api/tenants/${t.id}/balance`;
  assert.equal((await call('/api/billing-settings',{actor:owner,method:'PUT',body:{unit_price_cents:700,plus_price_cents:500,business_price_cents:1000}})).status,403);
  assert.equal((await call('/api/billing-settings',{actor:op,method:'PUT',body:{unit_price_cents:700,plus_price_cents:500,business_price_cents:1000}})).status,200);
  assert.equal((await call('/api/billing-settings',{actor:op})).data.unit_price_cents,700);
  const body={operation:'credit',amount_cents:10000,reason:'Invoice INV-001 paid',idempotency_key:randomUUID()};
  assert.equal((await call(path,{actor:owner,method:'POST',body})).status,403);
  const responses=await Promise.all([call(path,{actor:op,method:'POST',body}),call(path,{actor:op,method:'POST',body})]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal(responses[0].data.entry.id,responses[1].data.entry.id);
  assert.equal((await call(path,{actor:owner})).data.balance_cents,9000);
  assert.equal((await call(path,{actor:owner})).data.entries.length,2);
  assert.equal((await call(path,{actor:other})).status,403);
  assert.equal((await call(path,{actor:op,method:'POST',body:{...body,amount_cents:20000}})).status,409);
  assert.equal((await call(path,{actor:op,method:'POST',body:{operation:'set',amount_cents:5000,reason:'Correction after reconciliation',idempotency_key:randomUUID()}})).status,200);
  const wallet=(await call(path,{actor:owner})).data;assert.equal(wallet.balance_cents,5000);assert.equal(wallet.entries.length,3);
  assert.equal(wallet.entries[0].delta_cents,-4000);
  await assert.rejects(pool.query('UPDATE balance_ledger SET reason=$1 WHERE id=$2',['overwrite',wallet.entries[0].id]),/immutable/);
  for(const amount_cents of [-1,1.5,1e15])assert.equal((await call(path,{actor:op,method:'POST',body:{...body,idempotency_key:randomUUID(),amount_cents}})).status,422);
  assert.equal((await call('/api/dashboard',{actor:owner})).status,403);
  const dashboard=await call('/api/dashboard',{actor:op});assert.equal(dashboard.status,200);
  assert.equal(dashboard.data.tenants[0].balance_cents,5000);
  assert.equal(dashboard.data.tenants[0].invoice_amount_cents,1000,'Business base is billed without a product seat');
  await call('/api/billing-settings',{actor:op,method:'PUT',body:{unit_price_cents:500,plus_price_cents:500,business_price_cents:1000}});
});

test('owners manage for free; self-enrollment is paid, per tenant and once per calendar month',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  const request=()=>call('/api/translate',{actor:owner,method:'POST',body:{tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'en'}});
  assert.equal((await request()).status,403);
  const add=()=>memberAccess(owner,t.id,['owner@example.com']);
  assert.equal((await add()).status,402);
  assert.equal((await request()).status,403);
  const credit=await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:2000,reason:'Paid invoice',idempotency_key:randomUUID()}});
  assert.equal(credit.status,200);
  assert.equal((await add()).status,200);
  assert.equal((await call(`/api/tenants/${t.id}/balance`,{actor:owner})).data.balance_cents,500);
  assert.equal((await request()).status,200);
  const own=(await call(`/api/tenants/${t.id}`,{actor:owner})).data.members[0];assert.equal(own.role,'owner');assert.equal(own.app_status,'active');
  assert.equal((await memberAccess(owner,t.id,[own.email],false)).status,200);
  assert.equal((await request()).status,403);
  assert.equal((await add()).status,200);
  assert.equal((await request()).status,200);
  assert.equal((await call(`/api/tenants/${t.id}/balance`,{actor:owner})).data.balance_cents,500);
  const second=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  assert.equal((await memberAccess(owner,second.id,['owner@example.com'])).status,402);
  assert.equal((await call(`/api/tenants/${second.id}`,{actor:owner})).data.members[0].app_status,'management_only');
  const dashboard=(await call('/api/dashboard',{actor:op})).data;
  assert.equal(dashboard.invoice_amount_cents,1500);assert.equal(dashboard.billed_seats,1);
});

test('tenant administrator cannot enroll an existing free owner through the invitation endpoint',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com'),admin=await actor('admin@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:2000,reason:'Paid invoice',idempotency_key:randomUUID()}});
  await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:'admin@example.com',role:'admin'}});
  const before=(await call(`/api/tenants/${t.id}/balance`,{actor:owner})).data.balance_cents;
  assert.equal((await call(`/api/tenants/${t.id}/members`,{actor:admin,method:'POST',body:{email:'owner@example.com',role:'member'}})).status,403);
  assert.equal((await call(`/api/tenants/${t.id}/balance`,{actor:owner})).data.balance_cents,before);
});

test('monthly renewal is atomic, keeps historical prices and never renews disabled employees',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  const credit=amount_cents=>call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents,reason:'Invoice paid',idempotency_key:randomUUID()}});
  await credit(2200);
  for(const email of ['a@example.com','b@example.com'])await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email,role:'member'}});
  assert.equal((await memberAccess(owner,t.id,['a@example.com','b@example.com'])).status,200);
  const period=await billingPeriod(pool),next=new Date(period+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const future=next.toISOString().slice(0,10);
  const renew=()=>transaction(pool,c=>reconcileTenantBilling(c,t.id,future));
  const unpaid=await renew();assert.equal(unpaid.pending_seats,2);assert.equal(unpaid.missing_cents,1800);
  assert.equal((await productAccess(pool,t.id,'a@example.com',future)).app_status,'awaiting_payment');
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1 AND period=$2',[t.id,future])).rows[0].n,0);
  await credit(1800);
  await Promise.all([renew(),renew()]);
  assert.equal((await productAccess(pool,t.id,'a@example.com',future)).can_translate,true);
  assert.equal((await call(`/api/tenants/${t.id}/balance`,{actor:owner})).data.balance_cents,0);
  await call('/api/billing-settings',{actor:op,method:'PUT',body:{unit_price_cents:700,plus_price_cents:500,business_price_cents:1000}});
  await renew();
  assert.deepEqual((await pool.query('SELECT DISTINCT unit_price_cents FROM seat_charges WHERE tenant_id=$1 AND period=$2',[t.id,future])).rows.map(r=>r.unit_price_cents),[500]);
  const b=(await call(`/api/tenants/${t.id}`,{actor:owner})).data.members.find(m=>m.email==='b@example.com');
  await call(`/api/tenants/${t.id}/members/${b.id}`,{actor:owner,method:'PATCH',body:{status:'disabled'}});
  await credit(1700);next.setUTCMonth(next.getUTCMonth()+1);const later=next.toISOString().slice(0,10);
  await transaction(pool,c=>reconcileTenantBilling(c,t.id,later));
  assert.equal((await productAccess(pool,t.id,'b@example.com',later)).app_status,'disabled');
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1 AND period=$2',[t.id,later])).rows[0].n,1);
  await call('/api/billing-settings',{actor:op,method:'PUT',body:{unit_price_cents:500,plus_price_cents:500,business_price_cents:1000}});
});

test('only operator stores encrypted provider keys; rotation applies to the next translation without leaking keys',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const path='/api/provider-credentials/managed';const key='private-test-provider-key';
  assert.equal((await call(path,{actor:owner,method:'PUT',body:{key}})).status,403);
  assert.equal((await call('/api/provider-credentials',{actor:owner})).status,403);
  assert.equal((await call(path,{method:'PUT',body:{key},headers:{Cookie:`artype_session=${op.token}`}})).status,403);
  const saved=await call(path,{actor:op,method:'PUT',body:{key}});assert.equal(saved.status,200);
  assert.ok(!JSON.stringify(saved.data).includes(key));
  const listing=await call('/api/provider-credentials',{actor:op});assert.equal(listing.status,200);
  assert.ok(listing.data.credentials.some(c=>c.alias==='managed'&&c.source==='admin'));
  assert.ok(!JSON.stringify(listing.data).includes(key));
  const row=(await pool.query("SELECT ciphertext FROM provider_credentials WHERE alias='managed'")).rows[0];
  assert.ok(row.ciphertext.length>30&&!row.ciphertext.includes(key));
  const t=await tenant(op,'owner@example.com',{credential:'managed'});
  const request=()=>call('/api/translate',{actor:owner,method:'POST',body:{tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'en'}});
  assert.equal((await request()).status,200);assert.equal(upstreamCredentials.at(-1),key);
  assert.equal((await call(path,{actor:op,method:'PUT',body:{key:'rotated-private-key'}})).status,200);
  assert.equal((await request()).status,200);assert.equal(upstreamCredentials.at(-1),'rotated-private-key');
  assert.equal((await call(path,{actor:op,method:'PUT',body:{key:''}})).status,422);
  assert.ok(!JSON.stringify((await call('/api/tenants',{actor:op})).data).includes('rotated-private-key'));
  assert.ok(!JSON.stringify((await pool.query('SELECT * FROM audit')).rows).includes(key));
});

test('missing encryption key and corrupted stored credentials fail before any provider request or usage reservation',async()=>{
  const op=await actor('operator@example.com');const path='/api/provider-credentials/managed';
  const master=config.credentialEncryptionKey;config.credentialEncryptionKey='';
  try{assert.equal((await call(path,{actor:op,method:'PUT',body:{key:'private-test-key'}})).status,503)}finally{config.credentialEncryptionKey=master}
  assert.equal((await call(path,{actor:op,method:'PUT',body:{key:'private-test-key'}})).status,200);
  const t=await tenant(op,'operator@example.com',{credential:'managed'});
  await pool.query("UPDATE provider_credentials SET ciphertext='corrupted' WHERE alias='managed'");
  assert.equal((await call('/api/translate',{actor:op,method:'POST',body:{tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'en'}})).status,503);
  assert.equal(upstreamCalls.length,0);assert.equal((await pool.query('SELECT count(*)::int n FROM usage')).rows[0].n,0);
});

test('unauthenticated requests and missing CSRF cannot change organizations',async()=>{
  assert.equal((await call('/api/tenants')).status,401);
  const op=await actor('operator@example.com');
  assert.equal((await call('/api/tenants',{method:'POST',body:{},headers:{Cookie:`artype_session=${op.token}`}})).status,403);
});
test('only operator provisions tenants; member cannot read another tenant or see credentials',async()=>{
  const op=await actor('operator@example.com'), a=await actor('a@example.com'), b=await actor('b@example.com');
  const ta=await tenant(op,'a@example.com'), tb=await tenant(op,'b@example.com');
  assert.equal((await call('/api/tenants',{actor:a,method:'POST',body:{name:'Hack'}})).status,403);
  assert.equal((await call(`/api/tenants/${tb.id}`,{actor:a})).status,403);
  const me=await call('/api/me',{actor:a}); assert.deepEqual(me.data.tenants.map(t=>t.id),[ta.id]);
  assert.ok(!JSON.stringify(me.data).includes('server-only-key'));
  assert.equal((await call(`/api/tenants/${ta.id}`,{actor:b})).status,403);
});
test('concurrent connections cannot exceed seats and last owner cannot be removed',async()=>{
  const op=await actor('operator@example.com'), owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{seats:2});
  const rs=await Promise.all(['one','two'].map(e=>call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:`${e}@example.com`,role:'member'}})));
  assert.deepEqual(rs.map(r=>r.status).sort(),[201,201]);
  const activations=await Promise.all(['one','two'].map(e=>memberAccess(owner,t.id,[`${e}@example.com`])));
  assert.deepEqual(activations.map(r=>r.status).sort(),[200,409]);
  const members=(await call(`/api/tenants/${t.id}`,{actor:owner})).data.members;
  const own=members.find(m=>m.email==='owner@example.com');
  assert.equal((await call(`/api/tenants/${t.id}/members/${own.id}`,{actor:owner,method:'PATCH',body:{status:'disabled'}})).status,409);
  assert.equal((await call(`/api/tenants/${t.id}`,{actor:owner,method:'PATCH',body:{seats:99}})).status,403);
});

test('expired owner invitation cannot replace the last active owner',async()=>{
  const op=await actor('operator@example.com'), owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com');await call('/api/me',{actor:owner});
  await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:'other@example.com',role:'owner'}});
  await pool.query("UPDATE memberships SET expires_at=now()-interval '1 second' WHERE email='other@example.com'");
  const id=(await pool.query("SELECT id FROM memberships WHERE email='owner@example.com'")).rows[0].id;
  assert.equal((await call(`/api/tenants/${t.id}/members/${id}`,{actor:owner,method:'PATCH',body:{role:'member'}})).status,409);
});

test('login activation waits for tenant lock then rechecks invitation expiry',async()=>{
  const op=await actor('operator@example.com'), a=await actor('a@example.com');
  const t=await tenant(op,'owner@example.com',{seats:2});
  await call(`/api/tenants/${t.id}/members`,{actor:op,method:'POST',body:{email:'a@example.com',role:'member'}});
  const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[t.id]);
  let completed=false;const request=call('/api/me',{actor:a}).then(r=>{completed=true;return r});
  await new Promise(r=>setTimeout(r,80));
  const waited=!completed;
  await lock.query("UPDATE memberships SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND email='a@example.com'",[t.id]);
  await lock.query('COMMIT');lock.release();
  const result=await request;assert.ok(waited,'activation must participate in organization locking');
  assert.equal(result.data.tenants.length,0);
  assert.equal((await pool.query("SELECT status FROM memberships WHERE email='a@example.com'")).rows[0].status,'invited');
});
test('proxy enforces quota atomically and constructs provider prompt on server',async()=>{
  const op=await actor('operator@example.com'), a=await actor('a@example.com');
  const t=await tenant(op,'a@example.com',{monthly_characters:15,instructions:'Use Acme terminology.'});
  const request=()=>call('/api/translate',{actor:a,method:'POST',body:{tenant_id:t.id,request_id:randomUUID(),text:'1234567890',target:'en',source:'ru',style:'formal'}});
  const rs=await Promise.all([request(),request()]); assert.deepEqual(rs.map(r=>r.status).sort(),[200,429]);
  assert.equal(upstreamCalls.length,1); assert.equal(upstreamCalls[0].model,'test-model');
  assert.match(upstreamCalls[0].messages[0].content,/Acme terminology/);
  assert.match(rs.find(r=>r.status===200).data,/Hello world/);
  const rows=(await pool.query('SELECT * FROM usage')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].characters,10);
  assert.ok(!JSON.stringify(rows).includes('1234567890')); assert.ok(!JSON.stringify(rows).includes('Hello world'));
});
test('usage time is taken after the tenant lock is granted, not when the transaction began', async () => {
  const op = await actor('operator@example.com');
  const owner = await actor('owner@example.com');
  const organization = await tenant(op, 'owner@example.com');
  const blocker = await pool.connect();
  let request;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [organization.id]);
    request = call('/api/translate', { actor: owner, method: 'POST', body: {
      tenant_id: organization.id, request_id: randomUUID(), text: 'Привет', target: 'en',
    } });
    // Observe the actual blocked request rather than relying on a fixed sleep.
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await pool.query(`
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%FROM tenants WHERE id=$1%FOR UPDATE%'
      `)).rowCount > 0;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'translation must be waiting on the tenant lock');
    const releasedAt = (await blocker.query('SELECT clock_timestamp() AS time')).rows[0].time;
    await blocker.query('COMMIT');
    assert.equal((await request).status, 200);
    const usage = (await pool.query('SELECT created_at FROM usage WHERE tenant_id=$1', [organization.id])).rows[0];
    assert.ok(usage.created_at >= releasedAt, 'usage must belong to the month/rate window when access was granted');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (request) await request;
  }
});

test('blocked members, suspended tenants, forbidden languages and expired access cannot translate',async()=>{
  const op=await actor('operator@example.com'), a=await actor('a@example.com'); const t=await tenant(op,'a@example.com');
  const body={tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'de',style:'faithful'};
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body})).status,422);
  await call(`/api/tenants/${t.id}`,{actor:op,method:'PATCH',body:{status:'suspended'}});
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body:{...body,target:'en'}})).status,403);
  await call(`/api/tenants/${t.id}`,{actor:op,method:'PATCH',body:{status:'active',access_until:'2020-01-01T00:00:00Z'}});
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body:{...body,target:'en'}})).status,403);
  await call(`/api/tenants/${t.id}`,{actor:op,method:'PATCH',body:{access_until:null}});
  await pool.query("UPDATE memberships SET status='disabled' WHERE tenant_id=$1",[t.id]);
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body:{...body,target:'en'}})).status,403);
  assert.equal(upstreamCalls.length,0);
});
test('duplicate request never spends twice; provider error is sanitized and releases reservation',async()=>{
  const op=await actor('operator@example.com'), a=await actor('a@example.com'), t=await tenant(op,'a@example.com');
  const body={tenant_id:t.id,request_id:randomUUID(),text:'Привет',target:'en',style:'faithful'};
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body})).status,200);
  assert.equal((await call('/api/translate',{actor:a,method:'POST',body})).status,409);
  upstreamFail=true; const failed=await call('/api/translate',{actor:a,method:'POST',body:{...body,request_id:randomUUID()}});
  assert.equal(failed.status,502); assert.ok(!JSON.stringify(failed.data).includes('secret'));
  assert.equal((await pool.query("SELECT count(*)::int n FROM usage WHERE status='pending'")).rows[0].n,0);
});
test('Google state is bound to browser, one-use and nonce checked',async()=>{
  const start=await call('/auth/google'); assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const cookie=start.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(`/auth/google/callback?state=${state}&code=x`)).status,400);
  const row=(await pool.query('SELECT * FROM oauth_states')).rows[0];
  googleClaims={sub:'google-id',email:'operator@example.com',email_verified:true,name:'Op',nonce:'wrong'};
  assert.equal((await call(`/auth/google/callback?state=${state}&code=x`,{headers:{Cookie:cookie}})).status,400);
  const next=await call('/auth/google'); const ns=new URL(next.headers.get('location')).searchParams.get('state');
  const nc=next.headers.get('set-cookie').split(';')[0];
  const nr=(await pool.query('SELECT * FROM oauth_states WHERE state_hash=$1',[hash(ns)])).rows[0];
  googleClaims={sub:'google-id',email:'operator@example.com',email_verified:true,name:'Op',nonce:nr.nonce};
  assert.equal((await call(`/auth/google/callback?state=${ns}&code=x`,{headers:{Cookie:nc}})).status,302);
  assert.equal((await call(`/auth/google/callback?state=${ns}&code=x`,{headers:{Cookie:nc}})).status,400);
});

test('simultaneous first Google logins create one identity and two valid sessions',async()=>{
  const starts=await Promise.all([call('/auth/google'),call('/auth/google')]);
  const states=starts.map(r=>new URL(r.headers.get('location')).searchParams.get('state'));
  for(let i=0;i<2;i++){
    const row=(await pool.query('SELECT nonce FROM oauth_states WHERE state_hash=$1',[hash(states[i])])).rows[0];
    claimsByCode.set('parallel'+i,{sub:'same-google-user',email:'new@example.com',email_verified:true,name:'New',nonce:row.nonce});
  }
  const barrier=await pool.connect();await barrier.query('BEGIN');await barrier.query('LOCK TABLE users IN SHARE MODE');
  const requests=starts.map((r,i)=>call(`/auth/google/callback?state=${states[i]}&code=parallel${i}`,{headers:{Cookie:r.headers.get('set-cookie').split(';')[0]}}));
  await new Promise(r=>setTimeout(r,80));await barrier.query('COMMIT');barrier.release();
  const results=await Promise.all(requests);assert.deepEqual(results.map(r=>r.status),[302,302]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM users WHERE sub='same-google-user'")).rows[0].n,1);
  for(const r of results)assert.equal((await call('/api/me',{headers:{Cookie:r.headers.getSetCookie().find(c=>c.startsWith('artype_session=')).split(';')[0]}})).status,200);
  claimsByCode.clear();
});
test('device grant requires approved browser session and verifier, redeemed once; logout revokes token',async()=>{
  const op=await actor('operator@example.com'); const verifier='a'.repeat(64);
  const d=(await call('/api/device/start',{method:'POST',body:{challenge:hash(verifier)}})).data;
  const poll={id:d.id,poll_token:d.poll_token,verifier};
  assert.equal((await call('/api/device/poll',{method:'POST',body:poll})).status,202);
  assert.equal((await call(`/api/device/${d.id}/approve`,{actor:op,method:'POST',body:{code:'bad'}})).status,403);
  assert.equal((await call(`/api/device/${d.id}/approve`,{actor:op,method:'POST',body:{code:d.code}})).status,200);
  assert.equal((await call('/api/device/poll',{method:'POST',body:{...poll,verifier:'b'.repeat(64)}})).status,403);
  const granted=await call('/api/device/poll',{method:'POST',body:poll}); assert.equal(granted.status,200);
  assert.equal((await call('/api/device/poll',{method:'POST',body:poll})).status,410);
  const h={Authorization:`Bearer ${granted.data.token}`};
  assert.equal((await call('/api/me',{headers:h})).status,200);
  assert.equal((await call('/api/logout',{method:'POST',headers:h})).status,200);
  assert.equal((await call('/api/me',{headers:h})).status,401);
});

test('valid device polling is isolated for employees behind the same office IP',async()=>{
  const verifier='c'.repeat(64),devices=[];
  for(let i=0;i<12;i++)devices.push((await call('/api/device/start',{method:'POST',body:{challenge:hash(verifier)}})).data);
  for(let i=0;i<20;i++)for(const d of devices){
    const r=await call('/api/device/poll',{method:'POST',body:{id:d.id,poll_token:d.poll_token,verifier}});
    assert.equal(r.status,202,'one device must not consume another device polling allowance');
  }
});

const planDefaults = {registration_enabled:true,credential:'main',model:'managed-model',monthly_characters:10000,seats:100,languages:['en','ru']};
async function enablePlans(op) {
  for (const plan of ['plus','business']) assert.equal((await call('/api/plan-defaults/'+plan,{actor:op,method:'PUT',body:{...planDefaults,seats:plan==='plus'?1:100}})).status,200);
}
async function selfWorkspace(user, plan='plus') {
  const result = await call('/api/workspaces',{actor:user,method:'POST',body:{plan,name:'My '+plan,idempotency_key:randomUUID()}});
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.data;
}

test('public plan catalog exposes prices without provider configuration or authentication',async()=>{
  const r=await call('/api/plans');assert.equal(r.status,200);
  assert.deepEqual(r.data.plans.map(p=>[p.plan,p.price_cents,p.seat_price_cents]),[['business',1000,500],['plus',500,0]]);
  assert.ok(!JSON.stringify(r.data).includes('credential'));
  assert.equal((await call('/api/plan-defaults')).status,401);
});

test('self-registration is owner-bound, idempotent and uses trusted plan defaults',async()=>{
  const op=await actor('operator@example.com'),user=await actor('self@example.com');
  await enablePlans(op);
  assert.equal((await call('/api/plan-defaults/plus',{actor:user,method:'PUT',body:{...planDefaults,seats:1}})).status,403);
  const body={plan:'business',name:'Self service',idempotency_key:randomUUID()};
  assert.equal((await call('/api/workspaces',{actor:user,method:'POST',body:{...body,credential:'steal'}})).status,422);
  const results=await Promise.all([call('/api/workspaces',{actor:user,method:'POST',body}),call('/api/workspaces',{actor:user,method:'POST',body})]);
  assert.deepEqual(results.map(r=>r.status),[201,201]);assert.equal(results[0].data.id,results[1].data.id);
  assert.equal((await call('/api/workspaces',{actor:user,method:'POST',body:{...body,name:'Different'}})).status,409);
  const details=(await call('/api/tenants/'+results[0].data.id,{actor:user})).data;
  assert.equal(details.tenant.credential,'main');assert.equal(details.tenant.model,'managed-model');
  assert.equal(details.members[0].email,'self@example.com');assert.equal(details.members[0].product_enabled,false);
  const plus=await Promise.all([selfWorkspace(user),selfWorkspace(user)]);assert.equal(plus[0].id,plus[1].id);
  assert.equal((await call('/api/me',{actor:user})).data.tenants.length,2);
});

test('Plus pays one subscription including AI and cannot gain team management through APIs',async()=>{
  const op=await actor('operator@example.com'),user=await actor('solo@example.com'),other=await actor('other@example.com');
  await enablePlans(op);const w=await selfWorkspace(user);
  const request=()=>call('/api/translate',{actor:user,method:'POST',body:{tenant_id:w.id,request_id:randomUUID(),text:'Привет',target:'en'}});
  assert.equal((await request()).status,402);
  await call(`/api/tenants/${w.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:500,reason:'Plus paid',idempotency_key:randomUUID()}});
  assert.equal((await request()).status,200);assert.equal(upstreamCalls.at(-1).model,'managed-model');
  const d=(await call('/api/tenants/'+w.id,{actor:user})).data;
  assert.equal(d.billing.balance_cents,0);assert.equal(d.billing.subscription_paid,true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1',[w.id])).rows[0].n,0);
  assert.equal((await call(`/api/tenants/${w.id}/members`,{actor:user,method:'POST',body:{email:'other@example.com',role:'owner'}})).status,403);
  assert.equal((await call(`/api/tenants/${w.id}/members/${d.members[0].id}`,{actor:op,method:'PATCH',body:{role:'member'}})).status,403);
  assert.equal((await call(`/api/tenants/${w.id}`,{actor:user,method:'PATCH',body:{instructions:'Corporate rules'}})).status,403);
  assert.equal((await call(`/api/tenants/${w.id}/balance`,{actor:other})).status,403);
  // A personal subscriber may independently join a Business workspace.
  const b=await tenant(op,'operator@example.com',{}, {paidOwner:false});
  assert.equal((await call(`/api/tenants/${b.id}/members`,{actor:op,method:'POST',body:{email:'solo@example.com',role:'member'}})).status,201);
  assert.equal((await call('/api/me',{actor:user})).data.tenants.length,2);
});

test('Business bills base plus seats; lifecycle renewal is internal and has no console endpoint',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('business@example.com');
  await enablePlans(op);const w=await selfWorkspace(owner,'business');
  assert.equal((await memberAccess(owner,w.id,['business@example.com'])).status,402);
  const credit=amount_cents=>call(`/api/tenants/${w.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents,reason:'Business paid',idempotency_key:randomUUID()}});
  await credit(1499);
  let d=(await call(`/api/tenants/${w.id}`,{actor:owner})).data;
  assert.equal(d.billing.balance_cents,499);assert.equal((await memberAccess(owner,w.id,['business@example.com'])).status,402);
  await credit(1);assert.equal((await memberAccess(owner,w.id,['business@example.com'])).status,200);d=(await call(`/api/tenants/${w.id}`,{actor:owner})).data;
  assert.equal(d.billing.balance_cents,0);assert.equal(d.members[0].can_translate,true);
  assert.deepEqual(d.billing.entries.filter(e=>e.source==='system').map(e=>e.delta_cents).sort((a,b)=>a-b),[-1000,-500]);
  assert.equal((await call(`/api/tenants/${w.id}/renewal`,{actor:owner,method:'PUT',body:{enabled:false}})).status,404);
  await setRenewal(pool,config,owner,w.id,false);
  assert.equal((await productAccess(pool,w.id,'business@example.com')).can_translate,true);
  await credit(2000);
  const next=new Date(await billingPeriod(pool)+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
  const period=next.toISOString().slice(0,10);
  await transaction(pool,db=>reconcileTenantBilling(db,w.id,period));
  assert.equal((await productAccess(pool,w.id,'business@example.com',period)).can_translate,false);
  assert.equal((await call(`/api/tenants/${w.id}/members`,{actor:owner,method:'POST',body:{email:'new@example.com',role:'member'}})).status,201);
  assert.equal((await memberAccess(owner,w.id,['new@example.com'])).status,409);
  await setRenewal(pool,config,owner,w.id,true);
  await transaction(pool,db=>reconcileTenantBilling(db,w.id,period));
  assert.equal((await productAccess(pool,w.id,'business@example.com',period)).can_translate,true);
});

test('payment requests survive reload; only admins settle and duplicate confirmations credit once',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('pay@example.com'),other=await actor('other@example.com');
  await enablePlans(op);const w=await selfWorkspace(owner);
  const path=`/api/tenants/${w.id}/payment-orders`,body={amount_cents:2000,idempotency_key:randomUUID()};
  const created=await call(path,{actor:owner,method:'POST',body});assert.equal(created.status,201);
  const id=created.data.id;
  assert.equal((await call(path,{actor:owner,method:'POST',body})).data.id,id);
  assert.equal((await call(path,{actor:owner,method:'POST',body:{...body,amount_cents:3000}})).status,409);
  assert.equal((await call(path,{actor:other,method:'POST',body})).status,403);
  assert.equal((await call(`/api/tenants/${w.id}/balance`,{actor:owner})).data.orders[0].id,id);
  const settle=`/api/payment-orders/${id}/settle`,payment={amount_cents:2000,currency:'USD',reference:'BANK-001'};
  assert.equal((await call(settle,{actor:owner,method:'POST',body:payment})).status,403);
  assert.equal((await call(settle,{actor:op,method:'POST',body:{...payment,amount_cents:1999}})).status,409);
  const results=await Promise.all([call(settle,{actor:op,method:'POST',body:payment}),call(settle,{actor:op,method:'POST',body:payment})]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.ledger_id,results[1].data.ledger_id);
  const wallet=(await call(`/api/tenants/${w.id}/balance`,{actor:owner})).data;
  assert.equal(wallet.balance_cents,1500);assert.equal(wallet.orders[0].status,'paid');
  assert.equal(wallet.entries.filter(e=>e.source==='payment').length,1);
  assert.equal((await call(settle,{actor:op,method:'POST',body:{...payment,reference:'BANK-002'}})).status,409);
  const another=await call(path,{actor:owner,method:'POST',body:{...body,idempotency_key:randomUUID()}});
  assert.equal((await call(`/api/payment-orders/${another.data.id}/settle`,{actor:op,method:'POST',body:payment})).status,409);
});

test('bulk quote is read-only; insufficient funds reject every selected seat and legacy patch bypass',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  for(const email of ['a@example.com','b@example.com'])assert.equal((await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email,role:'member'}})).status,201);
  const members=(await pool.query('SELECT * FROM memberships WHERE tenant_id=$1 ORDER BY email',[t.id])).rows;
  assert.ok(members.every(m=>!m.product_enabled));
  const selected=members.filter(m=>m.role==='member').map(m=>m.id), path=`/api/tenants/${t.id}/member-access`;
  const body={member_ids:selected,enabled:true};
  const quote=await call(path+'/quote',{actor:owner,method:'POST',body});
  assert.equal(quote.status,200);assert.equal(quote.data.base_cents,1000);assert.equal(quote.data.seats_cents,1000);
  assert.equal(quote.data.total_cents,2000);assert.equal(quote.data.missing_cents,2000);assert.equal(quote.data.allowed,false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM balance_ledger WHERE tenant_id=$1',[t.id])).rows[0].n,0);
  assert.equal((await call(path,{actor:owner,method:'POST',body:{...body,quote_token:quote.data.quote_token,idempotency_key:randomUUID()}})).status,402);
  assert.equal((await call(`/api/tenants/${t.id}/members/${selected[0]}`,{actor:owner,method:'PATCH',body:{product_enabled:true}})).status,422);
  assert.ok((await pool.query('SELECT product_enabled FROM memberships WHERE tenant_id=$1',[t.id])).rows.every(m=>!m.product_enabled));
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1',[t.id])).rows[0].n,0);
});

test('bulk confirmation is atomic and durably replayable; disabling stops renewal and reconnecting paid seats is free',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  for(const email of ['a@example.com','b@example.com'])await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email,role:'member'}});
  await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:2000,reason:'Test deposit',idempotency_key:randomUUID()}});
  const ids=(await pool.query("SELECT id FROM memberships WHERE tenant_id=$1 AND role='member' ORDER BY id",[t.id])).rows.map(m=>m.id);
  const path=`/api/tenants/${t.id}/member-access`,selection={member_ids:ids,enabled:true};
  const q=(await call(path+'/quote',{actor:owner,method:'POST',body:selection})).data;
  assert.equal(q.allowed,true);assert.equal(q.total_cents,1000);
  const body={...selection,quote_token:q.quote_token,idempotency_key:randomUUID()};
  const results=await Promise.all([call(path,{actor:owner,method:'POST',body}),call(path,{actor:owner,method:'POST',body})]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].data,results[1].data);
  assert.equal((await pool.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1',[t.id])).rows[0].balance_cents,'0');
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1',[t.id])).rows[0].n,2);
  const disabled=await memberAccess(owner,t.id,['a@example.com','b@example.com'],false);
  assert.equal(disabled.status,200);assert.equal(disabled.data.charged_cents,0);
  assert.equal((await productAccess(pool,t.id,'a@example.com')).can_translate,false);
  assert.equal((await call(path,{actor:owner,method:'POST',body})).status,200,'replaying an old successful operation must not reconnect seats');
  assert.ok((await pool.query("SELECT product_enabled FROM memberships WHERE tenant_id=$1 AND role='member'",[t.id])).rows.every(m=>!m.product_enabled));
  const free=(await call(path+'/quote',{actor:owner,method:'POST',body:selection})).data;
  assert.equal(free.total_cents,0);assert.equal(free.already_paid_seats,2);assert.equal(free.allowed,true);
  assert.equal((await memberAccess(owner,t.id,['a@example.com'])).status,200);
  assert.equal((await productAccess(pool,t.id,'a@example.com')).can_translate,true);
  assert.equal((await call(path,{actor:owner,method:'POST',body:{...body,enabled:false}})).status,409);
  await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:1500,reason:'Next month deposit',idempotency_key:randomUUID()}});
  await transaction(pool,db=>reconcileTenantBilling(db,t.id,disabled.data.next_period));
  const future=(await pool.query('SELECT email FROM seat_charges WHERE tenant_id=$1 AND period=$2',[t.id,disabled.data.next_period])).rows;
  assert.deepEqual(future.map(r=>r.email),['a@example.com']);
});

test('changed price or balance invalidates a quote; foreign, expired and elevated-role selections cannot bypass checks',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com'),admin=await actor('admin@example.com');
  const t=await tenant(op,'owner@example.com'),other=await tenant(op,'other@example.com');
  for(const [email,role] of [['admin@example.com','admin'],['a@example.com','member']])await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email,role}});
  const members=(await pool.query('SELECT id,email FROM memberships WHERE tenant_id=$1',[t.id])).rows;
  const id=email=>members.find(m=>m.email===email).id;
  const path=`/api/tenants/${t.id}/member-access`,selection={member_ids:[id('a@example.com')],enabled:true};
  const quote=()=>call(path+'/quote',{actor:owner,method:'POST',body:selection});
  const apply=q=>call(path,{actor:owner,method:'POST',body:{...selection,quote_token:q.data.quote_token,idempotency_key:randomUUID()}});
  const old=await quote();await pool.query('UPDATE billing_settings SET unit_price_cents=600');
  assert.equal((await apply(old)).data.error.code,'access_quote_changed');
  const fresh=await quote();await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:100,reason:'Concurrent deposit',idempotency_key:randomUUID()}});
  assert.equal((await apply(fresh)).status,409);
  assert.equal((await call(path+'/quote',{actor:admin,method:'POST',body:{member_ids:[id('owner@example.com')],enabled:true}})).status,403);
  const adminQuote=await call(path+'/quote',{actor:admin,method:'POST',body:selection});
  assert.equal(adminQuote.status,200);assert.equal(adminQuote.data.balance_cents,null);assert.equal(adminQuote.data.can_manage_balance,false);
  const foreign=(await pool.query('SELECT id FROM memberships WHERE tenant_id=$1',[other.id])).rows[0].id;
  assert.equal((await call(path+'/quote',{actor:owner,method:'POST',body:{member_ids:[foreign],enabled:true}})).status,404);
  assert.equal((await call(path+'/quote',{actor:owner,method:'POST',body:{member_ids:[id('a@example.com'),id('a@example.com')],enabled:true}})).status,422);
  await pool.query("UPDATE memberships SET expires_at=now()-interval '1 day' WHERE id=$1",[id('a@example.com')]);
  const expired=await quote();assert.equal(expired.data.blocked,'members_inactive');assert.equal((await apply(expired)).status,409);
});

test('restoring console membership cannot silently buy or reconnect app access',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com');
  await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:'a@example.com',role:'member'}});
  await memberAccess(owner,t.id,['a@example.com']);
  const m=(await pool.query("SELECT id FROM memberships WHERE tenant_id=$1 AND email='a@example.com'",[t.id])).rows[0];
  for(const status of ['disabled','invited'])assert.equal((await call(`/api/tenants/${t.id}/members/${m.id}`,{actor:owner,method:'PATCH',body:{status}})).status,200);
  assert.equal((await pool.query('SELECT product_enabled FROM memberships WHERE id=$1',[m.id])).rows[0].product_enabled,false);
});

test('operator inbox shows requester and workspace, paginates without gaps, and excludes settled requests from pending',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  const order=(await call(`/api/tenants/${t.id}/payment-orders`,{actor:owner,method:'POST',body:{amount_cents:2000,idempotency_key:randomUUID()}})).data;
  assert.equal((await call('/api/invoice-requests',{actor:owner})).status,403);
  let inbox=(await call('/api/invoice-requests',{actor:op})).data;
  assert.equal(inbox.pending_count,1);assert.equal(inbox.requests[0].requested_by,'owner@example.com');assert.equal(inbox.requests[0].workspace_name,'Acme');
  await pool.query('INSERT INTO payment_orders(id,tenant_id,created_by,amount_cents,idempotency_key) SELECT gen_random_uuid(),$1,$2,100,gen_random_uuid() FROM generate_series(1,51)',[t.id,owner.id]);
  inbox=(await call('/api/invoice-requests',{actor:op})).data;
  assert.equal(inbox.requests.length,50);assert.equal(inbox.pending_count,52);
  const page2=(await call('/api/invoice-requests?after='+inbox.next_cursor,{actor:op})).data;
  assert.equal(page2.requests.length,2);assert.equal(new Set([...inbox.requests,...page2.requests].map(r=>r.id)).size,52);
  await call(`/api/payment-orders/${order.id}/settle`,{actor:op,method:'POST',body:{amount_cents:2000,currency:'USD',reference:'PAID-INBOX-001'}});
  assert.equal((await call('/api/invoice-requests',{actor:op})).data.pending_count,51);
  const paid=(await call('/api/invoice-requests?status=paid',{actor:op})).data;
  assert.equal(paid.requests.length,1);assert.equal(paid.requests[0].id,order.id);
});

test('disabling the optional inbox leaves payment creation, settlement and product access functional',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{}, {paidOwner:false});
  const isolated=createApp({pool,config:{...config,invoiceInboxEnabled:false},google:{},translate:async()=>({text:'OK'})}).listen(0,'127.0.0.1');
  await new Promise(resolve=>isolated.once('listening',resolve));
  const priorURL=url;url=`http://127.0.0.1:${isolated.address().port}`;
  try {
    assert.equal((await call('/api/invoice-requests',{actor:op})).status,404);
    assert.equal((await call('/api/me',{actor:op})).data.features.invoice_inbox,false);
    const order=(await call(`/api/tenants/${t.id}/payment-orders`,{actor:owner,method:'POST',body:{amount_cents:1500,idempotency_key:randomUUID()}})).data;
    assert.equal((await call(`/api/payment-orders/${order.id}/settle`,{actor:op,method:'POST',body:{amount_cents:1500,currency:'USD',reference:'WITHOUT-INBOX'}})).status,200);
    assert.equal((await memberAccess(owner,t.id,['owner@example.com'])).status,200);
    assert.equal((await productAccess(pool,t.id,'owner@example.com')).can_translate,true);
  } finally {url=priorURL;await new Promise(resolve=>isolated.close(resolve));}
});

test('editing an expired invitation cannot extend it or silently reconnect its paid seat',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com');
  await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:'a@example.com',role:'member'}});
  await memberAccess(owner,t.id,['a@example.com']);
  const m=(await pool.query("UPDATE memberships SET expires_at=now()-interval '1 day' WHERE tenant_id=$1 AND email='a@example.com' RETURNING id,expires_at",[t.id])).rows[0];
  assert.equal((await call(`/api/tenants/${t.id}/members/${m.id}`,{actor:owner,method:'PATCH',body:{role:'admin'}})).status,200);
  let row=(await pool.query('SELECT * FROM memberships WHERE id=$1',[m.id])).rows[0];
  assert.equal(row.product_enabled,false);assert.equal(row.expires_at.toISOString(),m.expires_at.toISOString());
  assert.equal((await call(`/api/tenants/${t.id}/members/${m.id}`,{actor:owner,method:'PATCH',body:{status:'invited'}})).status,200);
  row=(await pool.query('SELECT * FROM memberships WHERE id=$1',[m.id])).rows[0];
  assert.equal(row.product_enabled,false);assert.ok(row.expires_at>new Date());
});

async function invitationQuote(user, tenantId, body) {
  const response=await call(`/api/tenants/${tenantId}/invitations/quote`,{actor:user,method:'POST',body});
  assert.equal(response.status,200,JSON.stringify(response.data));
  return response.data;
}
async function confirmInvitations(user, tenantId, body, quote, key=randomUUID()) {
  return call(`/api/tenants/${tenantId}/invitations`,{actor:user,method:'POST',body:{...body,quote_token:quote.quote_token,idempotency_key:key}});
}

test('people directory combines registered and invited identities, supports both plans and hides personal spaces from workspace lists',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com'),solo=await actor('solo@example.com');
  await actor('unassigned@example.com');await enablePlans(op);
  const personal=await selfWorkspace(owner),soloPersonal=await selfWorkspace(solo);
  const business=await tenant(op,owner.email,{}, {paidOwner:false});
  await call(`/api/tenants/${business.id}/members`,{actor:owner,method:'POST',body:{email:'pending@example.com',role:'member'}});
  const result=await call('/api/users',{actor:op});assert.equal(result.status,200);
  const rows=result.data.users;assert.equal(rows.length,5);
  const both=rows.find(u=>u.email===owner.email);assert.equal(both.personal,true);assert.equal(both.business,true);assert.equal(both.personal_tenant_id,personal.id);
  assert.equal(rows.find(u=>u.email==='pending@example.com').registered,false);
  assert.equal(rows.find(u=>u.email==='unassigned@example.com').business,false);
  assert.equal((await call('/api/users?type=both',{actor:op})).data.total,1);
  assert.equal((await call('/api/users?q=SOLO',{actor:op})).data.users[0].personal_tenant_id,soloPersonal.id);
  assert.equal((await call('/api/users?type=neither',{actor:op})).data.total,2);
  assert.equal((await call('/api/users',{actor:owner})).status,403);
  assert.equal((await call('/api/users?type=invalid',{actor:op})).status,422);
  assert.equal((await call('/api/users?q=%25',{actor:op})).data.total,0,'search treats percent literally');
  assert.deepEqual((await call('/api/tenants',{actor:op})).data.tenants.map(t=>t.id),[business.id]);
  assert.equal((await call('/api/me',{actor:op})).data.tenants.length,0,'profile does not enumerate all customer spaces');
  assert.deepEqual((await call('/api/dashboard',{actor:op})).data.tenants.map(t=>t.id),[business.id]);
  assert.equal((await call(`/api/tenants/${personal.id}`,{actor:op})).status,200,'directory link retains operator management');
});

test('people directory paginates a thousand identities without duplicate or unbounded pages',async()=>{
  const op=await actor('operator@example.com');
  await pool.query(`INSERT INTO users(id,sub,email,name) SELECT gen_random_uuid(),'directory-'||n,
    'directory-'||lpad(n::text,4,'0')||'@example.com','Directory user '||n FROM generate_series(1,1000) n`);
  const first=(await call('/api/users?q=directory-&page=1',{actor:op})).data;
  const next=(await call('/api/users?q=directory-&page=2',{actor:op})).data;
  assert.equal(first.total,1000);assert.equal(first.users.length,50);assert.equal(next.users.length,50);
  assert.equal(new Set([...first.users,...next.users].map(u=>u.email)).size,100);
  assert.equal((await call('/api/users?q=directory-&page=21',{actor:op})).data.users.length,0);
});

test('bulk invitations normalize duplicates, skip existing members and replay atomically without overwriting roles',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,owner.email,{}, {paidOwner:false});
  const body={emails:[' A@Example.com ','a@example.com','b@example.com',owner.email],role:'member',enabled:false};
  const q=await invitationQuote(owner,t.id,body);assert.equal(q.selected_count,2);assert.equal(q.total_cents,0);
  assert.deepEqual(q.skipped_emails,[owner.email]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM memberships WHERE tenant_id=$1',[t.id])).rows[0].n,1);
  const key=randomUUID();const results=await Promise.all([confirmInvitations(owner,t.id,body,q,key),confirmInvitations(owner,t.id,body,q,key)]);
  assert.deepEqual(results.map(r=>r.status),[201,201]);assert.deepEqual(results[0].data,results[1].data);
  const members=(await pool.query('SELECT * FROM memberships WHERE tenant_id=$1 ORDER BY email',[t.id])).rows;
  assert.equal(members.length,3);assert.ok(members.every(m=>!m.product_enabled));assert.equal(members.find(m=>m.email===owner.email).role,'owner');
  assert.equal((await confirmInvitations(owner,t.id,{...body,enabled:true},q,key)).status,409);
  const all=await invitationQuote(owner,t.id,body);assert.equal(all.blocked,'no_new_members');
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1',[t.id])).rows[0].n,0);
});

test('immediate bulk connection rejects insufficient funds without invitations, then charges only selected new employees',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com');
  const t=await tenant(op,owner.email,{}, {paidOwner:false});
  const body={emails:['a@example.com','b@example.com'],role:'member',enabled:true};
  let q=await invitationQuote(owner,t.id,body);assert.equal(q.total_cents,2000);assert.equal(q.blocked,'insufficient_balance');
  assert.equal((await confirmInvitations(owner,t.id,body,q)).status,402);
  assert.equal((await pool.query('SELECT count(*)::int n FROM memberships WHERE tenant_id=$1',[t.id])).rows[0].n,1);
  await call(`/api/tenants/${t.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:2000,reason:'Test payment',idempotency_key:randomUUID()}});
  assert.equal((await confirmInvitations(owner,t.id,body,q)).data.error.code,'access_quote_changed');
  q=await invitationQuote(owner,t.id,body);assert.equal(q.total_cents,1000);
  const key=randomUUID();assert.equal((await confirmInvitations(owner,t.id,body,q,key)).status,201);
  assert.equal((await confirmInvitations(owner,t.id,body,q,key)).data.charged_cents,1000);
  const members=(await pool.query('SELECT email,product_enabled FROM memberships WHERE tenant_id=$1',[t.id])).rows;
  assert.equal(members.filter(m=>m.product_enabled).length,2);assert.equal(members.find(m=>m.email===owner.email).product_enabled,false);
  assert.equal(Number((await pool.query('SELECT balance_cents FROM tenant_wallets WHERE tenant_id=$1',[t.id])).rows[0].balance_cents),0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM seat_charges WHERE tenant_id=$1',[t.id])).rows[0].n,2);
});

test('bulk invitation authorization, validation, stale prices and capacity cannot bypass confirmed billing',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('owner@example.com'),admin=await actor('admin@example.com'),stranger=await actor('stranger@example.com');
  const t=await tenant(op,owner.email,{seats:2});
  await call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:admin.email,role:'admin'}});
  const path=`/api/tenants/${t.id}/invitations/quote`, body={emails:['a@example.com'],role:'member',enabled:true};
  assert.equal((await call(path,{actor:stranger,method:'POST',body})).status,403);
  assert.equal((await call(path,{actor:admin,method:'POST',body:{...body,role:'owner'}})).status,403);
  for(const emails of [[],['bad'],Array(201).fill('a@example.com')])assert.equal((await call(path,{actor:owner,method:'POST',body:{...body,emails}})).status,422);
  const hidden=await invitationQuote(admin,t.id,body);assert.equal(hidden.balance_cents,null);assert.equal(hidden.can_manage_balance,false);
  let q=await invitationQuote(owner,t.id,body);
  await pool.query('UPDATE billing_settings SET unit_price_cents=600');
  assert.equal((await confirmInvitations(owner,t.id,body,q)).data.error.code,'access_quote_changed');
  q=await invitationQuote(owner,t.id,{...body,emails:['a@example.com','b@example.com']});assert.equal(q.blocked,'seats_full');
  assert.equal((await confirmInvitations(owner,t.id,{...body,emails:['a@example.com','b@example.com']},q)).status,409);
  q=await invitationQuote(owner,t.id,body);
  const other={...body,emails:['b@example.com']},otherQuote=await invitationQuote(owner,t.id,other);
  const results=await Promise.all([confirmInvitations(owner,t.id,body,q),confirmInvitations(owner,t.id,other,otherQuote)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
});

test('Plus languages are a live plan policy for existing subscribers and device requests; Business stays independent',async()=>{
  const op=await actor('operator@example.com'),owner=await actor('policy@example.com'),stranger=await actor('stranger@example.com');
  await enablePlans(op);const plus=await selfWorkspace(owner),business=await selfWorkspace(owner,'business');
  await call(`/api/tenants/${plus.id}/balance`,{actor:op,method:'POST',body:{operation:'credit',amount_cents:500,reason:'Activate Plus',idempotency_key:randomUUID()}});
  const policy={...planDefaults,seats:1,languages:['en','ru','bn','hi','zh','es','fr','ar','pt','id']};
  assert.equal((await call('/api/plan-defaults/plus',{actor:op,method:'PUT',body:policy})).status,200);
  let profile=(await call('/api/me',{actor:owner})).data;
  assert.deepEqual(profile.tenants.find(t=>t.id===plus.id).languages,policy.languages);
  assert.deepEqual(profile.tenants.find(t=>t.id===business.id).languages,['en','ru']);
  assert.deepEqual((await call(`/api/tenants/${plus.id}`,{actor:owner})).data.tenant.languages,policy.languages);
  const endpoint=`/api/tenants/${plus.id}/language-policy`;
  assert.equal((await call(endpoint,{actor:stranger})).status,403);
  assert.deepEqual((await call(endpoint,{actor:owner})).data,{tenant_id:plus.id,languages:policy.languages});
  const verifier='f'.repeat(64);
  const device=(await call('/api/device/start',{method:'POST',body:{challenge:hash(verifier)}})).data;
  assert.equal((await call(`/api/device/${device.id}/approve`,{actor:owner,method:'POST',body:{code:device.code}})).status,200);
  const grant=(await call('/api/device/poll',{method:'POST',body:{id:device.id,poll_token:device.poll_token,verifier}})).data;
  assert.deepEqual((await call(endpoint,{headers:{Authorization:`Bearer ${grant.token}`}})).data.languages,policy.languages);
  const request=target=>call('/api/translate',{actor:owner,method:'POST',body:{tenant_id:plus.id,request_id:randomUUID(),text:'Hello',source:'en',target}});
  assert.equal((await request('bn')).status,200);
  assert.equal((await call('/api/plan-defaults/plus',{actor:op,method:'PUT',body:{...policy,languages:['en','ru']}})).status,200);
  const before=upstreamCalls.length,denied=await request('bn');
  assert.equal(denied.status,422);assert.equal(denied.data.error.code,'language_not_allowed');
  assert.equal(denied.data.error.params.settings_url,'artype://settings/languages');assert.equal(upstreamCalls.length,before);
  assert.deepEqual((await call(endpoint,{actor:owner})).data.languages,['en','ru']);
  assert.equal((await call(`/api/tenants/${plus.id}`,{actor:op,method:'PATCH',body:{languages:['en','fr']}})).status,409);
});
