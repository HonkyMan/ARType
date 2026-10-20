import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { activateMemberships, fail, transaction, uid } from './store.js';

export const hash=s=>createHash('sha256').update(s).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
const same=(a,b)=>typeof a==='string' && typeof b==='string' && timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2));
function cookie(res,name,value,config,maxAge) {
  res.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure?'; Secure':''}`);
}
export function makeGoogle(config) {
  const client=new OAuth2Client(config.googleClientId,config.googleClientSecret,config.origin+'/auth/google/callback');
  return {
    authorizationURL:({state,nonce,verifier})=>client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}),
    exchange:async(code,verifier)=>{
      const {tokens}=await client.getToken({code,codeVerifier:verifier});
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:config.googleClientId});
      return ticket.getPayload();
    }
  };
}
export async function issueSession(c,userId,kind) {
  const token=secret(),csrf=secret();
  await c.query('INSERT INTO sessions(token_hash,user_id,csrf,kind,expires_at) VALUES($1,$2,$3,$4,now()+$5::interval)',
    [hash(token),userId,csrf,kind,kind==='desktop'?'30 days':'7 days']);
  return {token,csrf};
}
export function authMiddleware(pool,config) {
  return async(req,res,next)=>{
    const bearer=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
    const token=bearer || cookies(req).artype_session;
    if(!token)fail(401,'sign_in_required','Войдите в ARType.');
    const session=(await pool.query(`SELECT s.*,u.id,u.email,u.name,
      EXISTS(SELECT 1 FROM platform_admins a WHERE a.email=u.email) AS platform_admin FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE token_hash=$1 AND expires_at>now()`,[hash(token)])).rows[0];
    if(!session || (bearer && session.kind!=='desktop'))fail(401,'session_expired','Сессия истекла. Войдите снова.');
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && !bearer) {
      if(req.headers.origin!==config.origin || !same(req.headers['x-csrf-token'],session.csrf))fail(403,'csrf','Обновите страницу и повторите действие.');
    }
    req.user={id:session.user_id,email:session.email,name:session.name,platform_admin:session.platform_admin}; req.session=session; next();
  };
}
export function installAuth(app,{pool,config,google,validate,z}) {
  app.get('/auth/status',(req,res)=>res.json({configured:!!(config.googleClientId && config.googleClientSecret)}));
  app.get('/auth/google',async(req,res)=>{
    if(!config.googleClientId || !config.googleClientSecret)fail(503,'google_not_configured','Google-вход ещё не настроен. Администратору нужно задать GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.');
    let device=null;
    if(req.query.device){device=validate(z.string().uuid(),req.query.device);if(!(await pool.query('SELECT id FROM devices WHERE id=$1 AND expires_at>now() AND NOT consumed',[device])).rowCount)fail(410,'device_expired','Вход устарел. Начните вход в приложении снова.');}
    const state=secret(),browser=secret(),nonce=secret(),verifier=secret();
    await pool.query("INSERT INTO oauth_states(state_hash,cookie_hash,nonce,verifier,device_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",[hash(state),hash(browser),nonce,verifier,device]);
    cookie(res,'artype_oauth',browser,config,600);
    res.redirect(google.authorizationURL({state,nonce,verifier}));
  });
  app.get('/auth/google/callback',async(req,res)=>{
    const state=validate(z.string().min(20).max(200),req.query.state);
    const browser=cookies(req).artype_oauth;
    if(!browser)fail(400,'oauth_state','Браузерная сессия входа отсутствует. Начните вход снова.');
    const row=(await pool.query('DELETE FROM oauth_states WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *',[hash(state),hash(browser)])).rows[0];
    if(!row)fail(400,'oauth_state','Ссылка входа истекла или уже использована.');
    cookie(res,'artype_oauth','',config,0);
    if(req.query.error)fail(400,'oauth_cancelled','Вход Google отменён. Начните вход снова.');
    const code=validate(z.string().min(1).max(4096),req.query.code);
    let claims;
    try{claims=await google.exchange(code,row.verifier)}catch{fail(400,'oauth_failed','Не удалось подтвердить вход Google. Начните вход снова.');}
    if(!claims || !same(claims.nonce,row.nonce) || claims.email_verified!==true || typeof claims.sub!=='string' || !claims.sub || typeof claims.email!=='string')fail(400,'oauth_identity','Google не подтвердил личность и email.');
    const email=validate(z.email().max(254),claims.email.toLowerCase());
    const session=await transaction(pool,async c=>{
      for(const key of [`email:${email}`,`sub:${claims.sub}`].sort())await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
      const existing=(await c.query('SELECT id,sub FROM users WHERE email=$1 OR sub=$2 FOR UPDATE',[email,claims.sub])).rows;
      if(existing.some(u=>u.sub!==claims.sub))fail(403,'identity_conflict','Email связан с другой учётной записью. Обратитесь к администратору.');
      const id=existing[0]?.id || uid();
      const actual=(await c.query('INSERT INTO users(id,sub,email,name) VALUES($1,$2,$3,$4) ON CONFLICT(sub) DO UPDATE SET email=$3,name=$4 RETURNING id',[id,claims.sub,email,String(claims.name||email).slice(0,200)])).rows[0].id;
      await activateMemberships(c,email);
      return issueSession(c,actual,'web');
    });
    cookie(res,'artype_session',session.token,config,604800);
    res.redirect(row.device_id?`/?device=${row.device_id}`:'/');
  });
  app.post('/api/device/start',async(req,res)=>{
    const {challenge}=validate(z.object({challenge:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),req.body);
    const id=uid(),poll=secret(),code=randomBytes(3).toString('hex').toUpperCase();
    await pool.query("INSERT INTO devices(id,poll_hash,challenge,code,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",[id,hash(poll),challenge,code]);
    res.json({id,poll_token:poll,code,expires_in:300,interval:3,login_url:config.origin+'/auth/google?device='+id});
  });
  app.post('/api/device/poll',async(req,res)=>{
    const b=validate(z.object({id:z.string().uuid(),poll_token:z.string().min(20).max(200),verifier:z.string().min(32).max(128)}).strict(),req.body);
    const result=await transaction(pool,async c=>{
      const d=(await c.query('SELECT * FROM devices WHERE id=$1 FOR UPDATE',[b.id])).rows[0];
      if(!d || d.consumed || new Date(d.expires_at)<=new Date())fail(410,'device_expired','Вход истёк. Начните снова.');
      if(!same(d.poll_hash,hash(b.poll_token)) || !same(d.challenge,hash(b.verifier)))fail(403,'device_secret','Неверное подтверждение устройства.');
      if(!d.user_id)return null;
      await c.query('UPDATE devices SET consumed=true WHERE id=$1',[d.id]);
      return issueSession(c,d.user_id,'desktop');
    });
    res.status(result?200:202).json(result?{token:result.token,expires_in:2592000}:{status:'pending'});
  });
  const auth=authMiddleware(pool,config);
  app.get('/api/device/:id',auth,async(req,res)=>{
    const id=validate(z.string().uuid(),req.params.id);
    const d=(await pool.query('SELECT code FROM devices WHERE id=$1 AND expires_at>now() AND NOT consumed',[id])).rows[0];
    if(!d)fail(410,'device_expired','Вход устарел.');res.json(d);
  });
  app.post('/api/device/:id/approve',auth,async(req,res)=>{
    const id=validate(z.string().uuid(),req.params.id);
    const code=validate(z.string().max(20),req.body?.code);
    const r=await pool.query('UPDATE devices SET user_id=$1 WHERE id=$2 AND code=$3 AND expires_at>now() AND user_id IS NULL AND NOT consumed',[req.user.id,id,code]);
    if(!r.rowCount)fail(403,'device_code','Код не совпадает или запрос уже подтверждён.');res.json({ok:true});
  });
  app.post('/api/logout',auth,async(req,res)=>{
    await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.session.token_hash]);cookie(res,'artype_session','',config,0);res.json({ok:true});
  });
  return auth;
}
