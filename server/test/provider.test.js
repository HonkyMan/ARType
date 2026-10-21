import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeTranslator } from '../src/provider.js';

let server,base,mode,received;
before(async()=>{
  server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received={path:req.url,authorization:req.headers.authorization,body:JSON.parse(body)};
    if(mode==='failure'){res.writeHead(429);return res.end('PRIVATE PROVIDER DETAIL');}
    if(mode==='partial'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"choices":[');return res.destroy();}
    if(mode==='redirect'){res.writeHead(302,{Location:'/somewhere'});return res.end();}
    res.writeHead(200,{'Content-Type':'application/json'});
    const tokens = {negative:-1,fractional:1.5,string:'12',overflow:2147483648}[mode] ?? 12;
    const content = {nul:'Hello\u0000world',only_nul:'\u0000',formatting:'Hello\n\tworld'}[mode] ?? 'Hello';
    res.end(JSON.stringify({choices:[{message:{content},finish_reason:mode==='truncated'?'length':mode==='error'?'error':mode==='tools'?'tool_calls':mode==='no_finish'?null:'stop',...(mode==='choice_error'?{error:{message:'failed'}}:{})}],usage:{prompt_tokens:tokens,completion_tokens:4}}));
  }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/v1`;
});
after(async()=>{await new Promise(r=>server.close(r))});
const run=()=>makeTranslator({providerBaseURL:base,providerKeys:{main:'server-key'}})({model:'chosen-model',messages:[{role:'user',content:'Привет'}]},'main');
test('real HTTP adapter sends only server credential and returns validated translation and token metadata',async()=>{
  mode='success';const result=await run();assert.deepEqual(result,{text:'Hello',input_tokens:12,output_tokens:4});
  assert.equal(received.path,'/v1/chat/completions');assert.equal(received.authorization,'Bearer server-key');
  assert.equal(received.body.model,'chosen-model');
});
test('credential resolved from encrypted storage overrides the legacy environment key in HTTP authorization',async()=>{
  mode='success';await makeTranslator({providerBaseURL:base,providerKeys:{main:'old-environment-key'}})({model:'chosen-model',messages:[]},'main','current-database-key');
  assert.equal(received.authorization,'Bearer current-database-key');
  assert.ok(!JSON.stringify(received.body).includes('current-database-key'));
});
test('selected connection URL overrides deployment default in the actual HTTP adapter',async()=>{
  mode='success';await makeTranslator({providerBaseURL:'http://127.0.0.1:1',providerKeys:{}})({model:'tenant-model',messages:[]},'custom','custom-key',base);
  assert.equal(received.path,'/v1/chat/completions');assert.equal(received.authorization,'Bearer custom-key');assert.equal(received.body.model,'tenant-model');
});
test('actual provider failures, redirects, broken bodies and truncated completions never return partial text',async()=>{
  for(const state of ['failure','partial','redirect','truncated','error','tools','no_finish','choice_error']){mode=state;await assert.rejects(run(),state);}
});
test('malformed provider accounting metadata is rejected before persistence', async () => {
  for (const state of ['negative', 'fractional', 'string', 'overflow']) {
    mode = state;
    await assert.rejects(run(), state);
  }
});
test('decoded NUL cannot reach native clipboard while ordinary formatting is preserved', async () => {
  for (const state of ['nul', 'only_nul']) {
    mode = state;
    await assert.rejects(run(), /Incomplete translation/);
  }
  mode = 'formatting';
  assert.equal((await run()).text, 'Hello\n\tworld');
});
