import {t as tr} from './i18n.js';
import {StaleResponse} from './api.js';
import {openAccessConfirmation} from './access-dialog.js';
export {accessConfirmation} from './access-dialog.js';

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
    try {
      await openAccessConfirmation({state,api,navigation,views,document,crypto,tenant,ticket,path,selection,trigger});
    } catch(error) {
      if(!(error instanceof StaleResponse) && state.isCurrent(ticket))views.showError(error);
    } finally {opening=false;updateSelection();}
  });
}
