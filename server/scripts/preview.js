// Isolated browser QA fixture. Never imported by the production entry point.
import pg from 'pg';
import { createApp } from '../src/app.js';
import { initializeSchema } from '../src/schema.js';
if(process.env.ARTYPE_TEST_PREVIEW!=='1' || !process.env.TEST_DATABASE_URL?.endsWith('/artype_preview'))throw new Error('Use a dedicated artype_preview database and ARTYPE_TEST_PREVIEW=1');
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});await initializeSchema(pool);
const port=Number(process.env.PORT||8081);
const config={origin:`http://localhost:${port}`,secure:false,adminEmails:['operator@artype.test'],googleClientId:'test',googleClientSecret:'test',providerKeys:{main:'fixture-only'},providerBaseURL:'https://openrouter.ai/api/v1',credentialEncryptionKey:'11'.repeat(32),defaultModel:'google/gemma-3-4b-it'};
const previewEmail=process.env.ARTYPE_PREVIEW_EMAIL || 'operator@artype.test';
const google={authorizationURL:({state})=>config.origin+'/auth/google/callback?state='+state+'&code=fixture',exchange:async(code,verifier)=>{
  // The callback consumes state before exchange; retain the nonce when generating the fixture URL.
  return {sub:'preview:'+previewEmail,email:previewEmail,email_verified:true,name:previewEmail.split('@')[0],nonce:nonces.get(verifier)};
}};
const nonces=new Map();const authURL=google.authorizationURL;google.authorizationURL=args=>{nonces.set(args.verifier,args.nonce);return authURL(args)};
createApp({pool,config,google,translate:async()=>({text:'Browser QA translation',input_tokens:5,output_tokens:3})}).listen(port,'127.0.0.1',()=>console.log(`ARType TEST FIXTURE on http://localhost:${port} — simulated Google/provider`));
