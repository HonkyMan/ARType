import {t as tr, intlLocale} from '../i18n.js';
import {button, esc, money} from '../format.js';

export function createBillingViews({state}) {
function walletContent(t,w) {
  const {me} = state;
if (!w) return '';
  const pending = state.pendingBalances.get(t.id);
  return `<section class="panel">
      <div class="panel-head">
      <div>
      <h2>${tr('workspace_balance')}</h2>
      <div class="balance-value">${money(w.balance_cents)}</div><small>${t.plan === 'plus' ? `Plus · ${money(w.base_price_cents)} ${tr('per_month_ai_included')}` : `Business · ${money(w.base_price_cents)} + ${money(w.unit_price_cents)} ${tr('per_seat_per_month')}`}</small>
      </div>${`<button type="button" class="secondary" data-action="topup" aria-expanded="false" aria-controls="invoice-request">${tr('request_a_top_up')}</button>`}</div>
      <div class="panel-body">
      <p>${w.subscription_paid ? `<span class="tag active">${tr('subscription_paid')}</span>` : `<span class="tag disabled">${tr('subscription_awaiting_payment')}</span>`} · ${esc(w.period.slice(0,7))} · UTC</p>
      ${w.required_cents ? `<div class="notice warning">${tr(t.plan === 'plus' ? 'plus_activation_shortfall' : 'activation_shortfall',{required:money(w.required_cents),missing:money(w.missing_cents),count:w.pending_seats})}</div>` : `<p>${tr('all_current_charges_are_paid')}</p>`}
      ${!w.renewal_enabled ? `<div class="notice">${tr('auto_renewal_is_off_paid_access_lasts_until_the_end_of_the_month')}</div>` : ''}
      <details class="explanation"><summary>${tr('how_billing_works')}</summary><p>${tr(t.plan === 'plus' ? 'plus_billing_explanation' : 'plus_includes_one_personal_seat_and_ai_business_has_a_workspace')}</p></details>
      <form data-form="renewal" data-tenant-id="${t.id}" class="renewal-form"><input type="hidden" name="enabled" value="${!w.renewal_enabled}"><button class="quiet small">${w.renewal_enabled ? tr('turn_off_auto_renewal') : tr('turn_on_auto_renewal')}</button><p class="legal">${tr('turning_off_renewal_stops_future_charges_turning_it_on_immediate')}</p></form>
      <form id="invoice-request" class="invoice-placeholder" data-form="invoice" data-tenant-id="${t.id}" hidden>
      <div class="notice">${tr('online_payments_are_not_connected_yet_your_request_will_be_saved')}</div>
      <div class="inline-form"><label>${tr('top_up_amount_usd')}<input name="amount" inputmode="decimal" value="${(Math.max(w.missing_cents || 0,w.base_price_cents || 500)/100).toFixed(2)}" required></label><button>${tr('create_top_up_request')}</button></div>
      </form>${me.operator?`<form class="balance-form" data-form="balance" data-tenant-id="${t.id}">
      <h3>${tr('manual_credit_or_adjustment')}</h3>${state.balanceJournalError?`<div class="notice">${esc(state.balanceJournalError)}</div>`:''}${pending?`<div class="notice">${tr('the_outcome_of_the_previous_transaction_is_uncertain_retry_with')}</div>`:''}<div class="fields">
      <label>${tr('transaction')}<select name="operation"><option value="credit" ${pending?.request.operation!=='set'?'selected':''}>${tr('credit_an_amount')}</option><option value="set" ${pending?.request.operation==='set'?'selected':''}>${tr('set_the_final_balance')}</option></select>
      </label>
      <label>${tr('amount_usd')}<input name="amount" inputmode="decimal" value="${esc(pending?(pending.request.amount_cents/100).toFixed(2):'')}" required placeholder="100.00">
      </label>
      <label class="wide">${tr('reason_paid_invoice_number')}<input name="reason" value="${esc(pending?.request.reason||'')}" required minlength="3" maxlength="500" placeholder="${tr('paid_invoice_inv_001')}">
      </label>
      </div>
      <div class="actions">
      <button>${tr('record_transaction')}</button><small>${tr('this_transaction_will_be_recorded_in_the_ledger_pending_seats_wi')}</small>
      </div>
      </form>`:''}</div>
      </section>${paymentOrders(t,w)}`}

function paymentOrders(t,w) {
  return `<section class="panel"><div class="panel-head"><h2>${tr('top_up_requests')}</h2></div><div class="panel-body">${(w.orders || []).map(o=>`<article class="payment-order"><div><strong>${money(o.amount_cents)}</strong> <span class="tag ${o.status==='paid'?'active':''}">${o.status==='paid'?tr('paid'):o.status==='cancelled'?tr('cancelled'):tr('awaiting_payment')}</span><p><code>${esc(o.id)}</code></p><small>${esc(new Date(o.created_at).toLocaleString(intlLocale()))}</small></div>
    ${state.me.operator && o.status==='pending' ? `<form data-form="settle-payment" data-order-id="${o.id}" data-tenant-id="${t.id}"><input type="hidden" name="amount" value="${(o.amount_cents/100).toFixed(2)}"><label>${tr('received_payment_invoice_reference')}<input name="reference" required minlength="3" maxlength="200" placeholder="INV-001"></label><button class="secondary">${tr('confirm_received_payment')}</button><p class="legal">${tr('confirm_only_after_the_money_has_arrived_the_balance_will_be_cre')}</p></form>` : ''}</article>`).join('') || `<p class="muted">${tr('no_requests_yet')}</p>`}</div></section>`;
}

function ledgerTable() {
  const {details} = state;
  const w = details.billing;
  if (!w) return '';
  return `<section class="panel">
      <div class="panel-head">
      <h2>${tr('last_50_transactions')}</h2><small>${tr('usd_immutable_history')}</small>
      </div>
      <div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>${tr('date_126')}</th>
      <th>${tr('transaction_127')}</th>
      <th>${tr('amount_128')}</th>
      <th>${tr('balance_after_129')}</th>
      <th>${tr('reason_130')}</th>
      </tr>
      </thead>
      <tbody>${w.entries.map(e=>`<tr>
      <td data-label="${tr('date')}">${esc(new Date(e.created_at).toLocaleString(intlLocale()))}</td>
      <td data-label="${tr('transaction')}">${({credit:tr('top_up'),adjustment:tr('adjustment'),seat_charge:tr('monthly_seat'),subscription_charge:tr('monthly_subscription')})[e.kind]}<br><small>${esc(e.actor_email||tr('automatic_charge'))}</small>
      </td>
      <td data-label="${tr('amount')}">${e.delta_cents>0?'+':''}${money(e.delta_cents)}</td>
      <td data-label="${tr('balance_after')}">${money(e.balance_after)}</td>
      <td data-label="${tr('reason')}">${e.kind === 'subscription_charge' ? `${esc(e.request?.plan === 'plus' ? 'Plus' : 'Business')} · ${esc(e.request?.period?.slice(0,7))}` : e.kind === 'seat_charge' ? `${esc(e.request?.email)} · ${esc(e.request?.period?.slice(0,7))}` : esc(e.reason)}</td>
      </tr>`).join('')||`<tr><td colspan="5">${tr('no_transactions_yet')}</td></tr>`}</tbody>
      </table>
      </div>
      </section>`}


  return {walletContent, ledgerTable};
}
