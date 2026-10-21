#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,copyFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';

const {values}=parseArgs({options:{macos:{type:'string'},windows:{type:'string'},out:{type:'string',default:'releases'},version:{type:'string'},'service-url':{type:'string'},signing:{type:'string'}}});
if(!values.version||!values['service-url']||!['signed','unsigned-validation'].includes(values.signing)||!values.macos&&!values.windows)
  throw new Error('Use --macos FILE and/or --windows FILE --version VERSION --service-url URL --signing signed|unsigned-validation [--out releases]');
const service=new URL(values['service-url']);
if(service.username||service.password||service.search||service.hash||service.pathname!=='/'||service.protocol!=='https:'&&!(service.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(service.hostname)))
  throw new Error('Service URL must be an HTTPS origin, or localhost for a pilot build');
const out=resolve(values.out);await mkdir(out,{recursive:true});
const files=[];
for(const [option,platform,extension] of [['macos','macos-arm64','.dmg'],['windows','windows-x64','.exe']]){
  if(!values[option])continue;
  const source=resolve(values[option]),filename=basename(source);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(dmg|exe)$/.test(filename)||!filename.endsWith(extension))throw new Error('Invalid installer filename');
  const destination=resolve(out,filename);
  if(source!==destination){await copyFile(source,destination+'.tmp');await rename(destination+'.tmp',destination)}
  const hash=createHash('sha256');for await(const chunk of createReadStream(destination))hash.update(chunk);
  files.push({filename,platform,version:values.version,signing:values.signing,sha256:hash.digest('hex'),size_bytes:(await stat(destination)).size,service_url:service.origin});
}
await writeFile(resolve(out,'manifest.json.tmp'),JSON.stringify({files},null,2)+'\n');
await rename(resolve(out,'manifest.json.tmp'),resolve(out,'manifest.json'));
console.log(`Published ${files.length} installers to ${out}`);
