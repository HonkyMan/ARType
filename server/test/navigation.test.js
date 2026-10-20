import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createConsole} from '../public/modules/console.js';

const memberProfile = {
  user: {id: 'member', name: 'Alice', email: 'alice@example.com'},
  operator: false, csrf: 'csrf', tenants: [],
};
const operatorProfile = {...memberProfile, operator: true};
const dashboard = {
  period: '2026-10-01', tenants: [], billed_seats: 0, connected_seats: 0,
  invoice_amount_cents: 0, unit_price_cents: 500,
};
function tenantDetails(id, extra = {}) {
  return {
    tenant: {
      id, name: `Organization ${id}`, role: 'owner', status: 'active', seats: 10,
      monthly_characters: 1000000, revision: 1, instructions: '', languages: ['en', 'ru'],
      model: 'managed-model', credential: 'managed', max_text: 5000, rpm: 60, concurrency: 8,
      access_until: null,
    },
    members: [], recent: [], billing: null,
    usage: {requests: 0, characters: 0, failures: 0}, ...extra,
  };
}

// Real modules own state, navigation, templates and actions. Only browser IO
// and fetch are substituted, so delays exercise the production request flow.
function browserStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function browserFixture(storage = browserStorage(), hash = '') {
  const listeners = {};
  const root = {
    innerHTML: '', addEventListener(name, handler) { listeners[name] = handler; },
    querySelector() { return null; },
  };
  const message = {textContent: '', hidden: true};
  const pending = [];
  const location = {search: '', hash, origin: 'https://artype.test'};
  const application = createConsole({
    document: {querySelector(selector) { return selector === '#app' ? root : message; }},
    fetch(path, options) {
      const savedAtSend = [...(storage.values?.values() || [])];
      return new Promise((resolve, reject) => pending.push({path, options, savedAtSend, resolve, reject, settled: false}));
    },
    setTimeout() {}, location,
    history: {
      replaceState(_state, _title, hash) { location.hash = hash; },
      pushState(_state, _title, hash) { location.hash = hash; },
    }, navigator: {clipboard: {writeText: async () => {}}},
    crypto: {randomUUID},
    sessionStorage: storage,
    FormData: class {
      constructor(form) { this.entries = Object.entries(form.values).flatMap(([key, value])=>Array.isArray(value)?value.map(item=>[key,item]):[[key,value]]); }
      [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
      getAll(key) { return this.entries.filter(([name])=>name===key).map(([,value])=>value); }
    },
  });
  const ready = application.start();
  const next = path => {
    const request = pending.find(item => item.path === path && !item.settled);
    assert.ok(request, `Expected pending request ${path}`);
    return request;
  };
  const settle = async (request, data, status = 200) => {
    request.settled = true;
    request.resolve({ok: status >= 200 && status < 300, status, json: async () => data});
    await new Promise(resolve => setImmediate(resolve));
  };
  const fail = async request => {
    request.settled = true;
    request.reject(new TypeError('Connection lost'));
    await new Promise(resolve => setImmediate(resolve));
  };
  const signIn = async (profile = memberProfile) => {
    await settle(next('/api/me'), profile);
    if (profile.operator && location.hash === '#dashboard') await settle(next('/api/dashboard'), dashboard);
    await ready;
  };
  const click = dataset => listeners.click({target: {closest: selector => selector === 'button' ? {dataset, isConnected: false} : null}});
  const form = (kind, values, tenant) => {
    const submit = {disabled: false, isConnected: true};
    return {
      dataset: {form: kind, ...(tenant ? {tenantId: tenant} : {})}, values,
      querySelector: selector => selector === 'button[type="submit"], button:not([type])' ? submit : selector === '[data-languages]' && Array.isArray(values.languages) ? {} : null,
      reset() { this.values = {}; },
    };
  };
  const submit = form => listeners.submit({target: form, preventDefault() {}});
  return {application, root, pending, message, next, settle, fail, signIn, click, form, submit, ready, location};
}

const connections = {
  can_manage: true, default_model: 'default-model', provider_base_url:'https://example.com/v1',
  credentials: [{alias:'main',base_url:'https://provider.example/v1',default_model:'model-one',source:'admin'}],
};

test('provider list links to a separate editor, saves changes, and returns to the refreshed table', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const listing = app.application.providerPage();
  await app.settle(app.next('/api/provider-credentials'), connections);
  await listing;
  assert.match(app.root.innerHTML, /<table class="connections-table"/);
  assert.doesNotMatch(app.root.innerHTML, /data-form="provider"/);
  const edit = app.click({editProvider:'main'});
  await app.settle(app.next('/api/provider-credentials'), connections);
  await edit;
  assert.equal(app.location.hash,'#providers/main/edit');
  assert.match(app.root.innerHTML,/data-mode="edit"/);
  assert.match(app.root.innerHTML,/name="alias" value="main" readonly/);
  const save = app.submit(app.form('provider',{alias:'main',base_url:'https://provider.example/v1',default_model:'model-two',key:''}));
  const request = app.next('/api/provider-credentials/main');
  assert.equal(request.options.method,'PUT');
  assert.deepEqual(JSON.parse(request.options.body),{base_url:'https://provider.example/v1',default_model:'model-two'});
  await app.settle(request,{ok:true});
  await app.settle(app.next('/api/provider-credentials'),{...connections,credentials:[{...connections.credentials[0],default_model:'model-two'}]});
  await save;
  assert.equal(app.location.hash,'#providers');
  assert.match(app.root.innerHTML,/model-two/);
  assert.doesNotMatch(app.root.innerHTML,/data-form="provider"/);
});

