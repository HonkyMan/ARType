import {esc, languages} from '../format.js';

export function field(label, name, value, type = 'text', attributes = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
}

export function formSection(title, description, content) {
  return `<fieldset class="form-section"><legend>${title}</legend><p>${description}</p><div class="fields">${content}</div></fieldset>`;
}

export function languageOptions(selected) {
  return `<fieldset class="language-picker wide" data-languages>
    <legend>Доступные языки</legend>
    <p>Сотрудники смогут выбирать эти языки в приложении.</p>
    <div class="language-options">${Object.entries(languages).map(([code, name]) => `<label>
      <input type="checkbox" name="languages" value="${code}" ${selected.includes(code) ? 'checked' : ''}>
      <span>${esc(name)}</span></label>`).join('')}</div>
    <small>Нужен хотя бы один язык.</small></fieldset>`;
}

export function connectionFields(state, selected, model) {
  const {connections} = state;
  return `<label>AI-подключение<select name="credential" required>${connections.map(c =>
    `<option value="${esc(c.alias)}" ${c.alias === selected ? 'selected' : ''}>${esc(c.alias)}</option>`).join('')}</select>
    <small data-connection-url>${esc(connections.find(c => c.alias === selected)?.base_url || '')}</small></label>
    ${field('Модель для этой организации', 'model', model, 'text', 'required maxlength="200"')}
    <p class="wide field-hint">При выборе подключения подставляется его модель по умолчанию. Вы можете указать другую модель.</p>`;
}

export function searchBox(label, placeholder = 'Поиск по названию') {
  return `<div class="table-toolbar"><label class="search-label">${label}
    <input type="search" data-filter placeholder="${placeholder}" autocomplete="off"></label>
    <span class="filter-count" data-filter-count role="status"></span></div>`;
}

export const noMatches = '<div class="empty" data-no-matches hidden><h3>Ничего не найдено</h3><p>Измените запрос или очистите поиск.</p></div>';

export function saveActions(label = 'Сохранить изменения') {
  return `<div class="actions form-actions"><button type="submit">${label}</button><span data-save-state role="status">Изменения ещё не внесены</span></div>`;
}
