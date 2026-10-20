import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {catalogs,detectLocale,setLocale,getLocale,t,translate} from '../public/modules/i18n.js';
import {money,roles,esc} from '../public/modules/format.js';
import {createState} from '../public/modules/state.js';
import {createPlatformViews} from '../public/modules/views/platform.js';
import {createTenantViews} from '../public/modules/views/tenants.js';
import {createWorkspaceViews} from '../public/modules/views/workspaces.js';
import {createHelpViews} from '../public/modules/views/help.js';
import {requestLocale,errorText} from '../src/localization.js';
import {validationMessage} from '../public/modules/validation.js';
const storage = {setItem(){}};
afterEach(()=>setLocale('en',storage));

test('browser language detection honors a saved choice and falls back to English',()=>{
  assert.equal(detectLocale(['ru-RU','en']),'ru');
  assert.equal(detectLocale(['de-DE','en-US']),'en');
  assert.equal(detectLocale(['zh-CN']),'en');
  assert.equal(detectLocale(['en-US'],'ru'),'ru');
  assert.equal(detectLocale(['ru-RU'],'invalid'),'ru');
  assert.equal(detectLocale([]),'en');
});
test('both dictionaries cover every message and interpolation token',async()=>{
  assert.deepEqual(Object.keys(catalogs.ru).sort(),Object.keys(catalogs.en).sort());
  for(const [key,text] of Object.entries(catalogs.en)){
    assert.ok(text && catalogs.ru[key]);
    const placeholders=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
    assert.deepEqual(placeholders(text),placeholders(catalogs.ru[key]),key);
  }
  const root=new URL('../public/modules/',import.meta.url);
  for(const file of await readdir(root,{recursive:true})){
    if(!file.endsWith('.js')||file.startsWith('locales/'))continue;
    const source=await readFile(new URL(file,root),'utf8');
    for(const match of source.matchAll(/\b(?:t|tr)\('([^']+)'/g))assert.ok(catalogs.en[match[1]],`${file}: ${match[1]}`);
  }
});
test('a language change updates labels, money, validation and storage without changing user content',()=>{
  const saved={};setLocale('ru',{setItem(k,v){saved[k]=v;}});
  assert.equal(saved['artype.language'],'ru');assert.equal(roles.owner,'Владелец организации');
  const russian=money(12345);assert.match(russian,/123,45/);
  assert.equal(validationMessage({validity:{valueMissing:true}}),'Заполните это поле.');
  setLocale('en',storage);assert.equal(roles.owner,'Workspace owner');assert.equal(money(12345),'$123.45');
  assert.match(t('search_result_count',{visible:2,total:5}),/Found 2 of 5/);
  assert.equal(translate('unsupported','save_changes'),'Save changes');
  assert.equal(setLocale('ru',{setItem(){throw Error('blocked')}}),false);assert.equal(getLocale(),'ru');
});
test('HTTP locale honors explicit preference, weighted browser languages and English fallback',()=>{
  assert.equal(requestLocale({headers:{'accept-language':'de;q=1,ru;q=0.4,en;q=0.9'}}),'en');
  assert.equal(requestLocale({headers:{cookie:'artype_language=ru', 'accept-language':'en'}}),'ru');
  assert.equal(requestLocale({headers:{'accept-language':'ru;q=0,ja'}}),'en');
  assert.equal(errorText('text_too_long','en',{limit:5000}),'The maximum text length is 5000 characters.');
  assert.match(errorText('payment_mismatch','ru'),/Сумма или валюта/);
});
test('all principal views render in both languages and preserve escaped workspace names',()=>{
  for(const locale of ['en','ru']){
    setLocale(locale,storage);
    let html='';const shell=(content,title,description,actions)=>{html=[content,esc(title),esc(description),actions || ''].join(' ')};
    const state=createState();
    state.me={operator:true,user:{name:'Alice',email:'alice@example.com'},tenants:[]};
    state.organizations=[];state.connections=[{alias:'main',base_url:'https://example.com/v1',default_model:'model'}];
    state.credentials=['main'];
    const prices={unit_price_cents:500,plus_price_cents:500,business_price_cents:1000,defaults:[{plan:'plus',credential:'main',model:'model',seats:1,monthly_characters:10000,languages:['en'],registration_enabled:true}]};
    const p=createPlatformViews({state,shell});
    const tenant={id:'A',plan:'business',name:'<img src=x> Alpha',role:'owner',status:'active',seats:10,languages:['en'],credential:'main',model:'model',monthly_characters:10000,max_text:5000,rpm:60,concurrency:8,instructions:''};
    const billing={balance_cents:0,base_price_cents:1000,unit_price_cents:500,period:'2026-10-01',required_cents:1500,missing_cents:1500,pending_seats:1,entries:[],orders:[{id:'P',status:'pending',amount_cents:1500,created_at:'2026-10-01T00:00:00Z'}]};
    state.details={tenant,members:[{id:'M',email:'member@example.com',role:'member',status:'active',app_status:'awaiting_payment'}],billing,usage:{},recent:[]};
    const v=createTenantViews({state,shell});
    const renders=[()=>p.pricing(prices),()=>p.dashboard({tenants:[],period:'2026-10-01'}),()=>p.provider({credentials:state.connections}),()=>p.providerEditor({credentials:state.connections,can_manage:true},'main'),()=>p.admins({administrators:[]}),()=>v.home(),()=>v.newTenant(),...['team','billing','usage','settings','translation'].map(section=>()=>{state.section=section;v.renderTenant();}),()=>createWorkspaceViews({state,shell}).onboarding({plans:[{plan:'plus',price_cents:500,registration_enabled:true},{plan:'business',price_cents:1000,seat_price_cents:500,registration_enabled:true}]}),()=>{html=createHelpViews({state,location:{origin:'http://localhost'}}).helpContent()}];
    for(const render of renders){render();assert.ok(html.length>100);assert.doesNotMatch(html,/<img src=x>/);assert.doesNotMatch(html,/undefined|NaN/);if(locale==='en')assert.doesNotMatch(html.replaceAll('Русский',''),/[А-Яа-яЁё]/);}
  }
});