test('new connection uses create semantics and preserves the form on duplicate-name rejection', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const open = app.click({action:'provider-new'});
  await app.settle(app.next('/api/provider-credentials'),connections);
  await open;
  assert.equal(app.location.hash,'#providers/new');
  assert.match(app.root.innerHTML,/data-mode="create"/);
  const form = app.form('provider',{alias:'main',base_url:'https://provider.example/v1',default_model:'model-two',key:'test-key'});
  form.dataset.mode='create';
  const save = app.submit(form);
  const request = app.next('/api/provider-credentials/main');
  assert.equal(request.options.method,'POST');
  await app.settle(request,{error:{message:'Подключение уже существует'}},409);
  await save;
  assert.equal(form.values.default_model,'model-two');
  assert.match(app.message.textContent,/уже существует/);
  assert.equal(app.location.hash,'#providers/new');
});

test('a provider editor deep link survives reload and a late editor response cannot replace help', async () => {
  const app = browserFixture(browserStorage(),'#providers/main/edit');
  await app.settle(app.next('/api/me'),operatorProfile);
  await app.settle(app.next('/api/provider-credentials'),connections);
  await app.ready;
  assert.match(app.root.innerHTML, /Подключение: main/);
  const editor = app.application.providerEditorPage('main');
  const pending = app.next('/api/provider-credentials');
  const help = app.application.helpPage();
  await app.settle(app.next('/api/downloads'),{files:[]});
  await help;
  await app.settle(pending,connections);
  await editor;
  assert.match(app.root.innerHTML, /<h1>Установка и помощь<\/h1>/);
});

test('workspace list has no metrics and language selections persist all checked values', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const home = app.application.home();
  await app.settle(app.next('/api/tenants'),{tenants:[],connections:connections.credentials,credentials:['main']});
  await home;
  assert.doesNotMatch(app.root.innerHTML,/class="metric"/);
  assert.doesNotMatch(app.root.innerHTML,/data-form="create"/);
  const create = app.application.newTenantPage();
  await app.settle(app.next('/api/tenants'),{tenants:[],connections:connections.credentials,credentials:['main']});
  await create;
  for (const code of ['bn','hi','zh']) assert.match(app.root.innerHTML,new RegExp(`name="languages" value="${code}" checked`));
  const form = app.form('settings',{languages:['ru','en','bn','hi','zh']},'A');
  const save = app.submit(form);
  const request = app.next('/api/tenants/A');
  assert.deepEqual(JSON.parse(request.options.body).languages,['ru','en','bn','hi','zh']);
  await app.settle(request,{ok:true});
  await save;
  await app.submit(app.form('settings',{languages:[]},'A'));
  assert.match(app.message.textContent,/Выберите хотя бы один язык/);
});

test('a successful profile response arriving after another request expires the session cannot reopen the cabinet', async () => {
  const app = browserFixture();
  const initial = app.next('/api/me');
  const refresh = app.application.start();
  const newer = app.pending.filter(request => request.path === '/api/me')[1];
  await app.settle(newer, {error: {message: 'Session expired'}}, 401);
  await refresh;
  assert.match(app.root.innerHTML, /Добро пожаловать/);
  await app.settle(initial, memberProfile);
  await app.ready;
  assert.match(app.root.innerHTML, /Добро пожаловать/);
  assert.doesNotMatch(app.root.innerHTML, /Вы вошли как/);
});

