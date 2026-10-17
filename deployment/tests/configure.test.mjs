import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=resolve(import.meta.dirname,'../configure.mjs');
function fixture(t,client={web:{client_id:'test.apps.googleusercontent.com',client_secret:'fake-secret-for-test'}}){
  const directory=mkdtempSync(join(tmpdir(),'artype-config-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const google=join(directory,'google.json');writeFileSync(google,JSON.stringify(client));
  const run=(extra=[])=>spawnSync(process.execPath,[script,'--directory',directory,'--google-json',google,'--admin-email','Owner@Example.com',...extra],{encoding:'utf8'});
  return {directory,google,run};
}

test('imports web OAuth into private local configuration without printing secrets or overwriting it',t=>{
  const f=fixture(t);const result=f.run();assert.equal(result.status,0,result.stderr);
  const path=join(f.directory,'.env');const env=readFileSync(path,'utf8');
  assert.equal(statSync(path).mode&0o777,0o600);
  assert.match(env,/COMPOSE_FILE="compose.local.yaml"/);
  assert.match(env,/ADMIN_EMAILS="owner@example.com"/);
  assert.match(env,/POSTGRES_PASSWORD="[a-f0-9]{64}"/);
  assert.match(env,/GOOGLE_CLIENT_SECRET="fake-secret-for-test"/);
  assert.match(result.stdout,/http:\/\/127\.0\.0\.1:8080\/auth\/google\/callback/);
  assert.match(result.stdout,/Google Cloud/);
  assert.ok(!result.stdout.includes('fake-secret-for-test'));
  const second=f.run();assert.notEqual(second.status,0);assert.equal(readFileSync(path,'utf8'),env);
});

test('generates domain configuration and reads provider key from a file',t=>{
  const f=fixture(t);const key=join(f.directory,'provider-key');writeFileSync(key,'fake-provider-key\n');
  const result=f.run(['--domain','translate.example.org','--provider-key-file',key]);assert.equal(result.status,0,result.stderr);
  const env=readFileSync(join(f.directory,'.env'),'utf8');
  assert.match(env,/COMPOSE_FILE="compose.yaml"/);assert.match(env,/DOMAIN="translate.example.org"/);
  assert.match(env,/PROVIDER_KEYS="\{\\"main\\":\\"fake-provider-key\\"\}"/);
  assert.match(result.stdout,/https:\/\/translate.example.org\/auth\/google\/callback/);
  assert.ok(!result.stdout.includes('fake-provider-key'));
});

test('rejects installed client, malformed JSON and unsafe input without creating configuration',t=>{
  const f=fixture(t,{installed:{client_id:'test',client_secret:'must-not-leak'}});
  for(const content of [JSON.stringify({installed:{client_id:'test',client_secret:'must-not-leak'}}),'{"secret":"must-not-leak"']){
    writeFileSync(f.google,content);const result=f.run();assert.notEqual(result.status,0);
    assert.ok(!existsSync(join(f.directory,'.env')));assert.ok(!result.stderr.includes('must-not-leak'));
  }
  writeFileSync(f.google,JSON.stringify({web:{client_id:'test',client_secret:'test'}}));
  for(const args of [['--admin-email','bad\nINJECT=value'],['--domain','127.0.0.1'],['--domain','example.org/path'],['--port','0'],['--provider-url','http://external.example.org']]){
    const result=f.run(args);assert.notEqual(result.status,0);assert.ok(!existsSync(join(f.directory,'.env')));
  }
});
