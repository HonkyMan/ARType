import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const script=new URL('../publish-downloads.mjs',import.meta.url);
test('publisher copies installers with matching hashes and rejects non-HTTP localhost origins',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artype-publish-'));
  try{
    const source=join(root,'ARType-test.dmg'),out=join(root,'releases');await writeFile(source,'installer-fixture');
    const args=[fileURLToPath(script),'--macos',source,'--out',out,'--version','test','--signing','unsigned-validation','--service-url'];
    const bad=spawnSync(process.execPath,[...args,'ftp://127.0.0.1'],{encoding:'utf8'});assert.notEqual(bad.status,0);
    const good=spawnSync(process.execPath,[...args,'http://127.0.0.1:8080'],{encoding:'utf8'});assert.equal(good.status,0,good.stderr);
    const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
    assert.equal(manifest.files[0].platform,'macos-arm64');
    assert.equal(manifest.files[0].sha256,createHash('sha256').update(await readFile(source)).digest('hex'));
    assert.equal(await readFile(join(out,'ARType-test.dmg'),'utf8'),'installer-fixture');
  }finally{await rm(root,{recursive:true,force:true})}
});
