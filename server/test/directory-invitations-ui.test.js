import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {emailTokens,validEmail,emailTagsMarkup} from '../public/modules/email-tags.js';
import {email} from '../src/schemas.js';
import {createUserViews} from '../public/modules/views/users.js';
import {accessConfirmation} from '../public/modules/access-dialog.js';
import {setLocale} from '../public/modules/i18n.js';
const storage={setItem(){}};
afterEach(()=>setLocale('en',storage));
test('email tags handle list delimiters, normalize casing and mark invalid text without injecting markup',()=>{
 assert.deepEqual(emailTokens(' ONE@example.com,Two@example.com\tthree@example.com\nfour@example.com;five@example.com '),['one@example.com','two@example.com','three@example.com','four@example.com','five@example.com']);
 for(const value of ['name+tag@example.com','a.b@example.co.uk','bad','a..b@example.com','.a@example.com','a@','a@example','a@example.c'])assert.equal(validEmail(value),email.safeParse(value).success,value);
 const html=emailTagsMarkup(['a@example.com','<img src=x>']);assert.match(html,/email-tag invalid/);assert.doesNotMatch(html,/<img src=x>/);
});
test('directory renders both checkmarks, invitation state, search and bounded pagination in both languages',()=>{
 for(const locale of ['ru','en']) {
  setLocale(locale,storage);let html;
  createUserViews({shell:content=>html=content}).users({page:1,page_size:50,total:1000,users:[{email:'a@example.com',name:'<img src=x>',registered:true,personal:true,business:true,business_count:2,personal_tenant_id:'P'},{email:'invited@example.com',registered:false,personal:false,business:true,business_count:1}]},{q:'a"<',type:'all'});
  assert.equal((html.match(/plan-check present/g)||[]).length,3);assert.match(html,/data-users-page="2"/);assert.match(html,/data-tenant="P"/);assert.doesNotMatch(html,/<img src=x>|undefined|NaN/);
 }
});
test('invitation quote distinguishes free invitation from disconnection and explains skipped addresses',()=>{
 setLocale('en',storage);
 const html=accessConfirmation({invitation:true,enabled:false,next_period:'2026-11-01',selected_count:1,members:[{email:'a@example.com'}],skipped_emails:['owner@example.com'],allowed:true});
 assert.match(html,/No balance will be charged/);assert.match(html,/owner@example.com/);assert.match(html,/Confirm invitations/);assert.doesNotMatch(html,/danger secondary|stops immediately/);
});

test('a confirmation left open during history navigation cannot submit a stale workspace operation',async()=>{
 const {openAccessConfirmation}=await import('../public/modules/access-dialog.js');
 let current=true,calls=0;const handlers={};
 const dialog={className:'',innerHTML:'',setAttribute(){},showModal(){},remove(){},
  addEventListener(name,handler){handlers[name]=handler;},close(){handlers.close();}};
 const pending=openAccessConfirmation({state:{isCurrent:()=>current},api:{request:async()=>{
  calls++;return {enabled:false,invitation:true,next_period:'2026-11-01',selected_count:1,members:[{email:'a@example.com'}],allowed:true};
 }},navigation:{},views:{},document:{createElement:()=>dialog,body:{append(){}}},crypto:{randomUUID:()=> 'operation'},tenant:'T',ticket:{},path:'/invitations',selection:{}});
 await new Promise(resolve=>setImmediate(resolve));current=false;
 await handlers.click({target:{closest:()=>true}});await pending;
 assert.equal(calls,1,'only the quote is requested; no mutation after navigation');
});
