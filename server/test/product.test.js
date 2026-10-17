import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { migrate } from '../src/store.js';

const pool = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL});
const origin = 'http://127.0.0.1:43189';
const config = {origin, adminEmails:['operator@example.com'], googleClientId:'test-client', googleClientSecret:'test-secret',
  providerKeys:{main:'server-only-key'}, providerBaseURL:'https://example.com/v1', secure:false};
let server, url, upstreamCalls, upstreamFail, googleClaims;
const claimsByCode=new Map();
const hash = s => createHash('sha256').update(s).digest('hex');
async function actor(email) {
  const id=randomUUID(), token=randomUUID(), csrf=randomUUID();
  await pool.query('INSERT INTO users(id,sub,email,name) VALUES($1,$2,$3,$3)',[id,id,email]);
  await pool.query("INSERT INTO sessions(token_hash,user_id,csrf,kind,expires_at) VALUES($1,$2,$3,'web',now()+interval '1 day')",[hash(token),id,csrf]);
  return {id,token,csrf};
}
async function call(path, {actor:a, method='GET', body, headers={}}={}) {
  const r=await fetch(url+path,{method, headers:{...(a?{Cookie:`artype_session=${a.token}`,'X-CSRF-Token':a.csrf,Origin:origin}:{}),
    ...(body?{'Content-Type':'application/json'}:{}), ...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  let data; const text=await r.text(); try{data=JSON.parse(text)}catch{data=text} return {status:r.status,data,headers:r.headers};
}
async function tenant(op, owner, overrides={}) {
  const r=await call('/api/tenants',{actor:op,method:'POST',body:{name:'Acme',owner_email:owner,model:'test-model',credential:'main',...overrides}});
  assert.equal(r.status,201,JSON.stringify(r.data)); return r.data;
}
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to an isolated PostgreSQL database');
  assert.match(new URL(process.env.TEST_DATABASE_URL).pathname, /_test$/, 'Test database must end in _test');
  await migrate(pool);
  server=createApp({pool,config,google:{authorizationURL:({state})=>`https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange:async(code)=>claimsByCode.get(code)||googleClaims}, translate:async(payload)=>{
      upstreamCalls.push(payload); if(upstreamFail)throw new Error('provider internal secret');
      await new Promise(r=>setTimeout(r,30)); return {text:'Hello world',input_tokens:10,output_tokens:3};
    }}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r)); url=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r)); await pool.end()});
beforeEach(async()=>{await pool.query('TRUNCATE users,tenants,memberships,sessions,oauth_states,devices,usage,audit RESTART IDENTITY CASCADE');upstreamCalls=[];upstreamFail=false;});

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
test('concurrent invitations cannot exceed seats and last owner cannot be removed',async()=>{
  const op=await actor('operator@example.com'), owner=await actor('owner@example.com');
  const t=await tenant(op,'owner@example.com',{seats:2});
  const rs=await Promise.all(['one','two'].map(e=>call(`/api/tenants/${t.id}/members`,{actor:owner,method:'POST',body:{email:`${e}@example.com`,role:'member'}})));
  assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
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
