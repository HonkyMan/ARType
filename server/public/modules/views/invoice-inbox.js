import {t as tr, dateTime} from '../i18n.js';
import {esc,money,button} from '../format.js';

export function invoiceInboxNotice(data) {
  if (!data?.pending_count) return '';
  return `<section class="notice invoice-inbox-notice"><div><strong>${tr('invoice_pending_count',{count:data.pending_count})}</strong>
    <p>${tr('invoice_inbox_description')}</p></div>${button(tr('view_invoice_inbox'),'invoice-requests','secondary')}</section>`;
}

// Optional operator view; billing and settlement views do not import this file.
export function createInvoiceInboxViews({shell}) {
  function invoiceInbox(data,status='pending',after=null) {
    const cards=data.requests.map(r=>`<article class="invoice-request">
      <div><h2>${esc(r.workspace_name)} <span class="tag ${r.status==='paid'?'active':''}">${tr(r.status==='paid'?'paid':r.status==='cancelled'?'cancelled':'awaiting_payment')}</span></h2>
      <p>${tr('invoice_request_received',{email:esc(r.requested_by)})}</p>
      <small>${esc(dateTime(r.created_at))} · ${tr('payment_order_reference')}: <code>${esc(r.id)}</code></small></div>
      <div class="invoice-request-action"><strong>${money(r.amount_cents)}</strong><button type="button" class="secondary" data-tenant="${r.tenant_id}" data-section="billing">${tr('open_request_workspace')}</button></div>
      </article>`).join('');
    shell(`<div class="section-tabs" aria-label="${tr('top_up_requests')}">${['pending','paid','all'].map(s=>
      `<button type="button" data-invoice-filter="${s}" class="${s===status?'selected':''}" ${s===status?'aria-current="page"':''}>${tr(`invoice_${s}_filter`)}</button>`).join('')}</div>
      <p>${tr('invoice_pending_count',{count:data.pending_count})}</p>
      <section class="panel">${cards || `<div class="empty"><h2>${tr('no_requests_yet')}</h2>${status==='pending'?`<p>${tr('invoice_no_pending_help')}</p>`:''}</div>`}</section>
      <div class="actions">${after?`<button type="button" class="quiet" data-invoice-filter="${status}">${tr('latest_requests')}</button>`:''}
      ${data.next_cursor?`<button type="button" class="secondary" data-invoice-filter="${status}" data-invoice-after="${data.next_cursor}">${tr('next_requests')}</button>`:''}</div>`,
      tr('invoice_inbox'),tr('invoice_inbox_description'),
      `<button type="button" class="quiet" data-invoice-filter="${status}" ${after?`data-invoice-after="${after}"`:''}>${tr('refresh')}</button>`);
  }
  return {invoiceInbox};
}
