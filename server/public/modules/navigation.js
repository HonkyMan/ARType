import {StaleResponse} from './api.js';
import {esc} from './format.js';

export function createNavigation({state, api, views, location, history, balanceJournal}) {
  const signedIn = () => {
    if (state.me) return true;
    views.login();
    return false;
  };

  function begin(section, title, tenant = null, hash = `#${section}`) {
    if (!signedIn()) return null;
    const ticket = state.navigate(section, tenant);
    if (location.hash !== hash) history.pushState({}, '', hash);
    views.shell('<div class="loading">Загружаем…</div>', title, '');
    return ticket;
  }

  async function load(ticket, request) {
    try {
      return await request;
    } catch (error) {
      if (!(error instanceof StaleResponse) && state.isCurrent(ticket)) views.showError(error);
      throw error;
    }
  }

  async function home() {
    const ticket = begin('home', 'Рабочие пространства', null, location.hash === '#new-tenant' ? '#new-tenant' : '#home');
    if (!ticket) return;
    const data = state.me.operator
      ? await load(ticket, api.request('/api/tenants'))
      : {tenants: state.me.tenants};
    if (!state.isCurrent(ticket)) return;
    state.organizations = data.tenants;
    state.credentials = data.credentials || [];
    state.connections = data.connections || [];
    state.defaultModel = data.default_model || '';
    views.home();
  }

  async function dashboardPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('dashboard', 'Dashboard');
    const data = await load(ticket, api.request('/api/dashboard'));
    if (state.isCurrent(ticket)) views.dashboard(data);
  }

  async function providerPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('provider', 'AI-провайдеры', null, '#providers');
    const data = await load(ticket, api.request('/api/provider-credentials'));
    if (!state.isCurrent(ticket)) return;
    state.defaultModel = data.default_model || '';
    state.connections = data.credentials;
    state.credentials = state.connections.map(connection => connection.alias);
    views.provider(data);
  }

  async function providerEditorPage(alias = null) {
    if (!state.me?.operator) return home();
    const hash = alias === null ? '#providers/new' : `#providers/${encodeURIComponent(alias)}/edit`;
    const ticket = begin('provider-edit', alias === null ? 'Новое подключение' : 'Редактирование подключения', null, hash);
    const data = await load(ticket, api.request('/api/provider-credentials'));
    if (!state.isCurrent(ticket)) return;
    state.connections = data.credentials;
    views.providerEditor(data, alias);
  }

  async function adminsPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('admins', 'Администраторы платформы');
    const data = await load(ticket, api.request('/api/platform-admins'));
    if (state.isCurrent(ticket)) views.admins(data);
  }

  async function helpPage() {
    const ticket = begin('help', 'Установка и помощь');
    if (!ticket) return;
    const data = await load(ticket, api.request('/api/downloads'));
    if (!state.isCurrent(ticket)) return;
    state.downloadFiles = data.files;
    views.shell(views.helpContent(), 'Установка и помощь', 'Установщики и инструкции для вашей команды.');
  }

  async function openTenant(id, section = state.section) {
    if (!signedIn()) return;
    const tenant = state.me.tenants.find(item => item.id === id);
    if (!tenant && !state.me.operator) return home();
    if (!['team', 'settings', 'usage', 'billing'].includes(section)) section = 'team';
    const ticket = begin(section, 'Рабочее пространство', id, `#tenants/${encodeURIComponent(id)}/${section}`);
    if (tenant?.role === 'member') {
      const data = await load(ticket, api.request('/api/downloads'));
      if (!state.isCurrent(ticket)) return;
      state.downloadFiles = data.files;
      views.shell(
        `<div class="notice">Вы подключены к организации. Участниками и правилами управляет её администратор.</div>${views.helpContent()}`,
        tenant.name,
        'Войдите в приложение с этим же Google-аккаунтом.',
      );
      return;
    }
    const [details, provider] = await load(ticket, Promise.all([
      api.request(`/api/tenants/${encodeURIComponent(id)}`),
      state.me.operator ? api.request('/api/provider-credentials') : Promise.resolve(null),
    ]));
    if (!state.isCurrent(ticket)) return;
    if (provider) {
      state.connections = provider.credentials;
      state.credentials = state.connections.map(connection => connection.alias);
    }
    state.details = details;
    views.renderTenant();
  }

  async function pairing() {
    const id = new URLSearchParams(location.search).get('device');
    if (!id) return false;
    const ticket = begin('pairing', 'Вход в приложение');
    if (!ticket) return true;
    const device = await load(ticket, api.request('/api/device/' + encodeURIComponent(id)));
    if (!state.isCurrent(ticket)) return true;
    views.shell(
      `<section class="panel"><div class="panel-body"><h2>Подключить приложение ARType</h2><p>Подтвердите вход только если этот же код показан в вашем приложении.</p><div class="code">${esc(device.code)}</div><div class="actions"><button data-approve="${esc(id)}" data-code="${esc(device.code)}">Код совпадает — подключить</button><a class="button quiet" href="/">Отмена</a></div></div></section>`,
      'Вход в приложение',
      'Google-аккаунт: ' + state.me.user.email,
    );
    return true;
  }

  async function start() {
    const ticket = state.navigate('home');
    try {
      const profile = await api.request('/api/me');
      if (!state.isCurrent(ticket)) return;
      state.me = profile;
      balanceJournal.restore();
      if (!await pairing()) {
        if (!state.isCurrent(ticket)) return;
        await route();
      }
    } catch (error) {
      if (error instanceof StaleResponse) return;
      if (state.isCurrent(ticket)) {
        if (!state.me) views.login();
        else views.showError(error);
      }
    }
  }

  async function route() {
    const hash = location.hash;
    if (hash === '#providers') return providerPage();
    if (hash === '#providers/new') return providerEditorPage();
    const providerMatch = /^#providers\/([a-zA-Z0-9_-]+)\/edit$/.exec(hash);
    if (providerMatch) return providerEditorPage(providerMatch[1]);
    const tenantMatch = /^#tenants\/([a-f0-9-]+)\/(team|settings|usage|billing)$/.exec(hash);
    if (tenantMatch) return openTenant(tenantMatch[1], tenantMatch[2]);
    if (hash === '#admins') return adminsPage();
    if (hash === '#help') return helpPage();
    if (hash === '#home' || hash === '#new-tenant') return home();
    return state.me?.operator ? dashboardPage() : home();
  }

  return {start, route, home, dashboardPage, providerPage, providerEditorPage, adminsPage, helpPage, openTenant};
}
