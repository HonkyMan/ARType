export function loadConfig(env=process.env) {
  const origin=new URL(env.PUBLIC_URL || 'http://127.0.0.1:8080');
  const local=['127.0.0.1','localhost','[::1]'].includes(origin.hostname);
  if(origin.protocol!=='https:' && !local)throw new Error('PUBLIC_URL requires HTTPS');
  if(origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)throw new Error('PUBLIC_URL must be an origin without a path or credentials');
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  const providerBaseURL=env.PROVIDER_BASE_URL || 'https://openrouter.ai/api/v1';
  const p=new URL(providerBaseURL);
  if(p.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(p.hostname))throw new Error('Provider URL requires HTTPS');
  const providerKeys=JSON.parse(env.PROVIDER_KEYS || '{}');
  if(!providerKeys || Array.isArray(providerKeys) || typeof providerKeys!=='object' || Object.values(providerKeys).some(v=>typeof v!=='string'))throw new Error('PROVIDER_KEYS must be a JSON object of credential aliases to keys');
  if(env.CREDENTIAL_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_ENCRYPTION_KEY))throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain 32 random bytes as 64 hex characters');
  return {origin:origin.origin,secure:origin.protocol==='https:',databaseURL:env.DATABASE_URL,
    adminEmails:(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),
    googleClientId:env.GOOGLE_CLIENT_ID||'',googleClientSecret:env.GOOGLE_CLIENT_SECRET||'',
    credentialEncryptionKey:env.CREDENTIAL_ENCRYPTION_KEY||'',defaultModel:env.DEFAULT_MODEL||'',
    providerBaseURL:providerBaseURL.replace(/\/$/,''),providerKeys,port:Number(env.PORT||8080),trustProxy:env.TRUST_PROXY==='1'};
}
