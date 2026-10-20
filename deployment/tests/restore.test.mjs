import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

function runRestore(t,failure=''){
  const root=mkdtempSync(join(tmpdir(),'artype-restore-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'deployment'));mkdirSync(join(root,'bin'));
  const script=join(root,'deployment/restore.sh');copyFileSync(resolve(import.meta.dirname,'../restore.sh'),script);
  const backup=join(root,'backup.dump');writeFileSync(backup,'synthetic fixture');
  const trace=join(root,'trace');
  writeFileSync(join(root,'bin/docker'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$ARTYPE_TEST_TRACE"
if [[ "$*" = 'compose ps --services --filter status=running' ]]; then
  if [[ "$ARTYPE_TEST_FAILURE" = inventory ]]; then exit 42; fi
  printf 'api\\n';exit 0
fi
if [[ "$1 $2 $3" = 'compose stop api' && "$ARTYPE_TEST_FAILURE" = stop ]]; then exit 43; fi
exit 0
`,{mode:0o755});
  const result=spawnSync('bash',[script,backup,'--replace-database'],{encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,ARTYPE_TEST_TRACE:trace,ARTYPE_TEST_FAILURE:failure}});
  return {result,trace:readFileSync(trace,'utf8')};
}
test('restore aborts before destructive work if service inventory fails',t=>{
  const {result,trace}=runRestore(t,'inventory');assert.notEqual(result.status,0);assert.ok(!trace.includes('pg_restore'));
});
test('restore aborts if API could not be stopped',t=>{
  const {result,trace}=runRestore(t,'stop');assert.notEqual(result.status,0);assert.ok(!trace.includes('pg_restore'));
});
test('local restore stops and resumes only the running API around pg_restore',t=>{
  const {result,trace}=runRestore(t);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(trace.trim().split('\n'),['compose ps --services --filter status=running','compose stop api','compose exec -T db sh -c exec pg_restore -U artype --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction','compose up -d api']);
});
