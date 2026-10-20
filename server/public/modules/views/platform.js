import {button, esc, fmt, money, tag} from '../format.js';
import {searchBox, noMatches, saveActions} from './components.js';

export function createPlatformViews({state, shell}) {

function connectionForm(c,canManage) {
const existing=!!c.alias;return `<section class="panel connection-editor">
      <div class="panel-head"><h2>Параметры подключения</h2>
      ${existing?'<span class="tag active">Ключ сохранён</span>':''}</div>
      <form class="panel-body" data-form="provider" data-mode="${existing?'edit':'create'}">
      <div class="fields">
      <label>Название подключения<input name="alias" value="${esc(c.alias)}" ${existing?'readonly':''} required maxlength="64" pattern="[a-zA-Z0-9_-]+" placeholder="openrouter"><small>${existing?'Идентификатор используется организациями и не меняется.':'Латинские буквы, цифры, дефис и подчёркивание. Выбирается в настройках организации.'}</small>
      </label>
      <label>Адрес API провайдера<input name="base_url" type="url" value="${esc(c.base_url)}" required maxlength="2048" placeholder="https://openrouter.ai/api/v1"><small>Базовый URL без /chat/completions.</small>
      </label>
      <label>Модель по умолчанию<input name="default_model" value="${esc(c.default_model)}" required maxlength="200" placeholder="google/gemma-3-4b-it"><small>Подставляется при выборе подключения. У существующих организаций сохраняется их модель.</small>
      </label>
      <label>API-ключ<input name="key" type="password" autocomplete="new-password" ${existing?'':'required'} maxlength="4096"><small>${existing?'Пустое поле сохраняет текущий ключ. При смене адреса введите ключ заново.':'После сохранения значение не показывается.'}</small>
      </label>
      </div>${!canManage?'<div class="notice">На сервере нужно настроить CREDENTIAL_ENCRYPTION_KEY и пересоздать API.</div>':''}<div class="actions">
      <button ${!canManage?'disabled':''}>${existing?'Сохранить изменения':'Создать подключение'}</button>${button('Отмена','provider','quiet')}
      </div>
      <p class="legal">Ключ хранится на сервере в зашифрованном виде. Администраторы организаций и сотрудники не получают его.</p>
      </form>
      </section>`}

  function dashboard(data) {
  shell(`<div class="grid">
      <div class="metric">
      <div class="label">Организации</div>
      <div class="value">${data.tenants.length}</div>
      <div class="unit">${data.tenants.filter(t=>t.status==='active').length} активных</div>
      </div>
      <div class="metric">
      <div class="label">Оплаченные места · ${esc(data.period.slice(0,7))}</div>
      <div class="value">${fmt(data.billed_seats)}</div>
      <div class="unit">Один email в двух организациях — два места</div>
      </div>
      <div class="metric">
      <div class="label">Начислено за месяц</div>
      <div class="value">${money(data.invoice_amount_cents)}</div>
      <div class="unit">Списания за места; пополнения отдельно</div>
      </div>
      </div>
      <section class="panel">
      <div class="panel-head">
      <h2>Организации и активность</h2>${button('Обновить','dashboard','quiet small')}</div>${searchBox("Найти организацию")}
      <div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>ОРГАНИЗАЦИЯ</th>
      <th>МЕСТА</th>
      <th>АКТИВНОСТЬ ЗА МЕСЯЦ</th>
      <th>НАЧИСЛЕНО</th>
      <th>БАЛАНС</th>
      <th>ДЕЙСТВИЯ</th>
      </tr>
      </thead>
      <tbody>${data.tenants.map(t=>`<tr data-filter-item data-search="${esc(t.name)}">
      <td data-label="Организация"><strong>${esc(t.name)}</strong><br>${tag(t.status)}</td>
      <td data-label="Места">${t.billed_seats} оплачено<br><small>${t.connected_seats} включено</small>
      </td>
      <td data-label="Активность за месяц">${fmt(t.requests)} переводов · ${fmt(t.active_users)} человек<br><small>${t.last_activity?'Последний: '+esc(new Date(t.last_activity).toLocaleString('ru-RU')):'Переводов пока нет'}</small>
      </td>
      <td data-label="Начислено">${money(t.invoice_amount_cents)}</td>
      <td data-label="Баланс">${money(t.balance_cents)}</td>
      <td data-label="Действия">
      <button class="quiet small" data-tenant="${t.id}" aria-label="Открыть ${esc(t.name)}">Открыть</button>
      </td>
      </tr>`).join('')||'<tr><td colspan="6">Организаций пока нет.</td></tr>'}</tbody>
      </table>
      </div>
      ${noMatches}</section>
`,'Обзор платформы','Статистика организаций и начисления за календарный месяц UTC.',button('+ Создать организацию','new-tenant'));
  }

  function pricing(data) {
    shell(`      <section class="panel">
      <div class="panel-head">
      <h2>Стоимость места</h2>
      </div>
      <form class="panel-body" data-form="price">
      <div class="inline-form">
      <label>USD за человека в календарный месяц<input name="price" inputmode="decimal" value="${(data.unit_price_cents/100).toFixed(2)}" required>
      </label>

      </div>
      ${saveActions("Сохранить тариф")}
      <p class="legal">Только для администраторов платформы. Ставка применяется к новым списаниям и продлениям. Уже оплаченные места сохраняют стоимость. Месяц считается по UTC; неполный месяц оплачивается полностью. Отключение не возвращает плату.</p>
      </form>
      </section>`, 'Тариф платформы', 'Единая стоимость места для всех организаций.');
  }

  function provider(data) {
    const rows = data.credentials.map(c=>`<tr>
      <td data-label="Название"><strong>${esc(c.alias)}</strong><br><small>${c.source==='admin'?'Настроено в кабинете':'Настроено на сервере'}</small></td>
      <td data-label="Адрес API" class="connection-address">${esc(c.base_url)}</td>
      <td data-label="Модель по умолчанию" class="connection-model">${esc(c.default_model||'Не задана')}</td>
      <td data-label="API-ключ"><span class="tag active">Сохранён</span></td>
      <td data-label="Действия"><button class="quiet small" data-edit-provider="${esc(c.alias)}" aria-label="Редактировать ${esc(c.alias)}">Редактировать ↗</button></td>
      </tr>`).join('');
    shell(`<section class="panel">
      <div class="panel-head"><h2>Подключения</h2><span class="muted">${data.credentials.length}</span></div>
      ${rows?`<div class="table-wrap"><table class="connections-table" data-responsive role="table">
      <thead><tr><th>НАЗВАНИЕ</th><th>АДРЕС API</th><th>МОДЕЛЬ ПО УМОЛЧАНИЮ</th><th>API-КЛЮЧ</th><th>ДЕЙСТВИЯ</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`:`<div class="empty"><h2>Подключите первый AI-провайдер</h2><p>Укажите адрес API, модель и ключ. После этого подключение можно назначить организации.</p>${button('Создать подключение','provider-new')}</div>`}
      </section><p class="legal">Каждая организация использует выбранное подключение и свою модель. API-ключи доступны только серверу.</p>`,
      'AI-подключения','Подключения для перевода в ваших организациях.',button('+ Создать подключение','provider-new'));
  }

  function providerEditor(data, alias = null) {
    const connection = alias === null
      ? {alias:'', base_url:data.provider_base_url, default_model:data.default_model}
      : data.credentials.find(c=>c.alias===alias);
    if (!connection) {
      shell(`<div class="notice">Подключение не найдено. Оно могло быть удалено из настроек сервера.</div>${button('К списку подключений','provider','secondary')}`,
        'Подключение недоступно','Обновите список и выберите существующее подключение.');
      return;
    }
    shell(`${alias!==null?'<div class="notice">Изменение адреса API или ключа применяется ко всем организациям с этим подключением. Для нового адреса необходимо повторно ввести ключ.</div>':''}${connectionForm(connection,data.can_manage)}`,
      alias===null?'Новое подключение':`Подключение: ${alias}`,
      alias===null?'Добавьте AI-провайдера, чтобы назначать его организациям.':'Измените параметры и сохраните подключение.',
      button('← Все подключения','provider','quiet'));
  }

  function admins(data) {
    const {me} = state;
  shell(`<div class="notice">Администраторы платформы управляют всеми организациями, AI-подключениями и другими администраторами платформы. Эта роль не связана с ролью администратора отдельной организации.</div>
      <section class="panel">
      <div class="panel-head">
      <h2>Доступ к платформе</h2>
      </div>
      <div class="table-wrap">
      <table data-responsive role="table">
      <thead>
      <tr>
      <th>GOOGLE EMAIL</th>
      <th>ДОСТУП</th>
      <th>ДЕЙСТВИЯ</th>
      </tr>
      </thead>
      <tbody>${data.administrators.map(a=>`<tr>
      <td data-label="Google email">${esc(a.email)}</td>
      <td data-label="Доступ">${a.protected?'Основной администратор':'Администратор платформы'}</td>
      <td data-label="Действия">${a.protected?'Защищён настройками сервера':a.email===me.user.email?'Ваш аккаунт':`<button class="quiet small danger" data-remove-admin="${esc(a.email)}">Отозвать права</button>`}</td>
      </tr>`).join('')}</tbody>
      </table>
      </div>
      </section>
      <section class="panel">
      <div class="panel-head">
      <h2>Добавить администратора платформы</h2>
      </div>
      <form class="panel-body" data-form="admin">
      <div class="inline-form">
      <label>Google email сотрудника<input name="email" type="email" required maxlength="254" placeholder="colleague@company.com">
      </label>
      <button>Выдать права администратора</button>
      </div>
      <p class="legal">Права появятся после входа с этим Google-аккаунтом. Передайте сотруднику адрес кабинета; письмо автоматически не отправляется.</p>
      </form>
      </section>`,'Администраторы платформы','Доступ выдаётся и отзывается только администраторами платформы.');
  }

  return {dashboard, pricing, provider, providerEditor, admins};
}
