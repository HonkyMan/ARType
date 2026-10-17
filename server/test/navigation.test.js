import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

test('slower previous tenant response cannot replace a newer tenant form',async()=>{
  const root={innerHTML:'',addEventListener(){}};
  const context=vm.createContext({document:{querySelector:()=>root},fetch:()=>new Promise(()=>{}),setTimeout,location:{search:''},URLSearchParams,console});
  vm.runInContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  vm.runInContext(`me={operator:true,tenants:[{id:'A',role:'owner'},{id:'B',role:'owner'}]};
    globalThis.waiters={};globalThis.renders=[];
    api=path=>new Promise(r=>waiters[path]=r);
    shell=()=>{rootRemoved=true};
    renderTenant=()=>renders.push({target:current,display:details.tenant.id});
    globalThis.a=openTenant('A');globalThis.b=openTenant('B');`,context);
  vm.runInContext("waiters['/api/tenants/B']({tenant:{id:'B'}})",context);await context.b;
  vm.runInContext("waiters['/api/tenants/A']({tenant:{id:'A'}})",context);await context.a;
  assert.deepEqual(JSON.parse(JSON.stringify(context.renders)),[{target:'B',display:'B'}]);
  assert.ok(context.rootRemoved,'old form is removed synchronously while a new tenant is loading');
});