test('a profile refresh started before logout cannot restore the signed-out cabinet', async () => {
  const app = browserFixture();
  await app.signIn();
  const refresh = app.application.start();
  const profile = app.next('/api/me');
  const logout = app.click({action: 'logout'});
  assert.match(app.root.innerHTML, /Добро пожаловать/, 'logout hides private state before its network response');
  const logoutRequest = app.next('/api/logout');
  assert.equal(logoutRequest.options.headers['X-CSRF-Token'], 'csrf');
  await app.settle(logoutRequest, {ok: true});
  await logout;
  await app.settle(profile, memberProfile);
  await refresh;
  assert.match(app.root.innerHTML, /Добро пожаловать/);
  assert.doesNotMatch(app.root.innerHTML, /Вы вошли как/);
});

test('slower previous tenant response cannot replace a newer tenant form', async () => {
  const app = browserFixture();
  await app.signIn({...memberProfile, tenants: [{id: 'A', name: 'A', role: 'owner'}, {id: 'B', name: 'B', role: 'owner'}]});
  const first = app.application.openTenant('A');
  assert.doesNotMatch(app.root.innerHTML, /data-form="invite"/, 'old controls are removed synchronously');
  const second = app.application.openTenant('B');
  await app.settle(app.next('/api/tenants/B'), tenantDetails('B'));
  await second;
  await app.settle(app.next('/api/tenants/A'), tenantDetails('A'));
  await first;
  assert.match(app.root.innerHTML, /<h1>Organization B<\/h1>/);
  assert.match(app.root.innerHTML, /data-tenant-id="B"/);
  assert.doesNotMatch(app.root.innerHTML, /data-tenant-id="A"/);
});

test('opening tenant from dashboard loads actual connection options before rendering settings', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const open = app.application.openTenant('A', 'translation');
  await app.settle(app.next('/api/tenants/A'), tenantDetails('A'));
  assert.doesNotMatch(app.root.innerHTML, /data-form="settings"/);
  await app.settle(app.next('/api/provider-credentials'), {
    credentials: [{alias: 'managed', base_url: 'https://example.com/v1', default_model: 'chosen'}],
  });
  await open;
  assert.match(app.root.innerHTML, /<option value="managed" selected>managed<\/option>/);
  assert.match(app.root.innerHTML, /https:\/\/example.com\/v1/);
});

const wallet = {
  balance_cents: 10000, unit_price_cents: 500, currency: 'USD', period: '2026-10-01',
  pending_seats: 0, required_cents: 0, missing_cents: 0, entries: [],
};

async function openOperatorTenant(app, id = 'A') {
  const open = app.application.openTenant(id, 'billing');
  await app.settle(app.next(`/api/tenants/${id}`), tenantDetails(id, {billing: wallet}));
  await app.settle(app.next('/api/provider-credentials'), {credentials: []});
  await open;
}

test('tenant tabs retain their billing, usage and settings views after modular extraction', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  await openOperatorTenant(app);
  await app.click({action: 'section:billing'});
  assert.match(app.root.innerHTML, /Последние 50 операций/);
  assert.match(app.root.innerHTML, /Операций пока нет/);
  await app.click({action: 'section:usage'});
  assert.match(app.root.innerHTML, /Первый перевод ещё впереди/);
  await app.click({action: 'section:settings'});
  assert.match(app.root.innerHTML, /data-form="settings"/);
  assert.equal(app.message.textContent, '');
});

test('an ambiguous balance failure survives navigation and retries the identical operation key', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  await openOperatorTenant(app);
  const form = app.form('balance', {operation: 'credit', amount: '25.10', reason: 'INV-001'}, 'A');
  const first = app.submit(form);
  const attempted = app.next('/api/tenants/A/balance');
  assert.equal(attempted.options.headers['X-CSRF-Token'], 'csrf');
  await app.fail(attempted);
  await first;

  await openOperatorTenant(app);
  assert.match(app.root.innerHTML, /name="amount"[^>]*value="25\.10"/);
  assert.match(app.root.innerHTML, /name="reason"[^>]*value="INV-001"/);
  assert.match(app.root.innerHTML, /предыдущей операции/);

  const retryForm = app.form('balance', {operation: 'credit', amount: '25.10', reason: 'INV-001'}, 'A');
  const retry = app.submit(retryForm);
  const repeated = app.next('/api/tenants/A/balance');
  assert.deepEqual(JSON.parse(repeated.options.body), {
    operation: 'credit', amount_cents: 2510, reason: 'INV-001',
    idempotency_key: JSON.parse(attempted.options.body).idempotency_key,
  });
  await app.fail(repeated);
  await retry;
});

