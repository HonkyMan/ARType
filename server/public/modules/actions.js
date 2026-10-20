import {t as tr, getLocale, setLocale, intlLocale} from './i18n.js';
import {StaleResponse} from './api.js';
import {cents, money} from './format.js';
import {submitBalance} from './balance.js';

export function installActions({
  state, api, navigation, views, balanceJournal, document, location, history, navigator, FormData, crypto,
}) {
  const {root} = views;

  function report(error, ticket) {
    if (error instanceof StaleResponse) return;
    if (error.status === 401 || state.isCurrent(ticket)) views.showError(error);
  }

  async function reloadTenant(tenant, ticket) {
    if (state.isCurrent(ticket) && state.current === tenant) await navigation.openTenant(tenant);
  }

  root.addEventListener('input', event => {
    const input = event.target;
    input.setCustomValidity?.('');
    if (input.matches?.('[data-filter]')) {
      const scope = input.closest('.panel');
      const query = input.value.trim().toLocaleLowerCase(intlLocale());
      const rows = [...scope.querySelectorAll('[data-filter-item]')];
      let visible = 0;
      for (const row of rows) {
        row.hidden = !row.dataset.search.toLocaleLowerCase(intlLocale()).includes(query);
        if (!row.hidden) visible += 1;
      }
      scope.querySelector('[data-filter-count]').textContent = query ? tr('search_result_count',{visible,total:rows.length}) : '';
      scope.querySelector('[data-no-matches]').hidden = !query || visible > 0;
      return;
    }
    markDirty(input);
  });

  function markDirty(input) {
    const form = input.closest?.('form[data-form]');
    if (!form) return;
    form.dataset.dirty = 'true';
    const status = form.querySelector('[data-save-state]');
    if (status) status.textContent = tr('you_have_unsaved_changes');
  }

  root.addEventListener('click', async event => {
    if (event.target.closest('a.skip-link')) {
      event.preventDefault();
      document.querySelector('#main-content')?.focus();
      return;
    }
    const element = event.target.closest('button');
    if (!element || element.disabled) return;
    // Submit buttons belong to the submit handler. Disabling on click cancels
    // native form submission and validation in some browsers.
    if (!Object.keys(element.dataset).length) return;
    const data = element.dataset;
    // Navigation is protected by request generations. Keep its trigger focusable
    // while the unsaved-changes dialog is open; lock only state-changing actions.
    element.disabled = Boolean(data.productMember || data.removeAdmin || data.member ||
      data.approve || data.action === 'login' || data.action === 'logout');
    const ticket = state.snapshot();
    try {
      if (data.tenant) {
        await navigation.openTenant(data.tenant, data.section || 'team');
      } else if (data.editProvider) {
        await navigation.providerEditorPage(data.editProvider);
      } else if (data.productMember) {
        await api.request(`/api/tenants/${data.memberTenant}/members/${data.productMember}`, 'PATCH', {
          product_enabled: data.product === 'true',
        });
        await reloadTenant(data.memberTenant, ticket);
        views.toast(tr('app_access_updated'));
      } else if (data.removeAdmin) {
        await api.request('/api/platform-admins/' + encodeURIComponent(data.removeAdmin), 'DELETE');
        if (state.isCurrent(ticket)) await navigation.adminsPage();
        views.toast(tr('administrator_access_revoked'));
      } else if (data.member) {
        await api.request(`/api/tenants/${data.memberTenant}/members/${data.member}`, 'PATCH', {status: data.status});
        await reloadTenant(data.memberTenant, ticket);
        views.toast(tr('access_updated'));
      } else if (data.approve) {
        await api.request(`/api/device/${encodeURIComponent(data.approve)}/approve`, 'POST', {code: data.code});
        if (state.isCurrent(ticket)) {
          views.shell(
            `<div class="notice">${tr('app_connected_return_to_artype_you_can_close_this_tab')}</div>`,
            tr('done'), tr('app_sign_in_confirmed'),
          );
          history.replaceState({}, '', '/');
        }
      } else {
        await clickAction(data.action, ticket);
      }
    } catch (error) {
      report(error, ticket);
    } finally {
      if (element.isConnected) {
        element.disabled = false;
        // Restore focus if a locked action lost it, without stealing form focus.
        if (document.activeElement === document.body) element.focus?.();
      }
    }
  });

  async function clickAction(action, ticket) {
    switch (action) {
      case 'toggle-menu': {
        const sidebar = root.querySelector('.sidebar');
        const expanded = sidebar.classList.toggle('menu-open');
        root.querySelector('[data-action="toggle-menu"]').setAttribute('aria-expanded', String(expanded));
        return;
      }
      case 'login': {
        const status = await api.request('/auth/status');
        if (!state.isCurrent(ticket)) return;
        if (!status.configured) throw new Error(tr('google_sign_in_is_not_configured_yet_contact_the_platform_admini'));
        location.href = '/auth/google' + (location.search || '');
        return;
      }
      case 'logout':
        if (views.hasUnsavedChanges() && !await views.confirmDiscard()) return;
        try {
          await api.logout();
        } catch (error) {
          if (!(error instanceof StaleResponse)) {
            views.showError(new Error(tr('the_console_is_closed_but_the_server_did_not_confirm_sign_out_re')));
          }
        }
        return;
      case 'topup': {
        const form = root.querySelector('.invoice-placeholder');
        if (form) {
          form.hidden = !form.hidden;
          root.querySelector('[data-action="topup"]').setAttribute('aria-expanded', String(!form.hidden));
          if (!form.hidden) form.querySelector('input').focus();
        }
        return;
      }
      case 'invite-focus':
        root.querySelector('#invite-member input')?.focus();
        return;
      case 'dashboard': return navigation.dashboardPage();
      case 'home': return navigation.home();
      case 'provider': return navigation.providerPage();
      case 'provider-new': return navigation.providerEditorPage();
      case 'pricing': return navigation.pricingPage();
      case 'refresh': return navigation.start();
      case 'admins': return navigation.adminsPage();
      case 'help': return navigation.helpPage();
      case 'new-workspace': return navigation.workspacePage();
      case 'new-tenant': return navigation.newTenantPage();
      case 'copy-url':
        await navigator.clipboard.writeText(location.origin);
        if (state.isCurrent(ticket)) views.toast(tr('address_copied'));
        return;
      case 'copy-invoice':
        await navigator.clipboard.writeText(root.querySelector('[data-invoice-text]').textContent.trim());
        if (state.isCurrent(ticket)) views.toast(tr('invoice_request_copied'));
        return;
      default:
        if (action?.startsWith('section:') && state.details) {
          const section = action.slice('section:'.length);
          if (['team', 'translation', 'settings', 'usage', 'billing'].includes(section)) {
            return navigation.tenantSection(section);
          }
        }
    }
  }

  root.addEventListener('change', async event => {
    if (event.target.matches?.('[data-locale]')) {
      const language = event.target.value;
      if (views.hasUnsavedChanges() && !await views.confirmDiscard()) {event.target.value=getLocale();return;}
      const persisted = setLocale(language);
      if (state.me) await navigation.start(); else views.login();
      if (!persisted) views.toast(tr('locale_not_persisted'));
      return;
    }
    markDirty(event.target);
    if (event.target.name === 'credential') {
      const connection = state.connections.find(item => item.alias === event.target.value);
      const form = event.target.closest('form');
      if (connection && form) {
        form.querySelector('[data-connection-url]').textContent = connection.base_url;
        form.querySelector('[name=model]').value = connection.default_model || state.defaultModel;
      }
      return;
    }
    const member = event.target.dataset.roleMember;
    if (!member) return;
    const ticket = state.snapshot();
    const tenant = event.target.dataset.roleTenant;
    try {
      await api.request(`/api/tenants/${tenant}/members/${member}`, 'PATCH', {role: event.target.value});
      await reloadTenant(tenant, ticket);
      views.toast(tr('role_updated'));
    } catch (error) {
      report(error, ticket);
      if (state.me && state.isCurrent(ticket)) {
        try { await reloadTenant(tenant, ticket); }
        catch (refreshError) { report(refreshError, state.snapshot()); }
      }
    }
  });

  root.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.submitting === 'true' || !state.me) return;
    const submit = form.querySelector('button[type="submit"], button:not([type])');
    const tenant = form.dataset.tenantId;
    const ticket = state.snapshot();
    form.dataset.submitting = 'true';
    submit.disabled = true;
    const originalLabel = submit.textContent;
    submit.textContent = tr('saving');
    const oldError = form.querySelector('[data-form-error]');
    if (oldError) oldError.remove();
    try {
      const formData = new FormData(form);
      const values = Object.fromEntries(formData);
      for (const key of ['seats', 'monthly_characters', 'max_text', 'rpm', 'concurrency']) {
        if (key in values) values[key] = Number(values[key]);
      }
      if (form.querySelector('[data-languages]')) {
        values.languages = formData.getAll('languages');
        if (!values.languages.length) throw new Error(tr('select_at_least_one_translation_language'));
      }
      if ('access_until' in values) values.access_until = values.access_until ? new Date(values.access_until).toISOString() : null;
      form.inert = true;
      await submitForm(form, values, tenant, ticket);
    } catch (error) {
      if (!(error instanceof StaleResponse) && state.isCurrent(ticket) && form.isConnected && error.status !== 401) {
        const message = document.createElement('div');
        message.className = 'error';
        message.dataset.formError = '';
        message.setAttribute('role', 'alert');
        message.tabIndex = -1;
        message.textContent = error.message;
        form.prepend(message);
        form.inert = false;
        message.focus();
      } else report(error, ticket);
    } finally {
      delete form.dataset.submitting;
      form.inert = false;
      if (submit.isConnected) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    }
  });

  async function submitForm(form, values, tenant, ticket) {
    switch (form.dataset.form) {
      case 'workspace': {
        form.dataset.requestKey ||= crypto.randomUUID();
        const result = await api.request('/api/workspaces', 'POST', {...values,idempotency_key:form.dataset.requestKey});
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) {
          const profile = await api.request('/api/me');
          if (state.isCurrent(ticket)) {
            state.me=profile;
            if (new URLSearchParams(location.search).has('device')) await navigation.start();
            else await navigation.openTenant(result.id,'billing');
          }
        }
        return;
      }
      case 'plan-defaults':
        await api.request('/api/plan-defaults/'+form.dataset.plan,'PUT',{...values,registration_enabled:values.registration_enabled === 'true'});
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) await navigation.pricingPage();
        views.toast(tr('registration_settings_saved'));
        return;
      case 'renewal':
        await api.request(`/api/tenants/${tenant}/renewal`,'PUT',{enabled:values.enabled === 'true'});
        delete form.dataset.dirty;
        await reloadTenant(tenant,ticket);
        return;
      case 'settle-payment':
        await api.request(`/api/payment-orders/${form.dataset.orderId}/settle`,'POST',{amount_cents:cents(values.amount),currency:'USD',reference:values.reference});
        delete form.dataset.dirty;
        await reloadTenant(tenant,ticket);
        views.toast(tr('payment_confirmed_and_credited_to_the_balance'));
        return;
      case 'price':
        await api.request('/api/billing-settings', 'PUT', {unit_price_cents:cents(values.price),plus_price_cents:cents(values.plus_price),business_price_cents:cents(values.business_price)});
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) await navigation.pricingPage();
        views.toast(tr('subscription_prices_saved'));
        return;
      case 'balance': {
        const operation = await submitBalance({
          api, balanceJournal, crypto, tenant,
          values: {operation: values.operation, amount_cents: cents(values.amount), reason: values.reason.trim()},
        });
        delete form.dataset.dirty;
        // Keep the key if refreshing the form fails; retrying cannot charge twice.
        await reloadTenant(tenant, ticket);
        balanceJournal.complete(operation);
        if (state.current === tenant && state.details) views.renderTenant();
        views.toast(tr('transaction_recorded'));
        return;
      }
      case 'invoice': {
        form.dataset.requestKey ||= crypto.randomUUID();
        await api.request(`/api/tenants/${tenant}/payment-orders`,'POST',{amount_cents:cents(values.amount),idempotency_key:form.dataset.requestKey});
        delete form.dataset.dirty;
        await reloadTenant(tenant,ticket);
        views.toast(tr('request_saved_the_administrator_can_find_it_in_the_payments_sect'));
        return;
      }
      case 'provider': {
        const {alias, ...connection} = values;
        if (!connection.key) delete connection.key;
        await api.request('/api/provider-credentials/' + encodeURIComponent(alias), form.dataset.mode === 'create' ? 'POST' : 'PUT', connection);
        delete form.dataset.dirty;
        form.reset();
        if (state.isCurrent(ticket)) await navigation.providerPage();
        views.toast(tr('connection_saved'));
        return;
      }
      case 'admin':
        await api.request('/api/platform-admins/' + encodeURIComponent(values.email.trim().toLowerCase()), 'PUT', {});
        delete form.dataset.dirty;
        form.reset();
        if (state.isCurrent(ticket)) await navigation.adminsPage();
        views.toast(tr('platform_administrator_added'));
        return;
      case 'create': {
        await api.request('/api/tenants', 'POST', values);
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) await navigation.home();
        views.toast(tr('organization_created_share_the_console_address_with_its_owner'));
        return;
      }
      case 'invite':
        await api.request(`/api/tenants/${tenant}/members`, 'POST', values);
        delete form.dataset.dirty;
        await reloadTenant(tenant, ticket);
        views.toast(tr('employee_added_check_payment_status_and_share_the_console_addres'));
        return;
      case 'settings':
        await api.request(`/api/tenants/${tenant}`, 'PATCH', values);
        delete form.dataset.dirty;
        await reloadTenant(tenant, ticket);
        views.toast(tr('settings_saved'));
    }
  }
}
