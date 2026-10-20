import {t as tr, dateOnly} from './i18n.js';
import {esc, money} from './format.js';
import {StaleResponse} from './api.js';

export function accessConfirmation(q) {
  const date = dateOnly(q.next_period + 'T00:00:00Z',{timeZone:'UTC'});
  return `<h2 id="access-title">${tr(q.enabled?'connect_selected':'disconnect_selected')}</h2>
    <p>${tr('selected_members_count',{count:q.selected_count})}</p>
    <details><summary>${tr('selected_members')}</summary><ul class="selected-members">${q.members.map(m=>`<li>${esc(m.email)}</li>`).join('')}</ul></details>
    ${q.enabled ? `<dl class="charge-preview">
      <div><dt>${tr('new_seats_charge',{count:q.new_paid_seats,price:money(q.unit_price_cents)})}</dt><dd>${money(q.seats_cents)}</dd></div>
      ${q.base_cents ? `<div><dt>${tr('business_subscription_due')}</dt><dd>${money(q.base_cents)}</dd></div>`:''}
      <div class="charge-total"><dt>${tr('charge_now')}</dt><dd>${money(q.total_cents)}</dd></div>
      ${q.balance_cents !== null ? `<div><dt>${tr('workspace_balance')}</dt><dd>${money(q.balance_cents)}</dd></div>`:''}</dl>
      <p class="legal">${tr('already_paid_selected',{count:q.already_paid_seats})} ${tr('connect_month_terms')}</p>` :
      `<div class="notice warning">${tr('disconnect_access_now')}</div><p>${tr('disconnect_next_charge',{date})}</p>`}
    ${q.blocked ? `<div class="notice warning" role="alert">${tr(`error_${q.blocked}`)}${q.missing_cents ? ` ${tr('deposit_shortfall',{amount:money(q.missing_cents)})}`:''}</div>`:''}
    ${q.blocked==='insufficient_balance' && !q.can_manage_balance ? `<p>${tr('ask_owner_deposit')}</p>`:''}
    <div data-access-error class="error" role="alert" tabindex="-1" hidden></div>
    <div class="actions"><button type="button" class="quiet" data-access-cancel autofocus>${tr('cancel')}</button>
      ${q.blocked==='insufficient_balance' && q.can_manage_balance ? `<button type="button" data-access-deposit>${tr('make_deposit')}</button>`:''}
      <button type="button" class="${q.enabled?'':'danger secondary'}" data-access-confirm ${!q.allowed?'disabled':''}>${tr(q.enabled?'confirm_connection':'confirm_disconnection')}</button></div>`;
}

export function installMemberAccess({state,api,navigation,views,document,crypto}) {
  const root = views.root;
  let opening = false;
  const boxes = () => [...root.querySelectorAll('[data-select-member]')];
  function updateSelection() {
    const eligible = boxes().filter(box=>!box.disabled && !box.closest('tr').hidden);
    const selected = boxes().filter(box=>box.checked);
    const all = root.querySelector('[data-select-all-members]');
    if (all) {
      all.checked = eligible.length > 0 && eligible.every(box=>box.checked);
      all.indeterminate = !all.checked && eligible.some(box=>box.checked);
      all.disabled = !eligible.length;
    }
    const counter = root.querySelector('[data-selection-count]');
    if (counter) counter.textContent = tr('selected_members_count',{count:selected.length});
    root.querySelectorAll('[data-members-action]').forEach(button=>button.disabled=!selected.length || opening);
  }
  root.addEventListener('change',event=>{
    if (event.target.matches('[data-select-all-members]')) {
      boxes().filter(box=>!box.disabled && !box.closest('tr').hidden).forEach(box=>box.checked=event.target.checked);
      updateSelection();
    } else if (event.target.matches('[data-select-member]')) updateSelection();
  });
  root.addEventListener('input',event=>{
    if (event.target.matches('[data-filter]')) {
      boxes().filter(box=>box.closest('tr').hidden).forEach(box=>box.checked=false);
      updateSelection();
    }
  });
  root.addEventListener('click',async event=>{
    const trigger = event.target.closest('[data-members-action]');
    if (!trigger || trigger.disabled || opening) return;
    const member_ids = boxes().filter(box=>box.checked).map(box=>box.dataset.selectMember);
    if (!member_ids.length) return;
    if (member_ids.length>1000) {views.toast(tr('selection_limit'));return;}
    const tenant = state.current, ticket = state.snapshot();
    const selection = {member_ids,enabled:trigger.dataset.membersAction==='enable'};
    const path = `/api/tenants/${tenant}/member-access`;
    opening=true;updateSelection();
    let dialog;
    try {
      let q = await api.request(path+'/quote','POST',selection);
      if (!state.isCurrent(ticket)) return;
      let key=crypto.randomUUID(), busy=false;
      dialog=document.createElement('dialog');
      dialog.className='access-dialog';
      dialog.setAttribute('aria-labelledby','access-title');
      dialog.innerHTML=accessConfirmation(q);
      document.body.append(dialog);
      dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
      dialog.addEventListener('close',()=>{
        dialog.remove();
        if(trigger.isConnected)trigger.focus();
      },{once:true});
      dialog.addEventListener('click',async event=>{
        if(busy)return;
        if(event.target.closest('[data-access-cancel]')) {dialog.close();return;}
        if(event.target.closest('[data-access-deposit]')) {
          dialog.close();
          try {await navigation.openTenant(tenant,'billing');}
          catch(error) {if(!(error instanceof StaleResponse))views.showError(error);return;}
          if(state.current!==tenant)return;
          const form=root.querySelector('#invoice-request');
          if(form){
            form.hidden=false;
            root.querySelector('[data-action=topup]').setAttribute('aria-expanded','true');
            const input=form.querySelector('[name=amount]');
            input.value=(Math.max(q.missing_cents || q.total_cents,1)/100).toFixed(2);
            input.focus();
          }
          return;
        }
        if(!event.target.closest('[data-access-confirm]') || !q.allowed)return;
        busy=true;
        dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
        const errorBox=dialog.querySelector('[data-access-error]');
        errorBox.hidden=true;
        try {
          await api.request(path,'POST',{...selection,quote_token:q.quote_token,idempotency_key:key});
          dialog.close();
          if(state.isCurrent(ticket)) {
            await navigation.openTenant(tenant,'team');
            views.toast(tr(selection.enabled?'members_connected':'members_disconnected'));
          }
        } catch(error) {
          if(error instanceof StaleResponse || !state.isCurrent(ticket)) {dialog.close();return;}
          if(error.code==='access_quote_changed') {
            try {
              q=await api.request(path+'/quote','POST',selection);
              key=crypto.randomUUID();
            } catch(refreshError) {
              if(refreshError instanceof StaleResponse || !state.isCurrent(ticket)) {dialog.close();return;}
              error=refreshError;q={...q,allowed:false};
            }
            dialog.innerHTML=accessConfirmation(q);
          }
          const target=dialog.querySelector('[data-access-error]');
          target.textContent=error.message;target.hidden=false;target.focus();
        } finally {
          busy=false;
          if(dialog.isConnected)dialog.querySelectorAll('button').forEach(button=>button.disabled=button.matches('[data-access-confirm]')&&!q.allowed);
        }
      });
      dialog.showModal();
    } catch(error) {
      if(!(error instanceof StaleResponse) && state.isCurrent(ticket))views.showError(error);
    } finally {opening=false;updateSelection();}
  });
}