test('editing an ambiguous balance operation cannot mint a second credit or send concurrently', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const form = app.form('balance', {operation: 'credit', amount: '25.10', reason: 'INV-001'}, 'A');
  const first = app.submit(form);
  await app.submit(form);
  assert.equal(app.pending.filter(request => request.path.endsWith('/balance')).length, 1);
  await app.fail(app.next('/api/tenants/A/balance'));
  await first;
  form.values.amount = '30.00';
  await app.submit(form);
  assert.equal(app.pending.filter(request => request.path.endsWith('/balance')).length, 1);
  assert.match(app.message.textContent, /Новая операция пока не отправлена/);
});

test('reloading the tab restores the exact ambiguous operation and retries its persisted key only on submission', async () => {
  const storage = browserStorage();
  const first = browserFixture(storage);
  await first.signIn(operatorProfile);
  const values = {operation: 'credit', amount: '25.10', reason: 'INV-persisted'};
  const save = first.submit(first.form('balance', values, 'A'));
  const original = first.next('/api/tenants/A/balance');
  const sent = JSON.parse(original.options.body);
  assert.ok(original.savedAtSend.some(value => value.includes(sent.idempotency_key)),
    'the exact key is already durable when fetch begins');
  await first.fail(original);
  await save;

  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  await openOperatorTenant(reloaded);
  assert.match(reloaded.root.innerHTML, /value="INV-persisted"/);
  assert.equal(reloaded.pending.some(request => request.path.endsWith('/balance')), false);
  const retry = reloaded.submit(reloaded.form('balance', values, 'A'));
  const repeated = reloaded.next('/api/tenants/A/balance');
  assert.deepEqual(JSON.parse(repeated.options.body), sent);
  await reloaded.fail(repeated);
  await retry;
});

test('logout hides pending finance data, another user cannot reuse it, and the original user can resume later', async () => {
  const storage = browserStorage();
  const first = browserFixture(storage);
  await first.signIn(operatorProfile);
  const save = first.submit(first.form('balance', {operation: 'credit', amount: '10', reason: 'PRIVATE-invoice'}, 'A'));
  const original = first.next('/api/tenants/A/balance');
  await first.fail(original);
  await save;
  const logout = first.click({action: 'logout'});
  assert.doesNotMatch(first.root.innerHTML, /PRIVATE-invoice/);
  await first.settle(first.next('/api/logout'), {ok: true});
  await logout;

  const second = browserFixture(storage);
  await second.signIn({...operatorProfile, user: {...operatorProfile.user, id: 'other-user'}});
  await openOperatorTenant(second);
  assert.doesNotMatch(second.root.innerHTML, /PRIVATE-invoice/);
  const otherSave = second.submit(second.form('balance', {operation: 'credit', amount: '20', reason: 'Other invoice'}, 'A'));
  const otherRequest = second.next('/api/tenants/A/balance');
  assert.notEqual(JSON.parse(otherRequest.options.body).idempotency_key, JSON.parse(original.options.body).idempotency_key);
  await second.fail(otherRequest);
  await otherSave;

  const originalUser = browserFixture(storage);
  await originalUser.signIn(operatorProfile);
  await openOperatorTenant(originalUser);
  assert.match(originalUser.root.innerHTML, /value="PRIVATE-invoice"/);
  assert.doesNotMatch(originalUser.root.innerHTML, /value="Other invoice"/);
});

test('pending operations for two tenants retain independent requests and keys after a reload', async () => {
  const storage = browserStorage();
  const app = browserFixture(storage);
  await app.signIn(operatorProfile);
  const keys = [];
  for (const tenant of ['A', 'B']) {
    const save = app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: `Invoice for ${tenant}`}, tenant));
    const request = app.next(`/api/tenants/${tenant}/balance`);
    keys.push(JSON.parse(request.options.body).idempotency_key);
    await app.fail(request);
    await save;
  }
  assert.notEqual(keys[0], keys[1]);
  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  for (const tenant of ['A', 'B']) {
    await openOperatorTenant(reloaded, tenant);
    assert.match(reloaded.root.innerHTML, new RegExp(`value="Invoice for ${tenant}"`));
    assert.doesNotMatch(reloaded.root.innerHTML, new RegExp(`value="Invoice for ${tenant === 'A' ? 'B' : 'A'}"`));
  }
});

test('unavailable journal storage prevents a financial request while other pages continue working', async () => {
  const storage = {...browserStorage(), setItem() { throw new Error('Storage unavailable'); }};
  const app = browserFixture(storage);
  await app.signIn(operatorProfile);
  const attempted = app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: 'Paid invoice'}, 'A'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.pending.some(request => request.path.endsWith('/balance')), false);
  await attempted;
  assert.match(app.message.textContent, /[Жж]урнал|хранилищ/);
  const help = app.application.helpPage();
  await app.settle(app.next('/api/downloads'), {files: []});
  await help;
  assert.match(app.root.innerHTML, /<h1>Установка и помощь<\/h1>/);
});

