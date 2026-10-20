import {button, esc, fmt, money, roles, tag} from '../format.js';
import {createBillingViews} from './billing.js';
import {createTenantSettings} from './tenant-settings.js';
import {searchBox, noMatches} from './components.js';

export function createTenantViews({state, shell}) {
  const {walletContent, ledgerTable} = createBillingViews({state});
  const {createForm, translationForm, settingsForm} = createTenantSettings({state});

  function renderTenant() {
    const {details, section} = state;
    const {tenant: t, members, usage: u, billing} = details;
    const used = members.filter(m => m.product_enabled && (m.status === 'active' || m.status === 'invited' && new Date(m.expires_at) > new Date())).length;
    const tabs = [['team', 'Команда'], ['translation', 'Перевод'], ...(billing ? [['billing', 'Баланс и оплата']] : []), ['usage', 'Использование'], ['settings', 'Настройки']];
    const navigation = `<nav class="section-tabs" aria-label="Разделы организации">${tabs.map(([key, title]) =>
      `<button type="button" data-action="section:${key}" class="${key === section ? 'selected' : ''}" ${key === section ? 'aria-current="page"' : ''}>${title}</button>`).join('')}</nav>`;
    const expired = t.access_until && new Date(t.access_until) <= new Date();
    const status = t.status !== 'active' || expired
      ? `<div class="notice warning">${expired ? 'Срок доступа организации истёк.' : 'Организация приостановлена.'} Переводы недоступны. Обратитесь к администратору платформы.</div>`
      : t.access_until ? `<p class="legal">Доступ к переводам до ${esc(new Date(t.access_until).toLocaleString('ru-RU'))}.</p>` : '';
    let content;
    if (section === 'billing') content = billing ? walletContent(t, billing) + ledgerTable() : '<div class="notice">Баланс доступен владельцу организации и администраторам платформы.</div>';
    else if (section === 'settings') content = settingsForm(t);
    else if (section === 'translation') content = translationForm(t);
    else if (section === 'usage') content = `<div class="grid">
      <div class="metric"><div class="label">Символов за месяц · UTC</div><div class="value">${fmt(u.characters)}</div><div class="unit">из ${fmt(t.monthly_characters)}</div></div>
      <div class="metric"><div class="label">Переводы за месяц</div><div class="value">${fmt(u.requests)}</div><div class="unit">Все запросы команды</div></div>
      <div class="metric"><div class="label">Ошибки провайдера</div><div class="value">${fmt(u.failures)}</div><div class="unit">За текущий месяц</div></div>
      </div>${usageTable()}`;
    else content = `<div class="context-strip"><span>Подключено к программе: <strong>${used} из ${fmt(t.seats)}</strong></span>${billing ? `<button type="button" class="quiet small" data-action="section:billing">Баланс: ${money(billing.balance_cents)} →</button>` : ''}</div>
      ${billing?.pending_seats ? `<div class="notice warning">Ожидают оплаты: ${billing.pending_seats}. Не хватает ${money(billing.missing_cents)}. ${button('Перейти к оплате', 'section:billing', 'quiet small')}</div>` : ''}${teamTable(t, members)}`;
    shell(`${navigation}${status}${content}`, t.name, roles[t.role] || 'Администратор платформы',
      section === 'team' ? button('+ Пригласить сотрудника', 'invite-focus') : section === 'usage' ? `<a class="button secondary" href="/api/tenants/${t.id}/usage.csv">Скачать статистику CSV</a>` : '');
  }

function appTag(m) {
return m.app_status==='active'?'<span class="tag active">Active · оплачено</span>':m.app_status==='management_only'?'<span class="tag">Только кабинет</span>':`<span class="tag disabled">Disabled · ${m.app_status==='awaiting_payment'?'ожидает оплаты':m.app_status==='suspended'?'организация приостановлена':'отключён'}</span>`}

function teamTable(t,members) {
return `<section class="panel">
      <div class="panel-head">
      <h2>Участники команды</h2><span class="muted">${members.length}</span>
      </div>
      ${searchBox("Найти сотрудника", "Google email")}<div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>СОТРУДНИК</th>

      <th>ДОСТУП В КАБИНЕТ</th>
      <th>ПРОГРАММА</th>
      <th>ДЕЙСТВИЯ</th>
      </tr>
      </thead>
      <tbody>${members.map(m=>`<tr data-filter-item data-search="${esc(m.email)}">
      <td data-label="Сотрудник" class="member-identity"><strong>${esc(m.email)}</strong>${m.status==='invited'?`<br><small>${new Date(m.expires_at)>new Date()?'Приглашение до':'Истекло'} ${new Date(m.expires_at).toLocaleDateString('ru-RU')}</small>`:''}${m.paid_until?`<br><small>Оплачено до ${new Date(m.paid_until).toLocaleDateString('ru-RU',{timeZone:'UTC'})}</small>`:''}</td>

      <td data-label="Доступ в кабинет">${tag(m.status)}</td>
      <td data-label="Программа">${appTag(m)}</td>
      <td data-label="Роль и действия">
      <div class="row-actions">${t.role==='admin'&&m.role!=='member'?roles[m.role]:`<select aria-label="Роль ${esc(m.email)}" data-role-member="${m.id}" data-role-tenant="${t.id}">${Object.entries(roles).filter(([r])=>r!=='operator'&&(t.role!=='admin'||r==='member')).map(([r,v])=>`<option value="${r}" ${m.role===r?'selected':''}>${v}</option>`).join('')}</select>
      <button class="quiet small" data-product-member="${m.id}" data-member-tenant="${t.id}" data-product="${!m.product_enabled}">${m.product_enabled?'Отключить программу':'Подключить программу'}</button>${m.role==='owner'?'':`<button class="quiet small danger" data-member="${m.id}" data-member-tenant="${t.id}" data-status="${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?'invited':'disabled'}">${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?'Пригласить снова':'Отключить доступ'}</button>`}`}</div>
      </td>
      </tr>`).join('')}</tbody>
      </table>
      </div>${noMatches}
      </section>
      <section class="panel" id="invite-member">
      <div class="panel-head">
      <h2>Пригласить сотрудника</h2>
      </div>
      <form class="panel-body" data-form="invite" data-tenant-id="${t.id}">
      <div class="inline-form">
      <label>Google email<input type="email" name="email" placeholder="colleague@company.com" required>
      </label>
      <label class="role">Роль<select name="role">${['member',...(t.role!=='admin'?['admin','owner']:[])].map(r=>`<option value="${r}">${roles[r]}</option>`).join('')}</select>
      </label>
      <button>Добавить в команду</button>
      </div>
      <details class="explanation"><summary>Роли, оплата и приглашения</summary><p>Администратор организации управляет только своей командой. Владелец получает кабинет бесплатно; чтобы пользоваться программой, он подключает себя кнопкой в таблице. Для остальных ролей место оплачивается за полный месяц. При нехватке средств программа недоступна до пополнения баланса. Приглашение действует 7 дней; письмо автоматически не отправляется.</p></details>${button('Скопировать адрес кабинета','copy-url','quiet small')}</form>
      </section>`}

function usageTable() {
  const {details} = state;
const rs=details.recent;return `<section class="panel">
      <div class="panel-head">
      <h2>Последние 30 запросов</h2><small>Тексты не сохраняются</small>
      </div>${rs.length?`<div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>ВРЕМЯ</th>
      <th>СОТРУДНИК</th>
      <th>СИМВОЛЫ</th>
      <th>ВРЕМЯ, МС</th>
      <th>СТАТУС</th>
      </tr>
      </thead>
      <tbody>${rs.map(r=>`<tr>
      <td data-label="Время">${esc(new Date(r.created_at).toLocaleString('ru-RU'))}</td>
      <td data-label="Сотрудник">${esc(r.email)}</td>
      <td data-label="Символы">${fmt(r.characters)}</td>
      <td data-label="Время, мс">${fmt(r.duration_ms)}</td>
      <td data-label="Статус">${tag(r.status)}</td>
      </tr>`).join('')}</tbody>
      </table>
      </div>`:'<div class="empty"><h2>Первый перевод ещё впереди</h2><p>Установите приложение и выполните перевод — здесь появится техническая статистика.</p></div>'}</section>`}


  function home() {
    const {me, organizations} = state;
    const cards = organizations.map(t => `<article class="org-card" data-filter-item data-search="${esc(t.name)}">
      <div><h3>${esc(t.name)} ${tag(t.status)}</h3>
      <p>${me.operator ? `${fmt(t.used_seats)} из ${fmt(t.seats)} мест · ${fmt(t.used_characters)} символов за месяц` : roles[t.role]}</p></div>
      <button type="button" class="secondary small" data-tenant="${t.id}" aria-label="Открыть ${esc(t.name)}">Открыть →</button></article>`).join('');
    shell(`<section class="panel"><div class="panel-head"><h2>Организации</h2><span class="muted">${organizations.length}</span></div>
      ${cards ? searchBox('Найти организацию') + cards + noMatches : `<div class="empty"><h2>Организаций пока нет</h2><p>${me.operator ? 'Создайте организацию, назначьте владельца и подключение для перевода.' : 'Попросите администратора пригласить вас по адресу ' + esc(me.user.email) + '.'}</p>${button(me.operator ? 'Создать организацию' : 'Обновить доступ', me.operator ? 'new-tenant' : 'refresh', 'secondary')}</div>`}
      </section>`, 'Организации', 'Команды, доступ к программе и правила перевода.', me.operator ? button('+ Создать организацию', 'new-tenant') : '');
  }

  function newTenant() {
    shell(createForm(), 'Новая организация', 'Три шага: владелец, перевод и лимиты.', button('← Все организации', 'home', 'quiet'));
  }

  return {home, newTenant, renderTenant};
}
