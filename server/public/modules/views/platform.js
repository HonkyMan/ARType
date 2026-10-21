import {t as tr, intlLocale} from '../i18n.js';
import {planDefaultsForm} from './workspaces.js';
import {invoiceInboxNotice} from './invoice-inbox.js';
import {button, esc, fmt, money, tag} from '../format.js';
import {searchBox, noMatches, saveActions} from './components.js';

export function createPlatformViews({state, shell}) {

function connectionForm(c,canManage) {
const existing=!!c.alias;return `<section class="panel connection-editor">
      <div class="panel-head"><h2>${tr('connection_settings')}</h2>
      ${existing?`<span class="tag active">${tr('key_saved')}</span>`:''}</div>
      <form class="panel-body" data-form="provider" data-mode="${existing?'edit':'create'}">
      <div class="fields">
      <label>${tr('connection_name')}<input name="alias" value="${esc(c.alias)}" ${existing?'readonly':''} required maxlength="64" pattern="[a-zA-Z0-9_-]+" placeholder="openrouter"><small>${existing?tr('workspaces_use_this_identifier_it_cannot_be_changed'):tr('use_latin_letters_numbers_hyphens_and_underscores_this_connectio')}</small>
      </label>
      <label>${tr('provider_api_address')}<input name="base_url" type="url" value="${esc(c.base_url)}" required maxlength="2048" placeholder="https://openrouter.ai/api/v1"><small>${tr('base_url_without_chat_completions')}</small>
      </label>
      <label>${tr('default_model')}<input name="default_model" value="${esc(c.default_model)}" required maxlength="200" placeholder="google/gemma-3-4b-it"><small>${tr('used_when_selecting_this_connection_existing_workspaces_keep_the')}</small>
      </label>
      <label>${tr('api_key')}<input name="key" type="password" autocomplete="new-password" ${existing?'':'required'} maxlength="4096"><small>${existing?tr('leave_blank_to_keep_the_saved_key_enter_the_key_again_when_chang'):tr('the_value_will_not_be_displayed_after_saving')}</small>
      </label>
      </div>${!canManage?`<div class="notice">${tr('set_credential_encryption_key_on_the_server_and_recreate_the_api')}</div>`:''}<div class="actions">
      <button ${!canManage?'disabled':''}>${existing?tr('save_changes'):tr('create_connection')}</button>${button(tr('cancel'),'provider','quiet')}
      </div>
      <p class="legal">${tr('the_key_is_encrypted_on_the_server_workspace_administrators_and')}</p>
      </form>
      </section>`}

  function dashboard(data) {
  shell(`${invoiceInboxNotice(data.inbox)}<div class="grid">
      <div class="metric">
      <div class="label">${tr('workspaces')}</div>
      <div class="value">${data.tenants.length}</div>
      <div class="unit">${tr('active_workspaces',{count:data.tenants.filter(t=>t.status==='active').length})}</div>
      </div>
      <div class="metric">
      <div class="label">${tr('paid_seats')} ${esc(data.period.slice(0,7))}</div>
      <div class="value">${fmt(data.billed_seats)}</div>
      <div class="unit">${tr('one_email_in_two_workspaces_counts_as_two_seats')}</div>
      </div>
      <div class="metric">
      <div class="label">${tr('charged_this_month')}</div>
      <div class="value">${money(data.invoice_amount_cents)}</div>
      <div class="unit">${tr('subscriptions_and_seats_top_ups_shown_separately')}</div>
      </div>
      </div>
      <section class="panel">
      <div class="panel-head">
      <h2>${tr('workspaces_and_activity')}</h2>${button(tr('refresh'),'dashboard','quiet small')}</div>${searchBox(tr('find_a_workspace'))}
      <div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>${tr('workspace_205')}</th>
      <th>${tr('seats_206')}</th>
      <th>${tr('activity_this_month_207')}</th>
      <th>${tr('charged_208')}</th>
      <th>${tr('balance_209')}</th>
      <th>${tr('actions_210')}</th>
      </tr>
      </thead>
      <tbody>${data.tenants.map(t=>`<tr data-filter-item data-search="${esc(t.name)}">
      <td data-label="${tr('workspace_187')}"><strong>${esc(t.name)}</strong><br>${tag(t.status)}</td>
      <td data-label="${tr('seats')}">${tr('workspace_paid_seats',{paid:t.billed_seats,enabled:t.connected_seats})}
      </td>
      <td data-label="${tr('activity_this_month')}">${tr('workspace_usage_summary',{requests:fmt(t.requests),people:fmt(t.active_users)})}<br><small>${t.last_activity?tr('latest')+esc(new Date(t.last_activity).toLocaleString(intlLocale())):tr('no_translations_yet')}</small>
      </td>
      <td data-label="${tr('charged')}">${money(t.invoice_amount_cents)}</td>
      <td data-label="${tr('balance')}">${money(t.balance_cents)}${t.pending_payments ? `<br><button class="quiet small" data-tenant="${t.id}" data-section="billing">${tr('pending_topups',{count:t.pending_payments})}</button>` : ''}</td>
      <td data-label="${tr('actions')}">
      <button class="quiet small" data-tenant="${t.id}" aria-label="${tr('open')} ${esc(t.name)}">${tr('open')}</button>
      </td>
      </tr>`).join('')||`<tr><td colspan="6">${tr('no_workspaces_yet')}</td></tr>`}</tbody>
      </table>
      </div>
      ${noMatches()}</section>
`,tr('platform_overview'),tr('workspace_statistics_and_charges_for_the_current_calendar_month'),button(tr('create_organization'),'new-tenant'));
  }

  function pricing(data) {
    shell(`      <section class="panel">
      <div class="panel-head">
      <h2>${tr('subscription_prices')}</h2>
      </div>
      <form class="panel-body" data-form="price">
      <div class="fields">
      <label>${tr('plus_usd_per_month')}<input name="plus_price" inputmode="decimal" value="${(data.plus_price_cents/100).toFixed(2)}" required></label>
      <label>${tr('business_usd_per_workspace_per_month')}<input name="business_price" inputmode="decimal" value="${(data.business_price_cents/100).toFixed(2)}" required></label>
      <label>${tr('business_usd_per_seat_per_month')}<input name="price" inputmode="decimal" value="${(data.unit_price_cents/100).toFixed(2)}" required>
      </label>

      </div>
      ${saveActions(tr('save_pricing'))}
      <p class="legal">${tr('platform_administrators_only_prices_apply_to_new_charges_and_ren')}</p>
      </form>
      </section>${planDefaultsForm(state,data)}`, tr('pricing_and_registration'), tr('prices_ai_connection_and_limits_for_self_service_registration'));
  }

  function provider(data) {
    const rows = data.credentials.map(c=>`<tr>
      <td data-label="${tr('name')}"><strong>${esc(c.alias)}</strong><br><small>${c.source==='admin'?tr('configured_in_the_console'):tr('configured_on_the_server')}</small></td>
      <td data-label="${tr('api_address')}" class="connection-address">${esc(c.base_url)}</td>
      <td data-label="${tr('default_model')}" class="connection-model">${esc(c.default_model||tr('not_set'))}</td>
      <td data-label="${tr('api_key')}"><span class="tag active">${tr('saved')}</span></td>
      <td data-label="${tr('actions')}"><button class="quiet small" data-edit-provider="${esc(c.alias)}" aria-label="${tr('edit')} ${esc(c.alias)}">${tr('edit_228')}</button></td>
      </tr>`).join('');
    shell(`<section class="panel">
      <div class="panel-head"><h2>${tr('connections')}</h2><span class="muted">${data.credentials.length}</span></div>
      ${rows?`<div class="table-wrap"><table class="connections-table" data-responsive role="table">
      <thead><tr><th>${tr('name_229')}</th><th>${tr('api_address_230')}</th><th>${tr('default_model_231')}</th><th>${tr('api_key_232')}</th><th>${tr('actions_210')}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`:`<div class="empty"><h2>${tr('add_your_first_ai_provider')}</h2><p>${tr('enter_the_api_address_model_and_key_you_can_then_assign_this_con')}</p>${button(tr('create_connection'),'provider-new')}</div>`}
      </section><p class="legal">${tr('each_workspace_uses_its_assigned_connection_and_model_api_keys_a')}</p>`,
      tr('ai_connections'),tr('translation_connections_for_your_workspaces'),button(tr('create_connection_239'),'provider-new'));
  }

  function providerEditor(data, alias = null) {
    const connection = alias === null
      ? {alias:'', base_url:data.provider_base_url, default_model:data.default_model}
      : data.credentials.find(c=>c.alias===alias);
    if (!connection) {
      shell(`<div class="notice">${tr('connection_not_found_it_may_have_been_removed_from_the_server_se')}</div>${button(tr('back_to_connections'),'provider','secondary')}`,
        tr('connection_unavailable'),tr('refresh_the_list_and_choose_an_existing_connection'));
      return;
    }
    shell(`${alias!==null?`<div class="notice">${tr('changing_the_api_address_or_key_affects_every_workspace_using_th')}</div>`:''}${connectionForm(connection,data.can_manage)}`,
      alias===null?tr('new_connection'):`${tr('connection')} ${alias}`,
      alias===null?tr('add_an_ai_provider_to_make_it_available_for_workspaces'):tr('edit_the_settings_and_save_the_connection'),
      button(tr('all_connections'),'provider','quiet'));
  }

  function admins(data) {
    const {me} = state;
  shell(`<div class="notice">${tr('platform_administrators_manage_all_workspaces_ai_connections_and')}</div>
      <section class="panel">
      <div class="panel-head">
      <h2>${tr('platform_access')}</h2>
      </div>
      <div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>GOOGLE EMAIL</th>
      <th>${tr('access_256')}</th>
      <th>${tr('actions_210')}</th>
      </tr>
      </thead>
      <tbody>${data.administrators.map(a=>`<tr>
      <td data-label="Google email">${esc(a.email)}</td>
      <td data-label="${tr('access')}">${a.protected?tr('primary_administrator'):tr('platform_administrator')}</td>
      <td data-label="${tr('actions')}">${a.protected?tr('protected_by_server_configuration'):a.email===me.user.email?tr('your_account'):`<button class="quiet small danger" data-remove-admin="${esc(a.email)}">${tr('revoke_access')}</button>`}</td>
      </tr>`).join('')}</tbody>
      </table>
      </div>
      </section>
      <section class="panel">
      <div class="panel-head">
      <h2>${tr('add_platform_administrator')}</h2>
      </div>
      <form class="panel-body" data-form="admin">
      <div class="inline-form">
      <label>${tr('employee_google_email')}<input name="email" type="email" required maxlength="254" placeholder="colleague@company.com">
      </label>
      <button>${tr('grant_administrator_access')}</button>
      </div>
      <p class="legal">${tr('access_takes_effect_when_this_google_account_signs_in_share_the')}</p>
      </form>
      </section>`,tr('platform_administrators'),tr('only_platform_administrators_can_grant_or_revoke_this_access'));
  }

  return {dashboard, pricing, provider, providerEditor, admins};
}