test('a storage adapter that fails to retain the write cannot send a financial request', async () => {
  const storage = {...browserStorage(), setItem() {}};
  const app = browserFixture(storage);
  await app.signIn(operatorProfile);
  await app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: 'Paid invoice'}, 'A'));
  assert.equal(app.pending.some(request => request.path.endsWith('/balance')), false);
  assert.match(app.message.textContent, /Журнал финансовых операций недоступен/);
});

test('a confirmed balance operation is removed only after its updated tenant form loads', async () => {
  const storage = browserStorage();
  const app = browserFixture(storage);
  await app.signIn(operatorProfile);
  await openOperatorTenant(app);
  const save = app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: 'Confirmed invoice'}, 'A'));
  const request = app.next('/api/tenants/A/balance');
  await app.settle(request, {ok: true});
  assert.ok([...storage.values.values()].some(value => value.includes('Confirmed invoice')));
  await app.settle(app.next('/api/tenants/A'), tenantDetails('A', {billing: wallet}));
  await app.settle(app.next('/api/provider-credentials'), {credentials: []});
  await save;
  assert.ok([...storage.values.values()].every(value => !value.includes('Confirmed invoice')));

  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  await openOperatorTenant(reloaded);
  assert.doesNotMatch(reloaded.root.innerHTML, /value="Confirmed invoice"|предыдущей операции/);
});

test('a successful retry clears the journal of an earlier ambiguous operation', async () => {
  const storage = browserStorage();
  const values = {operation: 'credit', amount: '10', reason: 'Eventually confirmed invoice'};
  const first = browserFixture(storage);
  await first.signIn(operatorProfile);
  const attempted = first.submit(first.form('balance', values, 'A'));
  const request = first.next('/api/tenants/A/balance');
  await first.fail(request);
  await attempted;

  const retryApp = browserFixture(storage);
  await retryApp.signIn(operatorProfile);
  await openOperatorTenant(retryApp);
  const retry = retryApp.submit(retryApp.form('balance', values, 'A'));
  const retryRequest = retryApp.next('/api/tenants/A/balance');
  assert.deepEqual(JSON.parse(retryRequest.options.body), JSON.parse(request.options.body));
  await retryApp.settle(retryRequest, {ok: true});
  await retryApp.settle(retryApp.next('/api/tenants/A'), tenantDetails('A', {billing: wallet}));
  await retryApp.settle(retryApp.next('/api/provider-credentials'), {credentials: []});
  await retry;

  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  await openOperatorTenant(reloaded);
  assert.doesNotMatch(reloaded.root.innerHTML, /value="Eventually confirmed invoice"|предыдущей операции/);
});

for (const status of [409, 422]) {
  test(`a balance ${status} response ${status === 409 ? 'retains' : 'clears'} the persisted operation`, async () => {
    const storage = browserStorage();
    const app = browserFixture(storage);
    await app.signIn(operatorProfile);
    const save = app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: 'Rejected invoice'}, 'A'));
    const original = app.next('/api/tenants/A/balance');
    await app.settle(original, {error: {message: 'Rejected'}}, status);
    await save;

    const reloaded = browserFixture(storage);
    await reloaded.signIn(operatorProfile);
    await openOperatorTenant(reloaded);
    assert.equal(reloaded.root.innerHTML.includes('value="Rejected invoice"'), status === 409);
    assert.equal(reloaded.pending.some(request => request.path.endsWith('/balance')), false);
    if (status === 422) {
      const retry = reloaded.submit(reloaded.form('balance', {operation: 'credit', amount: '10', reason: 'Rejected invoice'}, 'A'));
      const request = reloaded.next('/api/tenants/A/balance');
      assert.notEqual(JSON.parse(request.options.body).idempotency_key, JSON.parse(original.options.body).idempotency_key);
      await reloaded.fail(request);
      await retry;
    }
  });
}

