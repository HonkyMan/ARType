import {t as tr} from './i18n.js';
import {StaleResponse} from './api.js';
import {installEmailTags} from './email-tags.js';
import {openAccessConfirmation} from './access-dialog.js';

export function installInvitations(environment) {
  const {views,state,api,navigation,document,crypto}=environment;
  const tags=installEmailTags(views.root);
  views.root.addEventListener('submit',async event=>{
    const form=event.target;
    if(form.dataset.form!=='invite')return;
    event.preventDefault();
    if(!state.me || form.dataset.submitting)return;
    const ticket=state.snapshot(), tenant=form.dataset.tenantId;
    const trigger=form.querySelector('[type=submit]');
    form.dataset.submitting='true';trigger.disabled=true;
    const errorBox=form.querySelector('[data-invitation-error]');
    errorBox.hidden=true;
    try {
      const selection={emails:tags.read(form),role:form.querySelector('[name=role]').value,
        enabled:form.querySelector('[name=connect_immediately]').checked};
      state.invitationDrafts.set(tenant,selection);
      // The in-memory draft survives a trip to the deposit form in this session.
      delete form.dataset.dirty;
      form.inert=true;
      await openAccessConfirmation({state,api,navigation,views,document,crypto,tenant,ticket,
        path:`/api/tenants/${tenant}/invitations`,selection,trigger,
        onSuccess:()=>{state.invitationDrafts.delete(tenant);delete form.dataset.dirty;}});
    } catch(error) {
      if(!(error instanceof StaleResponse) && state.isCurrent(ticket) && form.isConnected) {
        errorBox.textContent=error.message;errorBox.hidden=false;errorBox.focus();
      }
    } finally {
      delete form.dataset.submitting;form.inert=false;trigger.disabled=false;
    }
  });
}
