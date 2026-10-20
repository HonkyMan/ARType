import {button, esc, fmt, money, roles, languages, tag} from '../format.js';

export function createTenantViews({state, shell}) {

function createForm() {
  const {connections, defaultModel, credentials} = state;
return `<section class="panel" id="new-tenant">
      <div class="panel-head">
      <h2>Новая организация</h2>
      </div>
      <form class="panel-body" data-form="create">
      <div class="fields">
      <label>Название<input name="name" required maxlength="120" placeholder="Название продукта">
      </label>
      <label>Email владельца<input name="owner_email" type="email" required placeholder="lead@company.com">
      </label>
      <label>Модель провайдера<input name="model" value="${esc(connections[0]?.default_model||defaultModel)}" required placeholder="Идентификатор выбранной модели">
      </label>
      <label>Серверное подключение<select name="credential" required>${connectionOptions()}</select><small data-connection-url>${esc(connections[0]?.base_url||'Сначала создайте подключение в разделе AI-провайдер.')}</small>
      </label>
      <label>Мест<input name="seats" type="number" min="1" max="100000" value="10" required>
      </label>
      <label>Символов в месяц<input name="monthly_characters" type="number" min="1" max="1000000000000" value="1000000" required>
      </label>
      ${languageOptions(['ru', 'en', 'bn', 'hi', 'zh'])}
      </div>${!credentials.length?`<div class="notice">Сначала сохраните API-ключ в разделе «AI-провайдер». ${button('Подключить AI','provider','quiet small')}</div>`:''}<div class="actions">
      <button ${!credentials.length?'disabled':''}>Создать и пригласить владельца</button><small>Приглашение действует 7 дней.</small>
      </div>
      </form>
      </section>`}

function connectionOptions(selected) {
  const {connections} = state;
return connections.map(c=>`<option value="${esc(c.alias)}" ${c.alias===selected?'selected':''}>${esc(c.alias)}</option>`).join('')}

function walletContent(t,w) {
  const {me} = state;
if (!w) return '';
  const pending = state.pendingBalances.get(t.id);
  return `<section class="panel">
      <div class="panel-head">
      <div>
      <h2>Баланс организации</h2>
      <div class="balance-value">${money(w.balance_cents)}</div><small>${money(w.unit_price_cents)} за пользователя в месяц</small>
      </div>${button('Пополнить','topup','secondary')}</div>
      <div class="panel-body">${w.pending_seats?`<div class="notice">Ожидают оплаты: ${w.pending_seats}. Для подключения нужно ${money(w.required_cents)}, не хватает ${money(w.missing_cents)}. Программа у этих пользователей Disabled.</div>`:'<p>Неоплаченных подключённых пользователей нет.</p>'}<p class="legal">Владелец управляет кабинетом бесплатно. Оплата программы списывается за каждый tenant отдельно. Повторное включение того же email в уже оплаченном месяце бесплатно. Первого числа продлеваются все включённые пользователи; при нехватке средств продление ожидает пополнения целиком. Уже оплаченный месяц сохраняется.</p>
      <form class="invoice-placeholder" data-form="invoice" hidden>
      <div class="notice">Онлайн-оплата пока не подключена. Сформируйте запрос и передайте администратору платформы для выставления инвойса.</div>
      <div class="inline-form">
      <label>Количество мест<input name="quantity" type="number" min="1" max="100000" value="${Math.max(1,w.pending_seats)}" required>
      </label>
      <button>Сформировать запрос</button>
      </div>
      <p data-invoice-text class="legal">
      </p>
      </form>${me.operator?`<form class="balance-form" data-form="balance" data-tenant-id="${t.id}">
      <h3>Ручное начисление или корректировка</h3>${state.balanceJournalError?`<div class="notice">${esc(state.balanceJournalError)}</div>`:''}${pending?'<div class="notice">Результат предыдущей операции нужно подтвердить. Повторите её с сохранёнными значениями; повтор не начислит деньги дважды.</div>':''}<div class="fields">
      <label>Операция<select name="operation"><option value="credit" ${pending?.request.operation!=='set'?'selected':''}>Начислить сумму</option><option value="set" ${pending?.request.operation==='set'?'selected':''}>Установить итоговый баланс</option></select>
      </label>
      <label>Сумма, USD<input name="amount" inputmode="decimal" value="${esc(pending?(pending.request.amount_cents/100).toFixed(2):'')}" required placeholder="100.00">
      </label>
      <label class="wide">Основание / номер оплаченного инвойса<input name="reason" value="${esc(pending?.request.reason||'')}" required minlength="3" maxlength="500" placeholder="Оплачен инвойс INV-001">
      </label>
      </div>
      <div class="actions">
      <button>Записать операцию</button><small>Операция сохранится в истории. Ожидающие места оплатятся автоматически при достаточном балансе.</small>
      </div>
      </form>`:''}</div>
      </section>`}

function ledgerTable() {
  const {details} = state;
  const w = details.billing;
  if (!w) return '';
  return `<section class="panel">
      <div class="panel-head">
      <h2>Последние 50 операций</h2><small>USD · история не перезаписывается</small>
      </div>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
      <th>ДАТА</th>
      <th>ОПЕРАЦИЯ</th>
      <th>СУММА</th>
      <th>ОСТАТОК ПОСЛЕ</th>
      <th>ОСНОВАНИЕ</th>
      </tr>
      </thead>
      <tbody>${w.entries.map(e=>`<tr>
      <td>${esc(new Date(e.created_at).toLocaleString('ru-RU'))}</td>
      <td>${({credit:'Пополнение',adjustment:'Корректировка',seat_charge:'Место за месяц'})[e.kind]}<br><small>${esc(e.actor_email||'Автосписание')}</small>
      </td>
      <td>${e.delta_cents>0?'+':''}${money(e.delta_cents)}</td>
      <td>${money(e.balance_after)}</td>
      <td>${esc(e.reason)}</td>
      </tr>`).join('')||'<tr><td colspan="5">Операций пока нет.</td></tr>'}</tbody>
      </table>
      </div>
      </section>`}

function renderTenant() {
  const {details, section} = state;
const {tenant:t,members,usage:u}=details;const used=members.filter(m=>m.product_enabled&&(m.status==='active'||m.status==='invited'&&new Date(m.expires_at)>new Date())).length;
  const content=section==='settings'?settingsForm(t):section==='usage'?usageTable():section==='billing'?ledgerTable():teamTable(t,members);
  shell(`${walletContent(t,details.billing)}<div class="grid">
      <div class="metric">
      <div class="label">Места в команде</div>
      <div class="value">${used} <span class="unit">/ ${fmt(t.seats)}</span>
      </div>
      <div class="unit">Включая действующие приглашения</div>
      </div>
      <div class="metric">
      <div class="label">Символов за месяц · UTC</div>
      <div class="value">${fmt(u.characters)}</div>
      <div class="unit">из ${fmt(t.monthly_characters)} · ${Math.round(100*Number(u.characters)/Number(t.monthly_characters))}% лимита</div>
      </div>
      <div class="metric">
      <div class="label">Переводы за месяц</div>
      <div class="value">${fmt(u.requests)}</div>
      <div class="unit">${fmt(u.failures)} ошибок провайдера</div>
      </div>
      </div>
      <div class="notice">${tag(t.status)} &nbsp; Изменения правил применяются к следующему переводу. ${t.access_until?'Доступ до '+esc(new Date(t.access_until).toLocaleDateString('ru-RU'))+'.':''}</div>
      <div class="section-tabs">${['team','settings','usage',...(details.billing?['billing']:[])].map((s,i)=>button(['Команда','Правила перевода','Использование','История баланса'][i],`section:${s}`,s===section?'selected':'')).join('')}</div>${content}`,t.name,'Рабочее пространство · '+roles[t.role],`<a class="button secondary" href="/api/tenants/${t.id}/usage.csv">↓ Экспорт CSV</a>`);
}

function appTag(m) {
return m.app_status==='active'?'<span class="tag active">Active · оплачено</span>':m.app_status==='management_only'?'<span class="tag">Только кабинет</span>':`<span class="tag disabled">Disabled · ${m.app_status==='awaiting_payment'?'ожидает оплаты':m.app_status==='suspended'?'организация приостановлена':'отключён'}</span>`}

function teamTable(t,members) {
return `<section class="panel">
      <div class="panel-head">
      <h2>Участники команды</h2><span class="muted">${members.length}</span>
      </div>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
      <th>СОТРУДНИК</th>
      <th>РОЛЬ</th>
      <th>ПРИГЛАШЕНИЕ</th>
      <th>ПРОГРАММА</th>
      <th>ДЕЙСТВИЯ</th>
      </tr>
      </thead>
      <tbody>${members.map(m=>`<tr>
      <td><strong>${esc(m.email)}</strong>${m.status==='invited'?`<br><small>${new Date(m.expires_at)>new Date()?'Приглашение до':'Истекло'} ${new Date(m.expires_at).toLocaleDateString('ru-RU')}</small>`:''}${m.paid_until?`<br><small>Оплачено до ${new Date(m.paid_until).toLocaleDateString('ru-RU',{timeZone:'UTC'})}</small>`:''}</td>
      <td>${roles[m.role]}</td>
      <td>${tag(m.status)}</td>
      <td>${appTag(m)}</td>
      <td>
      <div class="row-actions">${t.role==='admin'&&m.role!=='member'?'—':`<select aria-label="Роль ${esc(m.email)}" data-role-member="${m.id}" data-role-tenant="${t.id}">${Object.entries(roles).filter(([r])=>r!=='operator'&&(t.role!=='admin'||r==='member')).map(([r,v])=>`<option value="${r}" ${m.role===r?'selected':''}>${v}</option>`).join('')}</select>
      <button class="quiet small" data-product-member="${m.id}" data-member-tenant="${t.id}" data-product="${!m.product_enabled}">${m.product_enabled?'Отключить программу':'Подключить программу'}</button>${m.role==='owner'?'':`<button class="quiet small" data-member="${m.id}" data-member-tenant="${t.id}" data-status="${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?'invited':'disabled'}">${m.status==='disabled'||m.status==='invited'&&new Date(m.expires_at)<=new Date()?'Пригласить снова':'Отключить доступ'}</button>`}`}</div>
      </td>
      </tr>`).join('')}</tbody>
      </table>
      </div>
      </section>
      <section class="panel">
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
      <p class="legal actions">Администратор организации управляет только своей командой. Владелец получает кабинет бесплатно; чтобы пользоваться программой, он подключает себя кнопкой в таблице. Для остальных ролей место оплачивается за полный месяц. При нехватке средств программа остаётся Disabled до пополнения баланса. Приглашение действует 7 дней; письмо автоматически не отправляется.</p>${button('Скопировать адрес кабинета','copy-url','quiet small')}</form>
      </section>`}

function field(label,name,value,type='text',more='') {
return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${more}>
      </label>`}

function languageOptions(selected) {
  return `<fieldset class="language-picker wide" data-languages>
      <legend>Языки перевода</legend>
      <p>Выбранные языки будут доступны сотрудникам в настройках ARType.</p>
      <div class="language-options">${Object.entries(languages).map(([code, name])=>`<label>
      <input type="checkbox" name="languages" value="${code}" ${selected.includes(code)?'checked':''}>
      <span>${esc(name)}</span></label>`).join('')}</div>
      <small>Выберите хотя бы один язык. Изменения появятся при обновлении настроек организации в программе.</small>
      </fieldset>`;
}

function settingsForm(t) {
  const {me, connections} = state;
return `<section class="panel">
      <div class="panel-head">
      <h2>Корпоративные правила</h2><span class="muted">Версия ${t.revision}</span>
      </div>
      <form class="panel-body" data-form="settings" data-tenant-id="${t.id}">
      <div class="fields">${field('Название','name',t.name,'text','required maxlength="120"')}${languageOptions(t.languages)}
      <label class="wide">Словарь и инструкции для перевода<textarea name="instructions" maxlength="8000">${esc(t.instructions)}</textarea><small>Терминология, имена продуктов и пожелания по переводу.</small>
      </label>${me.operator?`${field('Модель','model',t.model,'text','required maxlength="200"')}<label>Серверное подключение<select name="credential" required>${connectionOptions(t.credential)}</select><small data-connection-url>${esc(connections.find(c=>c.alias===t.credential)?.base_url||'')}</small>
      </label>${field('Количество мест','seats',t.seats,'number','required min="1" max="100000"')}${field('Символов в месяц','monthly_characters',t.monthly_characters,'number','required min="1" max="1000000000000"')}${field('Символов в одном запросе','max_text',t.max_text,'number','required min="1" max="20000"')}${field('Запросов в минуту','rpm',t.rpm,'number','required min="1" max="10000"')}${field('Одновременных переводов','concurrency',t.concurrency,'number','required min="1" max="500"')}${field('Доступ до (необязательно)','access_until',t.access_until?new Date(new Date(t.access_until)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local')}<label>Статус<select name="status"><option value="active" ${t.status==='active'?'selected':''}>Активен</option><option value="suspended" ${t.status==='suspended'?'selected':''}>Приостановлен</option></select>
      </label>`:''}</div>
      <div class="actions">
      <button>Сохранить правила</button><small>Сотрудникам не нужно переустанавливать приложение.</small>
      </div>
      </form>
      </section>`}

function usageTable() {
  const {details} = state;
const rs=details.recent;return `<section class="panel">
      <div class="panel-head">
      <h2>Последние 30 запросов</h2><small>Тексты не сохраняются</small>
      </div>${rs.length?`<div class="table-wrap">
      <table>
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
      <td>${esc(new Date(r.created_at).toLocaleString('ru-RU'))}</td>
      <td>${esc(r.email)}</td>
      <td>${fmt(r.characters)}</td>
      <td>${fmt(r.duration_ms)}</td>
      <td>${tag(r.status)}</td>
      </tr>`).join('')}</tbody>
      </table>
      </div>`:'<div class="empty"><h2>Первый перевод ещё впереди</h2><p>Установите приложение и выполните перевод — здесь появится техническая статистика.</p></div>'}</section>`}

  function home() {
    const {me, organizations} = state;
  const cards=organizations.map(t=>`<div class="org-card">
      <div>
      <h3>${esc(t.name)} &nbsp; ${tag(t.status)}</h3>
      <p>${me.operator?`${fmt(t.used_seats)} из ${fmt(t.seats)} мест · ${fmt(t.used_characters)} символов в этом месяце`:roles[t.role]}</p>
      </div>
      <button class="secondary small" data-tenant="${t.id}">Открыть пространство ↗</button>
      </div>`).join('');
  shell(`<section class="panel">
      <div class="panel-head">
      <h2>Ваши организации</h2><span class="muted">${organizations.length}</span>
      </div>${cards||'<div class="empty"><h2>Пока нет рабочих пространств</h2><p>Попросите администратора пригласить вас по адресу '+esc(me.user.email)+'. Затем обновите страницу.</p>'+button('Обновить доступ','refresh','secondary')+'</div>'}</section>${me.operator?createForm():''}`,'Рабочие пространства','Команды, доступ и правила перевода — в одном месте.',me.operator?button('+ Подключить организацию','new-tenant'):'');
  }

  return {home, renderTenant, createForm};
}