for (const status of [401, 403, 422]) {
  test(`a retry rejected with ${status} cannot discard an earlier operation whose response was lost`, async () => {
    const storage = browserStorage();
    const values = {operation: 'credit', amount: '10', reason: 'Potentially committed invoice'};
    const originalApp = browserFixture(storage);
    await originalApp.signIn(operatorProfile);
    const originalSave = originalApp.submit(originalApp.form('balance', values, 'A'));
    const originalRequest = originalApp.next('/api/tenants/A/balance');
    const originalBody = JSON.parse(originalRequest.options.body);
    // The browser cannot tell a lost response after commit from a failed send.
    await originalApp.fail(originalRequest);
    await originalSave;

    const retryApp = browserFixture(storage);
    await retryApp.signIn(operatorProfile);
    const retry = retryApp.submit(retryApp.form('balance', values, 'A'));
    const retryRequest = retryApp.next('/api/tenants/A/balance');
    assert.deepEqual(JSON.parse(retryRequest.options.body), originalBody);
    await retryApp.settle(retryRequest, {error: {message: 'Access or validation rejected'}}, status);
    await retry;

    const reloaded = browserFixture(storage);
    await reloaded.signIn(operatorProfile);
    await openOperatorTenant(reloaded);
    assert.match(reloaded.root.innerHTML, /value="Potentially committed invoice"/);
    assert.equal(reloaded.pending.some(request => request.path.endsWith('/balance')), false);
    const resumed = reloaded.submit(reloaded.form('balance', values, 'A'));
    const resumedRequest = reloaded.next('/api/tenants/A/balance');
    assert.deepEqual(JSON.parse(resumedRequest.options.body), originalBody);
    await reloaded.fail(resumedRequest);
    await resumed;
  });
}

test('a damaged journal is not discarded to allow a new financial request', async () => {
  const storage = browserStorage();
  const first = browserFixture(storage);
  await first.signIn(operatorProfile);
  const save = first.submit(first.form('balance', {operation: 'credit', amount: '10', reason: 'Original invoice'}, 'A'));
  await first.fail(first.next('/api/tenants/A/balance'));
  await save;
  const key = [...storage.values.keys()][0];
  storage.setItem(key, '{incomplete');

  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  await openOperatorTenant(reloaded);
  assert.match(reloaded.root.innerHTML, /Журнал финансовых операций недоступен/);
  await reloaded.submit(reloaded.form('balance', {operation: 'credit', amount: '10', reason: 'Original invoice'}, 'A'));
  assert.equal(reloaded.pending.some(request => request.path.endsWith('/balance')), false);
  assert.equal(storage.getItem(key), '{incomplete');
});

test('a journal read error leaves ordinary navigation available and finance closed', async () => {
  const storage = {...browserStorage(), getItem() { throw new Error('Blocked storage'); }};
  const app = browserFixture(storage);
  await app.signIn(operatorProfile);
  assert.match(app.root.innerHTML, /<h1>Обзор платформы<\/h1>/);
  await openOperatorTenant(app);
  assert.match(app.root.innerHTML, /Журнал финансовых операций недоступен/);
  await app.submit(app.form('balance', {operation: 'credit', amount: '10', reason: 'Paid invoice'}, 'A'));
  assert.equal(app.pending.some(request => request.path.endsWith('/balance')), false);
});

test('logout during a balance request keeps its journal when the late response cannot establish an outcome', async () => {
  const storage = browserStorage();
  const first = browserFixture(storage);
  await first.signIn(operatorProfile);
  const save = first.submit(first.form('balance', {operation: 'credit', amount: '10', reason: 'Late invoice'}, 'A'));
  const balance = first.next('/api/tenants/A/balance');
  const logout = first.click({action: 'logout'});
  await first.settle(first.next('/api/logout'), {ok: true});
  await logout;
  await first.settle(balance, {ok: true});
  await save;
  assert.match(first.root.innerHTML, /Добро пожаловать/);

  const reloaded = browserFixture(storage);
  await reloaded.signIn(operatorProfile);
  await openOperatorTenant(reloaded);
  assert.match(reloaded.root.innerHTML, /value="Late invoice"/);
  const retry = reloaded.submit(reloaded.form('balance', {operation: 'credit', amount: '10', reason: 'Late invoice'}, 'A'));
  const repeated = reloaded.next('/api/tenants/A/balance');
  assert.deepEqual(JSON.parse(repeated.options.body), JSON.parse(balance.options.body));
  await reloaded.fail(repeated);
  await retry;
});

