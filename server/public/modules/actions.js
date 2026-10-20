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
    if (input.matches?.('[data-filter]')) {
      const scope = input.closest('.panel');
      const query = input.value.trim().toLocaleLowerCase('ru-RU');
      const rows = [...scope.querySelectorAll('[data-filter-item]')];
      let visible = 0;
      for (const row of rows) {
        row.hidden = !row.dataset.search.toLocaleLowerCase('ru-RU').includes(query);
        if (!row.hidden) visible += 1;
      }
      scope.querySelector('[data-filter-count]').textContent = query ? `Найдено: ${visible} из ${rows.length}` : '';
      scope.querySelector('[data-no-matches]').hidden = !query || visible > 0;
      return;
    }
    markDirty(input);
  });

  function markDirty(input) {
    const form = input.closest?.('form[data-form]');
    if (!form || form.dataset.form === 'invoice') return;
    form.dataset.dirty = 'true';
    const status = form.querySelector('[data-save-state]');
    if (status) status.textContent = 'Есть несохранённые изменения';
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
    element.disabled = true;
    const ticket = state.snapshot();
    try {
      const data = element.dataset;
      if (data.tenant) {
        await navigation.openTenant(data.tenant, 'team');
      } else if (data.editProvider) {
        await navigation.providerEditorPage(data.editProvider);
      } else if (data.productMember) {
        await api.request(`/api/tenants/${data.memberTenant}/members/${data.productMember}`, 'PATCH', {
          product_enabled: data.product === 'true',
        });
        await reloadTenant(data.memberTenant, ticket);
        views.toast('Доступ к программе обновлён');
      } else if (data.removeAdmin) {
        await api.request('/api/platform-admins/' + encodeURIComponent(data.removeAdmin), 'DELETE');
        if (state.isCurrent(ticket)) await navigation.adminsPage();
        views.toast('Права администратора отозваны');
      } else if (data.member) {
        await api.request(`/api/tenants/${data.memberTenant}/members/${data.member}`, 'PATCH', {status: data.status});
        await reloadTenant(data.memberTenant, ticket);
        views.toast('Доступ обновлён');
      } else if (data.approve) {
        await api.request(`/api/device/${encodeURIComponent(data.approve)}/approve`, 'POST', {code: data.code});
        if (state.isCurrent(ticket)) {
          views.shell(
            '<div class="notice">Приложение подключено. Вернитесь в ARType; эту вкладку можно закрыть.</div>',
            'Готово', 'Вход в приложение подтверждён.',
          );
          history.replaceState({}, '', '/');
        }
      } else {
        await clickAction(data.action, ticket);
      }
    } catch (error) {
      report(error, ticket);
    } finally {
      if (element.isConnected) element.disabled = false;
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
        if (!status.configured) throw new Error('Google-вход ещё не настроен. Обратитесь к администратору сервиса.');
        location.href = '/auth/google' + (location.search || '');
        return;
      }
      case 'logout':
        if (views.hasUnsavedChanges() && !await views.confirmDiscard()) return;
        try {
          await api.logout();
        } catch (error) {
          if (!(error instanceof StaleResponse)) {
            views.showError(new Error('Кабинет закрыт. Сервер не подтвердил выход; обновите страницу и повторите выход.'));
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
      case 'new-tenant': return navigation.newTenantPage();
      case 'copy-url':
        await navigator.clipboard.writeText(location.origin);
        if (state.isCurrent(ticket)) views.toast('Адрес скопирован');
        return;
      case 'copy-invoice':
        await navigator.clipboard.writeText(root.querySelector('[data-invoice-text]').textContent.trim());
        if (state.isCurrent(ticket)) views.toast('Запрос на инвойс скопирован');
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
      views.toast('Роль обновлена');
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
    submit.textContent = 'Сохраняем…';
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
        if (!values.languages.length) throw new Error('Выберите хотя бы один язык перевода.');
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
      case 'price':
        await api.request('/api/billing-settings', 'PUT', {unit_price_cents: cents(values.price)});
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) await navigation.pricingPage();
        views.toast('Стоимость места сохранена');
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
        views.toast('Операция записана');
        return;
      }
      case 'invoice': {
        const wallet = state.details.billing;
        form.querySelector('[data-invoice-text]').textContent =
          `Запрос на инвойс: ${state.details.tenant.name}; количество мест: ${values.quantity}; ${values.quantity} × ${money(wallet.unit_price_cents)} = ${money(Number(values.quantity) * wallet.unit_price_cents)}. После оплаты администратор начислит сумму на баланс организации.`;
        form.querySelector('[data-action="copy-invoice"]').hidden = false;
        return;
      }
      case 'provider': {
        const {alias, ...connection} = values;
        if (!connection.key) delete connection.key;
        await api.request('/api/provider-credentials/' + encodeURIComponent(alias), form.dataset.mode === 'create' ? 'POST' : 'PUT', connection);
        delete form.dataset.dirty;
        form.reset();
        if (state.isCurrent(ticket)) await navigation.providerPage();
        views.toast('Подключение сохранено');
        return;
      }
      case 'admin':
        await api.request('/api/platform-admins/' + encodeURIComponent(values.email.trim().toLowerCase()), 'PUT', {});
        delete form.dataset.dirty;
        form.reset();
        if (state.isCurrent(ticket)) await navigation.adminsPage();
        views.toast('Администратор платформы добавлен');
        return;
      case 'create': {
        await api.request('/api/tenants', 'POST', values);
        delete form.dataset.dirty;
        if (state.isCurrent(ticket)) await navigation.home();
        views.toast('Организация создана. Передайте владельцу адрес кабинета.');
        return;
      }
      case 'invite':
        await api.request(`/api/tenants/${tenant}/members`, 'POST', values);
        delete form.dataset.dirty;
        await reloadTenant(tenant, ticket);
        views.toast('Сотрудник добавлен. Проверьте статус оплаты и передайте ему адрес кабинета и установщик.');
        return;
      case 'settings':
        await api.request(`/api/tenants/${tenant}`, 'PATCH', values);
        delete form.dataset.dirty;
        await reloadTenant(tenant, ticket);
        views.toast('Правила сохранены');
    }
  }
}
