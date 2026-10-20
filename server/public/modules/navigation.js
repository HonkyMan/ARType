import {t as tr} from './i18n.js';
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
    views.shell(`<div class="loading">${tr('loading')}</div>`, title, '');
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

  async function home(create = false) {
    if (create && !state.me?.operator) create = false;
    const ticket = begin(create ? 'new-tenant' : 'home', create ? tr('new_organization') : tr('workspaces'), null, create ? '#new-tenant' : '#home');
    if (!ticket) return;
    const data = state.me.operator
      ? await load(ticket, api.request('/api/tenants'))
      : {tenants: state.me.tenants};
    if (!state.isCurrent(ticket)) return;
    state.organizations = data.tenants;
    state.credentials = data.credentials || [];
    state.connections = data.connections || [];
    state.defaultModel = data.default_model || '';
    if (create) views.newTenant();
    else views.home();
  }

  async function workspacePage() {
    const ticket = begin('new-workspace', tr('choose_your_workspace'));
    if (!ticket) return;
    const data = await load(ticket, api.request('/api/plans'));
    if (state.isCurrent(ticket)) views.onboarding(data);
  }

  async function dashboardPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('dashboard', tr('platform_overview'));
    const [data,inbox] = await load(ticket, Promise.all([api.request('/api/dashboard'),
      state.me.features?.invoice_inbox !== false ? api.request('/api/invoice-requests') : Promise.resolve(null)]));
    if (state.isCurrent(ticket)) views.dashboard({...data,inbox});
  }

  async function invoiceInboxPage(status='pending',after=null) {
    if (!state.me?.operator || state.me.features?.invoice_inbox === false) return home();
    const query=new URLSearchParams({status,...(after?{after}:{})});
    const ticket=begin('invoice-requests',tr('invoice_inbox'),null,'#invoice-requests?'+query);
    const data=await load(ticket,api.request('/api/invoice-requests?'+query));
    if(state.isCurrent(ticket))views.invoiceInbox(data,status,after);
  }

  async function pricingPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('pricing', tr('subscription_pricing'));
    const data = await load(ticket, api.request('/api/billing-settings'));
    if (state.isCurrent(ticket)) {
      state.connections = data.connections || [];
      views.pricing(data);
    }
  }

  async function providerPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('provider', tr('ai_providers'), null, '#providers');
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
    const ticket = begin('provider-edit', alias === null ? tr('new_connection') : tr('edit_connection'), null, hash);
    const data = await load(ticket, api.request('/api/provider-credentials'));
    if (!state.isCurrent(ticket)) return;
    state.connections = data.credentials;
    views.providerEditor(data, alias);
  }

  async function adminsPage() {
    if (!state.me?.operator) return home();
    const ticket = begin('admins', tr('platform_administrators'));
    const data = await load(ticket, api.request('/api/platform-admins'));
    if (state.isCurrent(ticket)) views.admins(data);
  }

  async function helpPage() {
    const ticket = begin('help', tr('install_and_help'));
    if (!ticket) return;
    const data = await load(ticket, api.request('/api/downloads'));
    if (!state.isCurrent(ticket)) return;
    state.downloadFiles = data.files;
    views.shell(views.helpContent(), tr('install_and_help'), tr('installers_and_instructions_for_getting_started'));
  }

  async function openTenant(id, section = state.section) {
    if (!signedIn()) return;
    const tenant = state.me.tenants.find(item => item.id === id);
    if (!tenant && !state.me.operator) return home();
    if (!['team', 'translation', 'settings', 'usage', 'billing'].includes(section)) section = 'team';
    if (tenant?.plan === 'plus' && (!state.me.operator || ['team','translation'].includes(section))) section = 'billing';
    const ticket = begin(section, tr('workspace'), id, `#tenants/${encodeURIComponent(id)}/${section}`);
    if (tenant?.role === 'member') {
      const data = await load(ticket, api.request('/api/downloads'));
      if (!state.isCurrent(ticket)) return;
      state.downloadFiles = data.files;
      views.shell(
        `<div class="notice">${tr('you_have_joined_this_workspace_its_administrator_manages_members')}</div>${views.helpContent()}`,
        tenant.name,
        tr('sign_in_to_the_app_with_the_same_google_account'),
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
    // Keep the navigation name current after a rename, without losing session data.
    const membership = state.me.tenants.find(item => item.id === id);
    if (membership) membership.name = details.tenant.name;
    views.renderTenant();
  }

  function tenantSection(section) {
    if (!state.details || !['team', 'translation', 'settings', 'usage', 'billing'].includes(section)) return;
    const details = state.details;
    state.navigate(section, state.current);
    state.details = details;
    history.pushState({}, '', `#tenants/${encodeURIComponent(state.current)}/${section}`);
    views.renderTenant();
  }

  async function pairing() {
    const id = new URLSearchParams(location.search).get('device');
    if (!id) return false;
    const ticket = begin('pairing', tr('sign_in_to_the_app'));
    if (!ticket) return true;
    const device = await load(ticket, api.request('/api/device/' + encodeURIComponent(id)));
    if (!state.isCurrent(ticket)) return true;
    views.shell(
      `<section class="panel"><div class="panel-body"><h2>${tr('connect_the_artype_app')}</h2><p>${tr('only_confirm_if_the_same_code_appears_in_your_app')}</p><div class="code">${esc(device.code)}</div><div class="actions"><button data-approve="${esc(id)}" data-code="${esc(device.code)}">${tr('code_matches_connect')}</button><a class="button quiet" href="/">${tr('cancel')}</a></div></div></section>`,
      tr('sign_in_to_the_app'),
      tr('google_account') + state.me.user.email,
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
      if (!profile.operator && !profile.tenants.length && new URLSearchParams(location.search).has('device')) {
        await workspacePage();
      } else if (!await pairing()) {
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
    if (hash === '#new-workspace' || (!state.me?.operator && !state.me?.tenants.length)) return workspacePage();
    if (hash === '#providers') return providerPage();
    if (hash === '#providers/new') return providerEditorPage();
    const providerMatch = /^#providers\/([a-zA-Z0-9_-]+)\/edit$/.exec(hash);
    if (providerMatch) return providerEditorPage(providerMatch[1]);
    const tenantMatch = /^#tenants\/([a-f0-9-]+)\/(team|translation|settings|usage|billing)$/.exec(hash);
    if (tenantMatch) return openTenant(tenantMatch[1], tenantMatch[2]);
    if (hash === '#admins') return adminsPage();
    if (hash === '#invoice-requests' || hash.startsWith('#invoice-requests?')) {
      const query=new URLSearchParams(hash.split('?')[1] || '');
      return invoiceInboxPage(['pending','paid','all'].includes(query.get('status'))?query.get('status'):'pending',query.get('after'));
    }
    if (hash === '#pricing') return pricingPage();
    if (hash === '#help') return helpPage();
    if (hash === '#home') return home();
    if (hash === '#new-tenant') return home(true);
    return state.me?.operator ? dashboardPage() : home();
  }

  const pages = {start, route, home, workspacePage, invoiceInboxPage, newTenantPage: () => home(true), dashboardPage, pricingPage, providerPage, providerEditorPage, adminsPage, helpPage, openTenant, tenantSection};
  let renderedHash = location.hash;
  return Object.fromEntries(Object.entries(pages).map(([name, navigate]) => [name, (...args) => {
    const proceed = async () => {
      try { return await navigate(...args); }
      finally { renderedHash = location.hash; }
    };
    // Do not delay clean navigation: request tickets are captured synchronously.
    if (!views.hasUnsavedChanges()) return proceed();
    return views.confirmDiscard().then(confirmed => {
      if (confirmed) return proceed();
      if (location.hash !== renderedHash) history.pushState({}, '', renderedHash);
    });
  }]));
}