test('member screens do not render management controls and escape organization and identity strings', async () => {
  const app = browserFixture();
  await app.signIn({
    ...memberProfile,
    user: {...memberProfile.user, name: '<img src=x onerror=alert(1)>'},
    tenants: [{id: 'A', name: '<script>private</script>', role: 'member', status: 'active'}],
  });
  assert.match(app.root.innerHTML, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(app.root.innerHTML, /<img src=x/);
  assert.doesNotMatch(app.root.innerHTML, /data-form="(?:create|admin|provider|balance)"/);
  const open = app.application.openTenant('A');
  await app.settle(app.next('/api/downloads'), {files: []});
  await open;
  assert.match(app.root.innerHTML, /Участниками и правилами управляет/);
  assert.doesNotMatch(app.root.innerHTML, /data-form="(?:invite|settings|balance)"/);
  assert.equal(app.pending.some(request => request.path === '/api/tenants/A'), false);
});

test('a submitted provider form keeps a blank key absent and does not navigate back from another page', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const form = app.form('provider', {
    alias: 'managed', key: '', base_url: 'https://provider.example/v1', default_model: 'chosen',
  });
  const save = app.submit(form);
  const request = app.next('/api/provider-credentials/managed');
  assert.deepEqual(JSON.parse(request.options.body), {
    base_url: 'https://provider.example/v1', default_model: 'chosen',
  });
  const help = app.application.helpPage();
  await app.settle(app.next('/api/downloads'), {files: []});
  await help;
  await app.settle(request, {ok: true});
  await save;
  assert.match(app.root.innerHTML, /<h1>Установка и помощь<\/h1>/);
  assert.doesNotMatch(app.root.innerHTML, /data-form="provider"/);
});

test('a current navigation failure shows its error instead of leaving an unexplained loading page', async () => {
  const app = browserFixture();
  await app.signIn();
  const help = app.click({action: 'help'});
  await app.settle(app.next('/api/downloads'), {error: {message: 'Downloads temporarily unavailable'}}, 503);
  await help;
  assert.equal(app.message.textContent, 'Downloads temporarily unavailable');
});

test('a delayed error from an earlier page cannot replace the current page error state', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const oldPage = app.click({action: 'provider'});
  const oldRequest = app.next('/api/provider-credentials');
  const newPage = app.click({action: 'help'});
  await app.settle(app.next('/api/downloads'), {files: []});
  await newPage;
  await app.settle(oldRequest, {error: {message: 'Old provider failure'}}, 503);
  await oldPage;
  assert.match(app.root.innerHTML, /<h1>Установка и помощь<\/h1>/);
  assert.notEqual(app.message.textContent, 'Old provider failure');
});

test('a failed initial dashboard cannot overwrite the error state after navigation elsewhere', async () => {
  const app = browserFixture();
  await app.settle(app.next('/api/me'), operatorProfile);
  const initialDashboard = app.next('/api/dashboard');
  const help = app.click({action: 'help'});
  await app.settle(app.next('/api/downloads'), {files: []});
  await help;
  await app.settle(initialDashboard, {error: {message: 'Old dashboard failure'}}, 503);
  await app.ready;
  assert.match(app.root.innerHTML, /<h1>Установка и помощь<\/h1>/);
  assert.notEqual(app.message.textContent, 'Old dashboard failure');
});

test('logout invalidates a profile even when its response body is still being decoded', async () => {
  const app = browserFixture();
  await app.signIn();
  const refresh = app.application.start();
  const request = app.next('/api/me');
  let finishBody;
  request.settled = true;
  request.resolve({ok: true, status: 200, json: () => new Promise(resolve => { finishBody = resolve; })});
  await new Promise(resolve => setImmediate(resolve));
  const logout = app.click({action: 'logout'});
  await app.settle(app.next('/api/logout'), {ok: true});
  await logout;
  finishBody(memberProfile);
  await refresh;
  assert.match(app.root.innerHTML, /Добро пожаловать/);
  assert.doesNotMatch(app.root.innerHTML, /Вы вошли как/);
});

test('a failed server logout still rejects a previously pending successful response', async () => {
  const app = browserFixture();
  await app.signIn();
  const refresh = app.application.start();
  const profile = app.next('/api/me');
  const logout = app.click({action: 'logout'});
  await app.fail(app.next('/api/logout'));
  await logout;
  assert.match(app.message.textContent, /Сервер не подтвердил выход/);
  await app.settle(profile, memberProfile);
  await refresh;
  assert.match(app.root.innerHTML, /Добро пожаловать/);
});

test('pricing lives outside the overview and remains restricted to platform administrators', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  assert.doesNotMatch(app.root.innerHTML, /data-form="price"/);
  const open = app.application.pricingPage();
  await app.settle(app.next('/api/billing-settings'), {unit_price_cents: 500});
  await open;
  assert.equal(app.location.hash, '#pricing');
  const save = app.submit(app.form('price', {price: '6.25'}));
  const request = app.next('/api/billing-settings');
  assert.equal(request.options.method, 'PUT');
  assert.deepEqual(JSON.parse(request.options.body), {unit_price_cents: 625});
  await app.settle(request, {ok: true});
  await app.settle(app.next('/api/billing-settings'), {unit_price_cents: 625});
  await save;
  assert.match(app.root.innerHTML, /value="6.25"/);

  const owner = browserFixture(browserStorage(), '#pricing');
  await owner.signIn(memberProfile);
  assert.equal(owner.location.hash, '#home');
  assert.equal(owner.pending.some(r => r.path === '/api/billing-settings'), false);
  assert.doesNotMatch(owner.root.innerHTML, /data-action="pricing"/);
});

