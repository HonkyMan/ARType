import {button, esc} from '../format.js';
import {connectionFields, field, formSection, languageOptions, saveActions} from './components.js';

export function createTenantSettings({state}) {
  function createForm() {
    const {connections, defaultModel, credentials} = state;
    return `<section class="panel"><form class="panel-body" data-form="create">
      ${formSection('Организация и владелец', 'Владелец получит бесплатный доступ к кабинету. Подключение программы оплачивается отдельно.',
        field('Название организации', 'name', '', 'text', 'required maxlength="120" placeholder="Название продукта"') +
        field('Google email владельца', 'owner_email', '', 'email', 'required placeholder="lead@company.com"'))}
      ${formSection('Перевод', 'Выберите готовое подключение и языки команды. Всё это можно изменить позже.',
        connectionFields(state, connections[0]?.alias, connections[0]?.default_model || defaultModel) +
        languageOptions(['ru', 'en', 'bn', 'hi', 'zh']))}
      ${formSection('Лимиты организации', 'Это ограничения использования. Количество оплаченных мест зависит от подключённых сотрудников.',
        field('Максимум мест с программой', 'seats', 10, 'number', 'required min="1" max="100000"') +
        field('Символов в месяц', 'monthly_characters', 1000000, 'number', 'required min="1" max="1000000000000"'))}
      ${!credentials.length ? `<div class="notice">Сначала добавьте AI-подключение с ключом. ${button('Настроить подключение', 'provider', 'secondary small')}</div>` : ''}
      <div class="actions"><button type="submit" ${!credentials.length ? 'disabled' : ''}>Создать организацию</button>${button('Отмена', 'home', 'quiet')}</div>
      <p class="legal">Приглашение действует 7 дней. Письмо автоматически не отправляется: после создания передайте владельцу адрес кабинета.</p>
    </form></section>`;
  }

  function translationForm(t) {
    return `<section class="panel"><form class="panel-body" data-form="settings" data-tenant-id="${t.id}">
      ${formSection('Языки и терминология', 'Правила применяются к следующим переводам. Переустанавливать приложение не нужно.',
        languageOptions(t.languages) + `<label class="wide">Словарь и инструкции<textarea name="instructions" maxlength="8000" placeholder="Например: сохраняйте название продукта ARType без перевода.">${esc(t.instructions)}</textarea><small>Термины, названия продуктов и требования к стилю перевода.</small></label>`)}
      ${state.me.operator ? formSection('AI-подключение', 'Эти параметры доступны только администраторам платформы.',
        connectionFields(state, t.credential, t.model)) : ''}
      ${saveActions('Сохранить правила перевода')}
    </form></section>`;
  }

  function settingsForm(t) {
    const localDeadline = t.access_until
      ? new Date(new Date(t.access_until) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return `<section class="panel"><form class="panel-body" data-form="settings" data-tenant-id="${t.id}">
      ${formSection('Об организации', 'Название отображается в кабинете и приложении сотрудников.',
        field('Название организации', 'name', t.name, 'text', 'required maxlength="120"'))}
      ${state.me.operator ? formSection('Доступ и лимиты', 'Управляет администратор платформы. Приостановка организации блокирует переводы.',
        field('Максимум мест с программой', 'seats', t.seats, 'number', 'required min="1" max="100000"') +
        field('Символов в месяц', 'monthly_characters', t.monthly_characters, 'number', 'required min="1" max="1000000000000"') +
        `<label>Доступ к переводам<select name="status"><option value="active" ${t.status === 'active' ? 'selected' : ''}>Активен</option><option value="suspended" ${t.status === 'suspended' ? 'selected' : ''}>Приостановлен</option></select></label>` +
        field('Доступ до · ваше местное время', 'access_until', localDeadline, 'datetime-local') +
        '<p class="wide field-hint">Пустая дата означает доступ без ограничения по сроку.</p>') : ''}
      ${state.me.operator ? `<details class="advanced"><summary>Технические лимиты запросов</summary><div class="fields">
        ${field('Символов в одном запросе', 'max_text', t.max_text, 'number', 'required min="1" max="20000"')}
        ${field('Запросов в минуту', 'rpm', t.rpm, 'number', 'required min="1" max="10000"')}
        ${field('Одновременных переводов', 'concurrency', t.concurrency, 'number', 'required min="1" max="500"')}
      </div></details>` : ''}
      ${saveActions()}
    </form></section>`;
  }

  return {createForm, translationForm, settingsForm};
}
