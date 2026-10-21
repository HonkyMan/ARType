import {t as tr, dateOnly} from './i18n.js';
import {esc, money} from './format.js';
import {StaleResponse} from './api.js';

export function accessConfirmation(q) {
  const date = dateOnly(q.next_period + 'T00:00:00Z',{timeZone:'UTC'});
  return `<h2 id="access-title">${tr(q.invitation?'confirm_invitations':q.enabled?'connect_selected':'disconnect_selected')}</h2>
    <p>${tr(q.invitation?'new_invitation_count':'selected_members_count',{count:q.selected_count})}</p>
    <details><summary>${tr('selected_members')}</summary><ul class="selected-members">${q.members.map(m=>`<li>${esc(m.email)}</li>`).join('')}</ul></details>
    ${q.skipped_emails?.length ? `<div class="notice">${tr('existing_emails_skipped',{count:q.skipped_emails.length})}<details><summary>${tr('show_addresses')}</summary><ul class="selected-members">${q.skipped_emails.map(email=>`<li>${esc(email)}</li>`).join('')}</ul></details></div>`:''}
    ${q.enabled ? `<dl class="charge-preview">
      <div><dt>${tr('new_seats_charge',{count:q.new_paid_seats,price:money(q.unit_price_cents)})}</dt><dd>${money(q.seats_cents)}</dd></div>
      ${q.base_cents ? `<div><dt>${tr('business_subscription_due')}</dt><dd>${money(q.base_cents)}</dd></div>`:''}
      <div class="charge-total"><dt>${tr('charge_now')}</dt><dd>${money(q.total_cents)}</dd></div>
      ${q.balance_cents !== null ? `<div><dt>${tr('workspace_balance')}</dt><dd>${money(q.balance_cents)}</dd></div>`:''}</dl>
      <p class="legal">${tr('already_paid_selected',{count:q.already_paid_seats})} ${tr('connect_month_terms')}</p>` :
      q.invitation ? `<p>${tr('invitation_free_confirmation')}</p>` : `<div class="notice warning">${tr('disconnect_access_now')}</div><p>${tr('disconnect_next_charge',{date})}</p>`}
    ${q.blocked ? `<div class="notice warning" role="alert">${tr(`error_${q.blocked}`)}${q.missing_cents ? ` ${tr('deposit_shortfall',{amount:money(q.missing_cents)})}`:''}</div>`:''}
    ${q.blocked==='insufficient_balance' && !q.can_manage_balance ? `<p>${tr('ask_owner_deposit')}</p>`:''}
    <div data-access-error class="error" role="alert" tabindex="-1" hidden></div>
    <div class="actions"><button type="button" class="quiet" data-access-cancel autofocus>${tr('cancel')}</button>
      ${q.blocked==='insufficient_balance' && q.can_manage_balance ? `<button type="button" data-access-deposit>${tr('make_deposit')}</button>`:''}
      <button type="button" class="${q.enabled||q.invitation?'':'danger secondary'}" data-access-confirm ${!q.allowed?'disabled':''}>${tr(q.invitation?'confirm_invite':q.enabled?'confirm_connection':'confirm_disconnection')}</button></div>`;
}

export async function openAccessConfirmation({
  state,api,navigation,views,document,crypto,tenant,ticket,path,selection,trigger,onSuccess,
}) {
  let q=await api.request(path+'/quote','POST',selection);
  if(!state.isCurrent(ticket))return;
  let key=crypto.randomUUID(),busy=false;
  const dialog=document.createElement('dialog');
  dialog.className='access-dialog';
  dialog.setAttribute('aria-labelledby','access-title');
  dialog.innerHTML=accessConfirmation(q);
  document.body.append(dialog);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  const closed=new Promise(resolve=>dialog.addEventListener('close',()=>{
    dialog.remove();
    if(trigger?.isConnected)trigger.focus();
    resolve();
  },{once:true}));
  dialog.addEventListener('click',async event=>{
    if(busy)return;
    if(!state.isCurrent(ticket)) {dialog.close();return;}
    if(event.target.closest('[data-access-cancel]')) {dialog.close();return;}
    if(event.target.closest('[data-access-deposit]')) {
      dialog.close();
      try {await navigation.openTenant(tenant,'billing');}
      catch(error) {if(!(error instanceof StaleResponse))views.showError(error);return;}
      if(state.current!==tenant || state.section!=='billing')return;
      const form=views.root.querySelector('#invoice-request');
      if(form) {
        form.hidden=false;
        views.root.querySelector('[data-action=topup]').setAttribute('aria-expanded','true');
        const input=form.querySelector('[name=amount]');
        input.value=(Math.max(q.missing_cents || q.total_cents,1)/100).toFixed(2);
        input.focus();
      }
      return;
    }
    if(!event.target.closest('[data-access-confirm]') || !q.allowed)return;
    busy=true;
    dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
    dialog.querySelector('[data-access-error]').hidden=true;
    try {
      const result=await api.request(path,'POST',{...selection,quote_token:q.quote_token,idempotency_key:key});
      if(state.isCurrent(ticket))onSuccess?.(result);
      dialog.close();
      if(state.isCurrent(ticket)) {
        await navigation.openTenant(tenant,'team');
        views.toast(tr(q.invitation?'invitations_created':selection.enabled?'members_connected':'members_disconnected',
          {count:result.invited_count}));
      }
    } catch(error) {
      if(error instanceof StaleResponse || !state.isCurrent(ticket)) {dialog.close();return;}
      if(!dialog.isConnected) {views.showError(error);return;}
      if(error.code==='access_quote_changed') {
        try {q=await api.request(path+'/quote','POST',selection);key=crypto.randomUUID();}
        catch(refreshError) {
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
  return closed;
}

