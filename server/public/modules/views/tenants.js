import {personalSummary} from './workspaces.js';
import {t as tr, intlLocale} from '../i18n.js';
import {button, esc, fmt, money, roles, tag} from '../format.js';
import {createBillingViews} from './billing.js';
import {createTenantSettings} from './tenant-settings.js';
import {searchBox, noMatches} from './components.js';
import {emailTagsMarkup} from '../email-tags.js';

export function createTenantViews({state, shell}) {
  const {walletContent, ledgerTable} = createBillingViews({state});
  const {createForm, translationForm, settingsForm} = createTenantSettings({state});

  function renderTenant() {
    const {details, section} = state;
    const {tenant: t, members, usage: u, billing} = details;
    if (t.plan === 'plus' && (!state.me.operator && section !== 'billing' || ['team','translation'].includes(section))) {state.section = 'billing'; return renderTenant();}
    const used = members.filter(m => m.product_enabled && (m.status === 'active' || m.status === 'invited' && new Date(m.expires_at) > new Date())).length;
    const tabs = t.plan === 'plus' ? [['billing',tr('subscription_and_payment')], ...(state.me.operator ? [['usage',tr('usage')],['settings',tr('settings')]] : [])] : [['team', tr('team')], ['translation', tr('translation')], ...(billing ? [['billing', tr('balance_and_payment')]] : []), ['usage', tr('usage')], ['settings', tr('settings')]];
    const navigation = `<nav class="section-tabs" aria-label="${tr('workspace_sections')}">${tabs.map(([key, title]) =>
      `<button type="button" data-action="section:${key}" class="${key === section ? 'selected' : ''}" ${key === section ? 'aria-current="page"' : ''}>${title}</button>`).join('')}</nav>`;
    const expired = t.access_until && new Date(t.access_until) <= new Date();
    const status = t.status !== 'active' || expired
      ? `<div class="notice warning">${expired ? tr('workspace_access_has_expired') : tr('workspace_is_suspended')} ${tr('translations_are_unavailable_contact_the_platform_administrator')}</div>`
      : t.access_until ? `<p class="legal">${tr('translation_access_until')} ${esc(new Date(t.access_until).toLocaleString(intlLocale()))}.</p>` : '';
    let content;
    if (section === 'billing') content = billing ? walletContent(t, billing) + ledgerTable() : `<div class="notice">${tr('the_balance_is_available_to_the_workspace_owner_and_platform_adm')}</div>`;
    else if (section === 'settings') content = settingsForm(t);
    else if (section === 'translation') content = translationForm(t);
    else if (section === 'usage') content = `<div class="grid">
      <div class="metric"><div class="label">${tr('characters_this_month_utc')}</div><div class="value">${fmt(u.characters)}</div><div class="unit">${tr('of')} ${fmt(t.monthly_characters)}</div></div>
      <div class="metric"><div class="label">${tr('translations_this_month')}</div><div class="value">${fmt(u.requests)}</div><div class="unit">${tr('all_workspace_requests')}</div></div>
      <div class="metric"><div class="label">${tr('provider_errors')}</div><div class="value">${fmt(u.failures)}</div><div class="unit">${tr('this_month')}</div></div>
      </div>${usageTable()}`;
    else content = `<div class="context-strip"><span>${tr('workspace_capacity',{used,capacity:fmt(t.seats)})}</span>${billing ? `<button type="button" class="quiet small" data-action="section:billing">${tr('balance_335')} ${money(billing.balance_cents)} →</button>` : ''}</div>
      ${billing?.pending_seats ? `<div class="notice warning">${tr('awaiting_payment_shortfall',{count:billing.pending_seats,missing:money(billing.missing_cents)})} ${button(tr('go_to_payment'), 'section:billing', 'quiet small')}</div>` : ''}${teamTable(t, members)}`;
    shell(`${navigation}${status}${content}`, t.name, t.plan === 'plus' ? tr('personal_workspace') : roles[t.role] || tr('platform_administrator'),
      section === 'team' && t.plan !== 'plus' ? button(tr('invite_member'), 'invite-focus') : section === 'usage' ? `<a class="button secondary" href="/api/tenants/${t.id}/usage.csv">${tr('download_usage_csv')}</a>` : '');
  }

function appTag(m) {
return m.app_status==='active'?`<span class="tag active">${tr('active_paid')}</span>`:m.app_status==='disabled'?`<span class="tag">${tr('app_not_connected')}</span>`:m.app_status==='management_only'?`<span class="tag">${tr('console_only')}</span>`:`<span class="tag disabled">${tr('disabled')} · ${m.app_status==='awaiting_payment'?tr('awaiting_payment_344'):m.app_status==='suspended'?tr('workspace_suspended'):tr('disabled_346')}</span>`}

function teamTable(t,members) {
const draft=state.invitationDrafts.get(t.id) || {emails:[],role:'member',enabled:false};
return `<section class="panel">
      <div class="panel-head">
      <h2>${tr('team_members')}</h2><span class="muted">${members.length}</span>
      </div>
      <div class="member-bulk-toolbar"><label class="select-all"><input type="checkbox" data-select-all-members> ${tr('select_visible_members')}</label>
        <span data-selection-count role="status">${tr('selected_members_count',{count:0})}</span>
        <div class="actions"><button type="button" data-members-action="enable" disabled>${tr('connect_selected')}</button>
        <button type="button" class="secondary" data-members-action="disable" disabled>${tr('disconnect_selected')}</button></div></div>
      <p class="table-hint">${tr('team_selection_hint')}</p>
      ${searchBox(tr('find_a_member'), "Google email")}<div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>${tr('select_member')}</th>
      <th>${tr('member_362')}</th>

      <th>${tr('console_access_363')}</th>
      <th>${tr('app_364')}</th>
      <th>${tr('actions_210')}</th>
      </tr>
      </thead>
      <tbody>${members.map(m=>`<tr data-filter-item data-search="${esc(m.email)}">
      <td class="member-selection" data-label="${tr('select_member')}"><input type="checkbox" data-select-member="${m.id}" aria-label="${tr('select_member')} ${esc(m.email)}" ${t.role==='admin'&&m.role!=='member'||!m.product_enabled&&(m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date())?'disabled':''}></td>
      <td data-label="${tr('member_356')}" class="member-identity"><strong>${esc(m.email)}</strong>${m.status==='invited'?`<br><small>${new Date(m.expires_at)>new Date()?tr('invited_until'):tr('expired')} ${new Date(m.expires_at).toLocaleDateString(intlLocale())}</small>`:''}${m.paid_until?`<br><small>${tr('paid_until')} ${new Date(m.paid_until).toLocaleDateString(intlLocale(),{timeZone:'UTC'})}</small>`:''}</td>

      <td data-label="${tr('console_access')}">${tag(m.status)}</td>
      <td data-label="${tr('app')}">${appTag(m)}</td>
      <td data-label="${tr('role_and_actions')}">
      <div class="row-actions">${t.role==='admin'&&m.role!=='member'?roles[m.role]:`<select aria-label="${tr('role')} ${esc(m.email)}" data-role-member="${m.id}" data-role-tenant="${t.id}">${Object.entries(roles).filter(([r])=>r!=='operator'&&(t.role!=='admin'||r==='member')).map(([r,v])=>`<option value="${r}" ${m.role===r?'selected':''}>${v}</option>`).join('')}</select>
      ${m.role==='owner'?'':`<button class="quiet small danger" data-member="${m.id}" data-member-tenant="${t.id}" data-status="${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?'invited':'disabled'}">${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?tr('invite_again'):tr('block_console_sign_in')}</button>`}`}</div>
      </td>
      </tr>`).join('')}</tbody>
      </table>
      </div>${noMatches()}
      </section>
      <section class="panel" id="invite-member">
      <div class="panel-head">
      <h2>${tr('invite_member_365')}</h2>
      </div>
      <form class="panel-body" data-form="invite" data-tenant-id="${t.id}">
      <p class="legal">${tr('invitation_is_free')}</p>
      <div class="inline-form">
      <div class="email-field" data-email-field><label for="invitation-emails">Google email</label>
        <div class="email-tags-control"><div data-email-tags>${emailTagsMarkup(draft.emails)}</div>
          <input id="invitation-emails" type="text" inputmode="email" data-email-input autocomplete="off" autocapitalize="none" spellcheck="false"
            placeholder="colleague@company.com" aria-describedby="invitation-email-help invitation-email-error"></div>
        <small id="invitation-email-help">${tr('email_tags_help')}</small>
        <small data-email-count role="status">${tr('email_count',{count:draft.emails.length})}</small>
        <p id="invitation-email-error" class="field-error" data-email-error role="alert" hidden></p>
      </div>
      <label class="role">${tr('role')}<select name="role">${['member',...(t.role!=='admin'?['admin','owner']:[])].map(r=>`<option value="${r}" ${r===draft.role?'selected':''}>${roles[r]}</option>`).join('')}</select>
      </label>
      </div>
      <label class="connect-invitation"><input type="checkbox" name="connect_immediately" ${draft.enabled?'checked':''}><span><strong>${tr('connect_on_invite')}</strong><small>${tr('connect_on_invite_help')}</small></span></label>
      <div class="error" data-invitation-error role="alert" tabindex="-1" hidden></div>
      <div class="actions"><button type="submit">${tr('review_invitations')}</button></div>
      <details class="explanation"><summary>${tr('roles_billing_and_invitations')}</summary><p>${tr('a_workspace_administrator_manages_only_their_own_team_the_owner')}</p></details>${button(tr('copy_console_address'),'copy-url','quiet small')}</form>
      </section>`}

function usageTable() {
  const {details} = state;
const rs=details.recent;return `<section class="panel">
      <div class="panel-head">
      <h2>${tr('last_30_requests')}</h2><small>${tr('text_is_not_stored')}</small>
      </div>${rs.length?`<div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>${tr('time_373')}</th>
      <th>${tr('member_362')}</th>
      <th>${tr('characters_374')}</th>
      <th>${tr('duration_ms_375')}</th>
      <th>${tr('status_376')}</th>
      </tr>
      </thead>
      <tbody>${rs.map(r=>`<tr>
      <td data-label="${tr('time')}">${esc(new Date(r.created_at).toLocaleString(intlLocale()))}</td>
      <td data-label="${tr('member_356')}">${esc(r.email)}</td>
      <td data-label="${tr('characters')}">${fmt(r.characters)}</td>
      <td data-label="${tr('duration_ms')}">${fmt(r.duration_ms)}</td>
      <td data-label="${tr('status')}">${tag(r.status)}</td>
      </tr>`).join('')}</tbody>
      </table>
      </div>`:`<div class="empty"><h2>${tr('your_first_translation_is_ahead')}</h2><p>${tr('install_the_app_and_translate_some_text_to_see_usage_statistics')}</p></div>`}</section>`}


  function home() {
    const {me, organizations} = state;
    const cards = organizations.map(t => `<article class="org-card" data-filter-item data-search="${esc(t.name)}">
      <div><h3>${esc(t.name)} ${tag(t.status)}</h3><span class="tag">${t.plan === 'plus' ? 'Plus' : 'Business'}</span>
      <p>${me.operator ? tr('workspace_capacity_summary',{used:fmt(t.used_seats),capacity:fmt(t.seats),characters:fmt(t.used_characters)}) : roles[t.role]}</p></div>
      <button type="button" class="secondary small" data-tenant="${t.id}" aria-label="${tr('open')} ${esc(t.name)}">${tr('open_383')}</button></article>`).join('');
    shell(`${personalSummary(me)}<section class="panel"><div class="panel-head"><h2>${tr('business_organizations')}</h2><span class="muted">${organizations.length}</span></div>
      ${cards ? searchBox(tr('find_a_workspace')) + cards + noMatches() : `<div class="empty"><h2>${tr('no_business_organizations')}</h2><p>${me.operator ? tr('create_an_organization_assign_an_owner_and_choose_a_translation') : tr(me.tenants.some(t=>t.plan==='plus')?'business_optional_for_personal':'create_a_personal_plus_workspace_or_a_business_organization')}</p>${button(me.operator ? tr('create_organization_300') : tr(me.tenants.some(t=>t.plan==='plus')?'create_business':'choose_plan'), me.operator ? 'new-tenant' : 'new-workspace', 'secondary')}</div>`}
      </section>`, tr('workspaces'), tr('teams_app_access_and_translation_settings'), me.operator ? button(tr('create_organization'), 'new-tenant') : button(tr(me.tenants.some(t=>t.plan==='plus')?'create_business':'choose_plan'), 'new-workspace'));
  }

  function newTenant() {
    shell(createForm(), tr('new_organization'), tr('three_steps_owner_translation_and_limits'), button(tr('all_workspaces'), 'home', 'quiet'));
  }

  return {home, newTenant, renderTenant};
}
