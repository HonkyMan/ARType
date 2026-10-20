import {button, esc, fmt, money, tag} from '../format.js';

export function createPlatformViews({state, shell}) {

function connectionForm(c,canManage) {
const existing=!!c.alias;return `<section class="panel">
      <div class="panel-head">
      <h2>${existing?esc(c.alias):'Новое подключение'}</h2><small>${existing?(c.source==='admin'?'Сохранено в кабинете':'Задано на сервере'):''}</small>
      </div>
      <form class="panel-body" data-form="provider">
      <div class="fields">
      <label>Название подключения<input name="alias" value="${esc(c.alias)}" ${existing?'readonly':''} required maxlength="64" pattern="[a-zA-Z0-9_-]+" placeholder="openrouter"><small>Выбирается в настройках организации.</small>
      </label>
      <label>Адрес API провайдера<input name="base_url" type="url" value="${esc(c.base_url)}" required maxlength="2048" placeholder="https://openrouter.ai/api/v1"><small>Базовый URL без /chat/completions.</small>
      </label>
      <label>Модель по умолчанию<input name="default_model" value="${esc(c.default_model)}" required maxlength="200" placeholder="google/gemma-3-4b-it">
      </label>
      <label>API-ключ<input name="key" type="password" autocomplete="new-password" ${existing?'':'required'} maxlength="4096"><small>${existing?'Оставьте пустым, чтобы сохранить текущий ключ.':'После сохранения значение не показывается.'}</small>
      </label>
      </div>${!canManage?'<div class="notice">На сервере нужно настроить CREDENTIAL_ENCRYPTION_KEY и пересоздать API.</div>':''}<div class="actions">
      <button ${!canManage?'disabled':''}>Сохранить подключение</button><small>Изменения применяются без перезапуска сервера.</small>
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
      <h2>Организации и активность</h2>${button('Обновить','dashboard','quiet small')}</div>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
      <th>ОРГАНИЗАЦИЯ</th>
      <th>МЕСТА</th>
      <th>АКТИВНОСТЬ ЗА МЕСЯЦ</th>
      <th>НАЧИСЛЕНО</th>
      <th>БАЛАНС</th>
      <th>
      </th>
      </tr>
      </thead>
      <tbody>${data.tenants.map(t=>`<tr>
      <td><strong>${esc(t.name)}</strong><br>${tag(t.status)}</td>
      <td>${t.billed_seats} оплачено<br><small>${t.connected_seats} включено</small>
      </td>
      <td>${fmt(t.requests)} переводов · ${fmt(t.active_users)} человек<br><small>${t.last_activity?'Последний: '+esc(new Date(t.last_activity).toLocaleString('ru-RU')):'Переводов пока нет'}</small>
      </td>
      <td>${money(t.invoice_amount_cents)}</td>
      <td>${money(t.balance_cents)}</td>
      <td>
      <button class="quiet small" data-tenant="${t.id}">Открыть</button>
      </td>
      </tr>`).join('')||'<tr><td colspan="6">Организаций пока нет.</td></tr>'}</tbody>
      </table>
      </div>
      </section>
      <section class="panel">
      <div class="panel-head">
      <h2>Стоимость места</h2>
      </div>
      <form class="panel-body" data-form="price">
      <div class="inline-form">
      <label>USD за человека в календарный месяц<input name="price" inputmode="decimal" value="${(data.unit_price_cents/100).toFixed(2)}" required>
      </label>
      <button>Сохранить ставку</button>
      </div>
      <p class="legal">Только для администраторов платформы. Ставка применяется к новым списаниям и продлениям. Уже оплаченные места сохраняют стоимость. Месяц считается по UTC; неполный месяц оплачивается полностью. Отключение не возвращает плату.</p>
      </form>
      </section>`,'Dashboard','Статистика организаций и начисления за календарный месяц UTC.',button('+ Подключить организацию','new-tenant'));
  }

  function provider(data) {
    const {connections, defaultModel} = state;
  shell(`<div class="notice">Подключение объединяет адрес API, ключ и модель по умолчанию. При создании организации выберите подключение и при необходимости измените модель. Замена адреса применяется ко всем организациям с этим подключением и требует повторного ввода ключа.</div>${connections.map(c=>connectionForm(c,data.can_manage)).join('')}${connectionForm({alias:'',base_url:data.provider_base_url,default_model:defaultModel},data.can_manage)}`,'AI-провайдер','Адреса, модели и ключи подключений — в настройках платформы.');
  }

  function admins(data) {
    const {me} = state;
  shell(`<div class="notice">Администраторы платформы управляют всеми организациями, AI-подключениями и другими администраторами платформы. Эта роль не связана с ролью администратора отдельной организации.</div>
      <section class="panel">
      <div class="panel-head">
      <h2>Доступ к платформе</h2>
      </div>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
      <th>GOOGLE EMAIL</th>
      <th>ДОСТУП</th>
      <th>ДЕЙСТВИЯ</th>
      </tr>
      </thead>
      <tbody>${data.administrators.map(a=>`<tr>
      <td>${esc(a.email)}</td>
      <td>${a.protected?'Основной администратор':'Администратор платформы'}</td>
      <td>${a.protected?'Защищён настройками сервера':a.email===me.user.email?'Ваш аккаунт':`<button class="quiet small danger" data-remove-admin="${esc(a.email)}">Отозвать права</button>`}</td>
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

  return {dashboard, provider, admins};
}
