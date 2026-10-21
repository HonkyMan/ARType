import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {accessConfirmation} from '../public/modules/member-access.js';
import {createInvoiceInboxViews} from '../public/modules/views/invoice-inbox.js';
import {setLocale} from '../public/modules/i18n.js';
const storage={setItem(){}};
afterEach(()=>setLocale('en',storage));
const quote={enabled:true,next_period:'2026-11-01',selected_count:2,members:[{id:'A',email:'a@example.com'},{id:'B',email:'<img src=x>'}],new_paid_seats:2,already_paid_seats:0,unit_price_cents:500,base_cents:1000,seats_cents:1000,total_cents:2000,balance_cents:0,missing_cents:2000,allowed:false,blocked:'insufficient_balance',can_manage_balance:true};
test('connection confirmation shows an exact charge, blocks insufficient funds and offers a deposit in both locales',()=>{
 for(const locale of ['en','ru']){
  setLocale(locale,storage);const html=accessConfirmation(quote);
  assert.match(html,/data-access-confirm disabled/);assert.match(html,/data-access-deposit/);assert.match(html,/20[.,]00/);
  assert.doesNotMatch(html,/<img src=x>|undefined|NaN/);
  const paid=accessConfirmation({...quote,total_cents:0,base_cents:0,seats_cents:0,new_paid_seats:0,already_paid_seats:2,missing_cents:0,allowed:true,blocked:null});
  assert.doesNotMatch(paid,/data-access-confirm disabled|data-access-deposit/);
 }
});
test('disconnection states immediate loss of access and the next UTC charge date without suggesting a refund',()=>{
 setLocale('en',storage);const html=accessConfirmation({...quote,enabled:false,allowed:true,blocked:null});
 assert.match(html,/stops immediately/);assert.match(html,/Nov 1, 2026/);assert.match(html,/not refunded/);assert.doesNotMatch(html,/data-access-deposit|Charge now/);
});
test('temporary inbox presents requester, amount, workspace, status and paging without unsafe markup',()=>{
 for(const locale of ['en','ru']){
  setLocale(locale,storage);let html;const views=createInvoiceInboxViews({shell:content=>html=content});
  views.invoiceInbox({pending_count:1,next_cursor:'next',requests:[{id:'R',tenant_id:'T',workspace_name:'<img src=x>',requested_by:'owner@example.com',amount_cents:2000,status:'pending',created_at:'2026-10-20T12:00:00Z'}]});
  assert.match(html,/owner@example.com/);assert.match(html,/data-tenant="T"/);assert.match(html,/data-invoice-after="next"/);assert.doesNotMatch(html,/<img src=x>|undefined|NaN/);
 }
});