test('tenant screens keep finance and limits out of the team and translation tasks', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  await openOperatorTenant(app);
  await app.click({action: 'section:team'});
  assert.match(app.root.innerHTML, /data-form="invite"/);
  assert.doesNotMatch(app.root.innerHTML, /data-form="balance"|class="metric"/);
  await app.click({action: 'section:translation'});
  assert.match(app.root.innerHTML, /data-languages/);
  assert.doesNotMatch(app.root.innerHTML, /name="(?:name|seats|rpm|amount)"/);
  await app.click({action: 'section:settings'});
  assert.match(app.root.innerHTML, /name="seats"/);
  assert.doesNotMatch(app.root.innerHTML, /data-languages|name="model"/);
});

test('leaving a dirty form can be cancelled or explicitly discarded, including browser history', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  const dirty = {dataset: {dirty: 'true'}};
  app.root.querySelector = selector => selector === 'form[data-dirty="true"]' && dirty.dataset.dirty ? dirty : null;
  app.root.querySelectorAll = () => [dirty];
  let close;
  app.message.addEventListener = (_event, handler) => { close = handler; };
  app.message.showModal = () => { app.message.open = true; };
  const help = app.application.helpPage();
  assert.equal(app.pending.some(r => r.path === '/api/downloads'), false);
  app.message.open = false;
  app.message.returnValue = 'cancel';
  close();
  await help;
  assert.equal(app.location.hash, '#dashboard');
  assert.equal(dirty.dataset.dirty, 'true');

  app.location.hash = '#help';
  const back = app.application.start();
  app.message.open = false;
  app.message.returnValue = 'cancel';
  close();
  await back;
  assert.equal(app.location.hash, '#dashboard');

  const leave = app.application.helpPage();
  app.message.open = false;
  app.message.returnValue = 'discard';
  close();
  await new Promise(resolve => setImmediate(resolve));
  await app.settle(app.next('/api/downloads'), {files: []});
  await leave;
  assert.equal(app.location.hash, '#help');
  assert.equal(dirty.dataset.dirty, undefined);
});

test('switching a tenant tab invalidates earlier writes so their refresh cannot replace the new tab', async () => {
  const app = browserFixture();
  await app.signIn(operatorProfile);
  await openOperatorTenant(app);
  const save = app.submit(app.form('settings', {name: 'Renamed'}, 'A'));
  const write = app.next('/api/tenants/A');
  await app.click({action: 'section:usage'});
  await app.settle(write, {ok: true});
  await save;
  assert.equal(app.location.hash, '#tenants/A/usage');
  assert.match(app.root.innerHTML, /Первый перевод ещё впереди/);
  assert.equal(app.pending.filter(r => r.path === '/api/tenants/A').length, 2);
});

test('organization owner and administrator keep their distinct UI permissions after regrouping', async () => {
  for (const role of ['owner', 'admin']) {
    const app = browserFixture();
    await app.signIn({...memberProfile, tenants: [{id: 'A', name: 'Team', role}]});
    const details = tenantDetails('A');
    details.tenant.role = role;
    details.billing = role === 'owner' ? wallet : null;
    const open = app.application.openTenant('A', 'team');
    await app.settle(app.next('/api/tenants/A'), details);
    await open;
    if (role === 'owner') assert.match(app.root.innerHTML, /data-action="section:billing"/);
    else {
      assert.doesNotMatch(app.root.innerHTML, /data-action="section:billing"/);
      assert.doesNotMatch(app.root.innerHTML, /<option value="(?:owner|admin)"/);
    }
    await app.click({action: 'section:translation'});
    assert.match(app.root.innerHTML, /data-languages/);
    assert.doesNotMatch(app.root.innerHTML, /name="(?:credential|model)"/);
    await app.click({action: 'section:settings'});
    assert.match(app.root.innerHTML, /name="name"/);
    assert.doesNotMatch(app.root.innerHTML, /name="(?:seats|rpm|status|access_until)"/);
    await app.click({action: 'section:billing'});
    assert.doesNotMatch(app.root.innerHTML, /data-form="balance"/);
  }
});
