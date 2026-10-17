import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const fail=(status,code,message)=>{throw new HttpError(status,code,message)};
export const uid=()=>randomUUID();
export async function transaction(pool, fn) {
  const c=await pool.connect();
  try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function migrate(pool) {
  const c=await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(63821017)');
    await c.query(`
      CREATE TABLE IF NOT EXISTS schema_versions(version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, sub text NOT NULL UNIQUE, email text NOT NULL UNIQUE, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS tenants(
        id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
        seats int NOT NULL DEFAULT 10 CHECK(seats BETWEEN 1 AND 100000),
        monthly_characters bigint NOT NULL DEFAULT 1000000 CHECK(monthly_characters BETWEEN 1 AND 1000000000000),
        max_text int NOT NULL DEFAULT 5000 CHECK(max_text BETWEEN 1 AND 20000),
        rpm int NOT NULL DEFAULT 60 CHECK(rpm BETWEEN 1 AND 10000),
        concurrency int NOT NULL DEFAULT 8 CHECK(concurrency BETWEEN 1 AND 500),
        model text NOT NULL, credential text NOT NULL, instructions text NOT NULL DEFAULT '',
        languages jsonb NOT NULL DEFAULT '["ru","en"]', access_until timestamptz, revision int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS memberships(
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL,
        role text NOT NULL CHECK(role IN ('owner','admin','member')),
        status text NOT NULL CHECK(status IN ('invited','active','disabled')),
        expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
        UNIQUE(tenant_id,email));
      CREATE TABLE IF NOT EXISTS sessions(
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL,
        kind text NOT NULL CHECK(kind IN ('web','desktop')), expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS oauth_states(
        state_hash text PRIMARY KEY, cookie_hash text NOT NULL, nonce text NOT NULL,
        verifier text NOT NULL, device_id uuid, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(
        id uuid PRIMARY KEY, poll_hash text NOT NULL, challenge text NOT NULL, code text NOT NULL,
        user_id uuid REFERENCES users(id), expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false);
      CREATE TABLE IF NOT EXISTS usage(
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
        request_id uuid NOT NULL, characters int NOT NULL CHECK(characters>0),
        status text NOT NULL CHECK(status IN ('pending','success','failed')),
        input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0, duration_ms int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS usage_tenant_time ON usage(tenant_id,created_at);
      CREATE INDEX IF NOT EXISTS membership_email ON memberships(email);
      CREATE TABLE IF NOT EXISTS audit(
        id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
        tenant_id uuid, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
    `);
  } finally {await c.query('SELECT pg_advisory_unlock(63821017)');c.release()}
}
export function operator(user,config) {return config.adminEmails.includes(user.email)}
export async function access(c,tenantId,user,config,{manage=false,lock=false}={}) {
  const t=(await c.query(`SELECT * FROM tenants WHERE id=$1 ${lock?'FOR UPDATE':''}`,[tenantId])).rows[0];
  if(!t) fail(403,'no_access','Организация недоступна.');
  const m=(await c.query("SELECT * FROM memberships WHERE tenant_id=$1 AND email=$2 AND (status='active' OR (status='invited' AND expires_at>now()))",[tenantId,user.email])).rows[0];
  if(!operator(user,config) && (!m || (manage && !['owner','admin'].includes(m.role)))) fail(403,'no_access','Недостаточно прав.');
  return {...t,role:operator(user,config)?'operator':m.role};
}
export async function audit(c,user,action,tenantId) {
  await c.query('INSERT INTO audit(id,actor_id,action,tenant_id) VALUES($1,$2,$3,$4)',[uid(),user.id,action,tenantId]);
}
export async function reserve(pool,user,body,config) {
  return transaction(pool,async c=>{
    const t=await access(c,body.tenant_id,user,config,{lock:true});
    if(t.status!=='active' || (t.access_until && new Date(t.access_until)<=new Date())) fail(403,'tenant_inactive','Доступ организации приостановлен или истёк. Обратитесь к администратору.');
    const n=Array.from(body.text).length;
    if(n>t.max_text) fail(422,'text_too_long',`Максимальная длина текста: ${t.max_text} символов.`);
    if(!t.languages.includes(body.target) || (body.source && !t.languages.includes(body.source))) fail(422,'language_not_allowed','Этот язык не разрешён в организации.');
    if(!config.providerKeys[t.credential]) fail(503,'provider_not_configured','Администратор ещё не подключил провайдера перевода.');
    if((await c.query('SELECT id FROM usage WHERE user_id=$1 AND request_id=$2',[user.id,body.request_id])).rowCount) fail(409,'already_processed','Этот запрос уже обработан. Повторите действие вручную.');
    const sums=(await c.query(`SELECT
      COALESCE(sum(characters) FILTER(WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND (status='success' OR (status='pending' AND created_at>now()-interval '70 seconds'))),0)::bigint AS used,
      count(*) FILTER(WHERE created_at>now()-interval '1 minute')::int AS rpm,
      count(*) FILTER(WHERE status='pending' AND created_at>now()-interval '70 seconds')::int AS pending,
      count(*) FILTER(WHERE user_id=$2 AND status='pending' AND created_at>now()-interval '70 seconds')::int AS personal
      FROM usage WHERE tenant_id=$1`,[t.id,user.id])).rows[0];
    if(Number(sums.used)+n>Number(t.monthly_characters)) fail(429,'monthly_limit','Месячный лимит организации исчерпан.');
    if(sums.rpm>=t.rpm || sums.pending>=t.concurrency || sums.personal>=2) fail(429,'busy','Слишком много запросов. Повторите через минуту.');
    const id=uid();
    await c.query("INSERT INTO usage(id,tenant_id,user_id,request_id,characters,status) VALUES($1,$2,$3,$4,$5,'pending')",[id,t.id,user.id,body.request_id,n]);
    return {id,tenant:t};
  });
}
