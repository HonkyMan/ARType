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

  root.addEventListener('click', async event => {
    const element = event.target.closest('button');
    if (!element || element.disabled) return;
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
      case 'login': {
        const status = await api.request('/auth/status');
        if (!state.isCurrent(ticket)) return;
        if (!status.configured) throw new Error('Google-вход ещё не настроен. Обратитесь к администратору сервиса.');
        location.href = '/auth/google' + (location.search || '');
        return;
      }
      case 'logout':
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
        if (form) form.hidden = !form.hidden;
        return;
      }
      case 'dashboard': return navigation.dashboardPage();
      case 'home': return navigation.home();
      case 'provider': return navigation.providerPage();
      case 'provider-new': return navigation.providerEditorPage();
      case 'refresh': return navigation.start();
      case 'admins': return navigation.adminsPage();
      case 'help': return navigation.helpPage();
      case 'new-tenant':
        await navigation.home();
        if (state.me && state.section === 'home') {
          history.replaceState({}, '', '#new-tenant');
          document.querySelector('#new-tenant')?.scrollIntoView({behavior: 'smooth'});
        }
        return;
      case 'copy-url':
        await navigator.clipboard.writeText(location.origin);
        if (state.isCurrent(ticket)) views.toast('Адрес скопирован');
        return;
      default:
        if (action?.startsWith('section:') && state.details) {
          const section = action.slice('section:'.length);
          if (['team', 'settings', 'usage', 'billing'].includes(section)) {
            state.section = section;
            history.pushState({}, '', `#tenants/${encodeURIComponent(state.current)}/${section}`);
            views.renderTenant();
          }
        }
    }
  }

  root.addEventListener('change', async event => {
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
    const submit = form.querySelector('button');
    const tenant = form.dataset.tenantId;
    const ticket = state.snapshot();
    form.dataset.submitting = 'true';
    submit.disabled = true;
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
      await submitForm(form, values, tenant, ticket);
    } catch (error) {
      report(error, ticket);
    } finally {
      delete form.dataset.submitting;
      if (submit.isConnected) submit.disabled = false;
    }
  });

  async function submitForm(form, values, tenant, ticket) {
    switch (form.dataset.form) {
      case 'price':
        await api.request('/api/billing-settings', 'PUT', {unit_price_cents: cents(values.price)});
        if (state.isCurrent(ticket)) await navigation.dashboardPage();
        views.toast('Стоимость места сохранена');
        return;
      case 'balance': {
        const operation = await submitBalance({
          api, balanceJournal, crypto, tenant,
          values: {operation: values.operation, amount_cents: cents(values.amount), reason: values.reason.trim()},
        });
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
          `Запрос на инвойс: ${state.details.tenant.name}; ${values.quantity} мест × ${money(wallet.unit_price_cents)} = ${money(Number(values.quantity) * wallet.unit_price_cents)}. После оплаты администратор начислит сумму на баланс организации.`;
        return;
      }
      case 'provider': {
        const {alias, ...connection} = values;
        if (!connection.key) delete connection.key;
        await api.request('/api/provider-credentials/' + encodeURIComponent(alias), form.dataset.mode === 'create' ? 'POST' : 'PUT', connection);
        form.reset();
        if (state.isCurrent(ticket)) await navigation.providerPage();
        views.toast('Подключение сохранено');
        return;
      }
      case 'admin':
        await api.request('/api/platform-admins/' + encodeURIComponent(values.email.trim().toLowerCase()), 'PUT', {});
        form.reset();
        if (state.isCurrent(ticket)) await navigation.adminsPage();
        views.toast('Администратор платформы добавлен');
        return;
      case 'create':
        await api.request('/api/tenants', 'POST', values);
        if (state.isCurrent(ticket)) await navigation.start();
        views.toast('Организация создана. Передайте владельцу адрес кабинета.');
        return;
      case 'invite':
        await api.request(`/api/tenants/${tenant}/members`, 'POST', values);
        await reloadTenant(tenant, ticket);
        views.toast('Сотрудник добавлен. Проверьте статус оплаты и передайте ему адрес кабинета и установщик.');
        return;
      case 'settings':
        await api.request(`/api/tenants/${tenant}`, 'PATCH', values);
        await reloadTenant(tenant, ticket);
        views.toast('Правила сохранены');
    }
  }
}
