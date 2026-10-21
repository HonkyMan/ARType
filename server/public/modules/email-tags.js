import {t as tr} from './i18n.js';
import {esc} from './format.js';

export const EMAIL_LIMIT=200;
// Matches the server's Zod email syntax. Google addresses are ASCII.
export const validEmail=value=>value.length<=254 && /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/.test(value);
export const emailTokens=text=>text.trim().split(/[\s,;]+/u).filter(Boolean).map(value=>value.toLowerCase());

export function emailTagsMarkup(emails=[]) {
  return emails.map(email=>`<span class="email-tag ${validEmail(email)?'':'invalid'}" data-email="${esc(email)}">
    <span>${esc(email)}</span><button type="button" data-remove-email aria-label="${tr('remove_email',{email:esc(email)})}">×</button></span>`).join('');
}

export function installEmailTags(root) {
  const fieldOf=input=>input.closest?.('[data-email-field]');
  function render(field,emails) {
    field.querySelector('[data-email-tags]').innerHTML=emailTagsMarkup(emails);
    const invalid=emails.filter(email=>!validEmail(email));
    const error=field.querySelector('[data-email-error]');
    error.textContent=invalid.length ? tr('invalid_email_tags',{emails:invalid.join(', ')}) :
      emails.length>EMAIL_LIMIT ? tr('email_batch_limit',{count:EMAIL_LIMIT}) : '';
    error.hidden=!error.textContent;
    field.querySelector('[data-email-input]').setAttribute('aria-invalid',String(!!error.textContent));
    field.querySelector('[data-email-count]').textContent=tr('email_count',{count:emails.length});
    field.closest('form').dataset.dirty='true';
  }
  const current=field=>[...field.querySelectorAll('[data-email]')].map(tag=>tag.dataset.email);
  function commit(field) {
    const input=field.querySelector('[data-email-input]');
    if(input.value.trim()) {
      render(field,[...new Set([...current(field),...emailTokens(input.value)])]);
      input.value='';
    }
    return current(field);
  }
  root.addEventListener('keydown',event=>{
    const input=event.target;
    if(!input.matches?.('[data-email-input]') || event.isComposing)return;
    const field=fieldOf(input);
    if(['Tab','Enter',' ',',',';'].includes(event.key)) {
      if(event.key!=='Tab')event.preventDefault();
      commit(field);
    } else if(event.key==='Backspace' && !input.value) {
      const emails=current(field);
      if(emails.length) {event.preventDefault();input.value=emails.pop();render(field,emails);}
    }
  });
  root.addEventListener('focusout',event=>{
    if(event.target.matches?.('[data-email-input]'))commit(fieldOf(event.target));
  });
  root.addEventListener('input',event=>{
    if(event.target.matches?.('[data-email-input]') && !event.isComposing && /[\s,;]/u.test(event.target.value))
      commit(fieldOf(event.target));
  });
  root.addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove-email]');
    if(!remove)return;
    const field=fieldOf(remove), email=remove.closest('[data-email]').dataset.email;
    render(field,current(field).filter(value=>value!==email));
    field.querySelector('[data-email-input]').focus();
  });
  return {read(form) {
    const field=form.querySelector('[data-email-field]'), emails=commit(field);
    if(!emails.length)throw Error(tr('email_required'));
    if(emails.length>EMAIL_LIMIT)throw Error(tr('email_batch_limit',{count:EMAIL_LIMIT}));
    if(emails.some(email=>!validEmail(email)))throw Error(tr('fix_invalid_emails'));
    return emails;
  }};
}
