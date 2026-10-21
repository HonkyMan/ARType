#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {isIP} from 'node:net';
import {randomBytes} from 'node:crypto';

function required(value,message){if(!value)throw new Error(message);return value;}
function text(value,message){return required(typeof value==='string' && value.trim() && !/[\x00-\x1f\x7f]/.test(value) && value,message);}
function quote(value){return JSON.stringify(value).replace(/\$/g,()=> '$$');}
function read(path,message){try{return readFileSync(path,'utf8');}catch{throw new Error(message);}}

try{
  const {values}=parseArgs({options:{
    'google-json':{type:'string'},'admin-email':{type:'string'},domain:{type:'string'},
    port:{type:'string',default:'8080'},'provider-key-file':{type:'string'},
    'provider-url':{type:'string',default:'https://openrouter.ai/api/v1'},model:{type:'string',default:'google/gemma-3-4b-it'},
    directory:{type:'string',default:process.cwd()},help:{type:'boolean'}
  }});
  if(values.help){
    console.log('deployment/setup.sh --google-json FILE --admin-email EMAIL [--domain HOST] [--port 8080] [--provider-key-file FILE] [--provider-url HTTPS_URL] [--model MODEL_ID]');
    process.exit(0);
  }
  const email=text(values['admin-email'],'Specify --admin-email').trim().toLowerCase();
  if(!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))throw new Error('Invalid administrator email');
  const port=Number(values.port);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid local port');
  let domain='';
  if(values.domain){
    const u=new URL(`https://${values.domain}`);
    if(u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||isIP(u.hostname)||!u.hostname.includes('.')||u.hostname==='localhost')throw new Error('Domain must be a DNS hostname without path, port or credentials');
    domain=u.hostname;
  }
  const provider=new URL(values['provider-url']);
  if(provider.protocol!=='https:'||provider.username||provider.password||provider.search||provider.hash)throw new Error('Provider URL must use HTTPS without credentials or query');
  let google;
  const source=read(required(values['google-json'],'Specify --google-json'),'Cannot read Google JSON');
  try{google=JSON.parse(source).web;}catch{throw new Error('Invalid Google JSON');}
  if(!google)throw new Error('Google JSON must contain a Web application client (web)');
  const clientId=text(google.client_id,'Missing Google client ID');
  const clientSecret=text(google.client_secret,'Missing Google client secret');
  let keys={};
  if(values['provider-key-file'])keys={main:text(read(values['provider-key-file'],'Cannot read provider key file').trim(),'Empty or invalid provider key file')};
  const origin=domain?`https://${domain}`:`http://127.0.0.1:${port}`;
  const config={COMPOSE_FILE:domain?'compose.yaml':'compose.local.yaml',DOMAIN:domain,
    PUBLIC_URL:origin,ARTYPE_LOCAL_PORT:String(port),POSTGRES_PASSWORD:randomBytes(32).toString('hex'),
    ADMIN_EMAILS:email,GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:clientSecret,
    PROVIDER_BASE_URL:provider.href.replace(/\/$/,''),PROVIDER_KEYS:JSON.stringify(keys),
    CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),DEFAULT_MODEL:text(values.model,'Invalid model')};
  const content='# Private ARType Docker configuration. Do not commit or share.\n'+Object.entries(config).map(([key,value])=>`${key}=${quote(value)}\n`).join('');
  try{writeFileSync(resolve(values.directory,'.env'),content,{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')throw new Error('.env already exists; nothing changed. Edit it manually to preserve the database password.');throw new Error('Cannot create private .env');}
  console.log(`Created private .env (${domain?'HTTPS domain':'local-only'}). Secrets were not printed.`);
  console.log(`Google Cloud → Clients → Authorized redirect URIs: ${origin}/auth/google/callback`);
  console.log('If consent screen is in Testing, add the administrator to Audience → Test users.');
  console.log(Object.keys(keys).length?'AI provider key imported under alias main.':'AI key is not configured; sign in and save it in the AI provider panel.');
  console.log('Start: docker compose up -d --build');
  console.log(`Open: ${origin}`);
}catch(error){
  console.error(error instanceof TypeError?'Invalid setup URL or option':error.message);
  process.exitCode=1;
}
