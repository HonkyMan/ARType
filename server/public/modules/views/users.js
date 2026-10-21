import {t as tr} from '../i18n.js';
import {esc} from '../format.js';

export function createUserViews({shell}) {
  function users(data, query) {
    const flag = value => `<span class="plan-check ${value?'present':''}" aria-label="${tr(value?'yes':'no')}">${value?'✓':'—'}</span>`;
    const pages = Math.max(1,Math.ceil(data.total/data.page_size));
    shell(`<section class="panel">
      <form class="panel-body directory-search" data-form="users-search">
        <label>${tr('find_user')}<input type="search" name="q" maxlength="120" value="${esc(query.q)}" placeholder="name@company.com"></label>
        <label>${tr('account_type')}<select name="type">${['all','personal','business','both','neither'].map(type=>
          `<option value="${type}" ${type===query.type?'selected':''}>${tr(`users_filter_${type}`)}</option>`).join('')}</select></label>
        <button type="submit">${tr('search_users')}</button>
      </form>
      <div class="panel-head"><h2>${tr('users_found',{count:data.total})}</h2><span>${tr('page_of',{page:data.page,pages})}</span></div>
      <p class="table-hint">${tr('user_plan_flags_help')}</p>
      <div class="table-wrap"><table data-responsive role="table"><thead><tr>
        <th>${tr('user_identity')}</th><th>Personal</th><th>Business</th><th>${tr('registration_status')}</th><th>${tr('actions')}</th>
      </tr></thead><tbody>${data.users.map(user=>`<tr>
        <td data-label="${tr('user_identity')}"><strong>${esc(user.name || user.email)}</strong>${user.name?`<br><small>${esc(user.email)}</small>`:''}</td>
        <td data-label="Personal">${flag(user.personal)}</td>
        <td data-label="Business">${flag(user.business)}${user.business_count?` <small>${tr('organization_count',{count:user.business_count})}</small>`:''}</td>
        <td data-label="${tr('registration_status')}"><span class="tag">${tr(user.registered?'registered':'awaiting_first_login')}</span></td>
        <td data-label="${tr('actions')}">${user.personal_tenant_id?`<button type="button" class="quiet small" data-tenant="${esc(user.personal_tenant_id)}" data-section="billing">${tr('personal_subscription')}</button>`:'—'}</td>
      </tr>`).join('') || `<tr><td colspan="5"><div class="empty">${tr('no_users_found')}</div></td></tr>`}</tbody></table></div>
      <div class="panel-body actions">
        <button type="button" class="secondary" data-users-page="${data.page-1}" ${data.page<=1?'disabled':''}>${tr('previous_page')}</button>
        <button type="button" class="secondary" data-users-page="${data.page+1}" ${data.page>=pages?'disabled':''}>${tr('next_page')}</button>
      </div></section>`,tr('users'),tr('users_description'));
  }
  return {users};
}
