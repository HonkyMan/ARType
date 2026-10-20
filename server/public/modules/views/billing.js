import {button, esc, money} from '../format.js';

export function createBillingViews({state}) {
function walletContent(t,w) {
  const {me} = state;
if (!w) return '';
  const pending = state.pendingBalances.get(t.id);
  return `<section class="panel">
      <div class="panel-head">
      <div>
      <h2>Баланс организации</h2>
      <div class="balance-value">${money(w.balance_cents)}</div><small>${money(w.unit_price_cents)} за пользователя в месяц</small>
      </div>${'<button type="button" class="secondary" data-action="topup" aria-expanded="false" aria-controls="invoice-request">Запросить инвойс</button>'}</div>
      <div class="panel-body">${w.pending_seats?`<div class="notice">Ожидают оплаты: ${w.pending_seats}. Для подключения нужно ${money(w.required_cents)}, не хватает ${money(w.missing_cents)}. Программа у этих пользователей недоступна.</div>`:'<p>Неоплаченных подключённых пользователей нет.</p>'}<details class="explanation"><summary>Как рассчитывается оплата</summary><p>Владелец управляет кабинетом бесплатно. Оплата программы списывается отдельно в каждой организации. Повторное включение того же email в уже оплаченном месяце бесплатно. Первого числа продлеваются все включённые пользователи; при нехватке средств продление ожидает пополнения целиком. Уже оплаченный месяц сохраняется.</p></details>
      <form id="invoice-request" class="invoice-placeholder" data-form="invoice" hidden>
      <div class="notice">Онлайн-оплата пока не подключена. Сформируйте запрос и передайте администратору платформы для выставления инвойса.</div>
      <div class="inline-form">
      <label>Количество мест<input name="quantity" type="number" min="1" max="100000" value="${Math.max(1,w.pending_seats)}" required>
      </label>
      <button>Сформировать запрос</button>
      </div>
      <p data-invoice-text class="legal" role="status">
      </p>
      <button type="button" class="quiet small" data-action="copy-invoice" hidden>Скопировать запрос</button>
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
      <table data-responsive role="table">
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
      <td data-label="Дата">${esc(new Date(e.created_at).toLocaleString('ru-RU'))}</td>
      <td data-label="Операция">${({credit:'Пополнение',adjustment:'Корректировка',seat_charge:'Место за месяц'})[e.kind]}<br><small>${esc(e.actor_email||'Автосписание')}</small>
      </td>
      <td data-label="Сумма">${e.delta_cents>0?'+':''}${money(e.delta_cents)}</td>
      <td data-label="Остаток после">${money(e.balance_after)}</td>
      <td data-label="Основание">${esc(e.reason)}</td>
      </tr>`).join('')||'<tr><td colspan="5">Операций пока нет.</td></tr>'}</tbody>
      </table>
      </div>
      </section>`}


  return {walletContent, ledgerTable};
}
