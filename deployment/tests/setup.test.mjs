import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Docker setup help works with the system Bash even without credential mounts',t=>{
  const root=mkdtempSync(join(tmpdir(),'artype-setup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'deployment'));mkdirSync(join(root,'bin'));
  const script=join(root,'deployment/setup.sh');copyFileSync(resolve(import.meta.dirname,'../setup.sh'),script);
  writeFileSync(join(root,'bin/docker'),'#!/bin/sh\nprintf "docker-help-route\\n"\n',{mode:0o755});
  const result=spawnSync('/bin/bash',[script,'--help'],{encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/docker-help-route/);
});
