import {t as tr, intlLocale} from '../i18n.js';
import {esc, languages} from '../format.js';

export function field(label, name, value, type = 'text', attributes = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
}

export function formSection(title, description, content) {
  return `<fieldset class="form-section"><legend>${title}</legend><p>${description}</p><div class="fields">${content}</div></fieldset>`;
}

export function languageOptions(selected) {
  return `<fieldset class="language-picker wide" data-languages>
    <legend>${tr('available_languages')}</legend>
    <p>${tr('members_can_choose_these_languages_in_the_app')}</p>
    <div class="language-options">${Object.entries(languages).map(([code, name]) => `<label>
      <input type="checkbox" name="languages" value="${code}" ${selected.includes(code) ? 'checked' : ''}>
      <span>${esc(name)}</span></label>`).join('')}</div>
    <small>${tr('at_least_one_language_is_required')}</small></fieldset>`;
}

export function connectionFields(state, selected, model) {
  const {connections} = state;
  return `<label>${tr('ai_connection')}<select name="credential" required>${!selected?`<option value="" disabled selected>${tr('choose_connection')}</option>`:''}${connections.map(c =>
    `<option value="${esc(c.alias)}" ${c.alias === selected ? 'selected' : ''}>${esc(c.alias)}</option>`).join('')}</select>
    <small data-connection-url>${esc(connections.find(c => c.alias === selected)?.base_url || '')}</small></label>
    ${field(tr('model_for_this_workspace'), 'model', model, 'text', 'required maxlength="200"')}
    <p class="wide field-hint">${tr('selecting_a_connection_fills_in_its_default_model_you_can_choose')}</p>`;
}

export function searchBox(label, placeholder = tr('search_by_name')) {
  return `<div class="table-toolbar"><label class="search-label">${label}
    <input type="search" data-filter placeholder="${placeholder}" autocomplete="off"></label>
    <span class="filter-count" data-filter-count role="status"></span></div>`;
}

export const noMatches = () => `<div class="empty" data-no-matches hidden><h3>${tr('no_matches')}</h3><p>${tr('change_your_query_or_clear_the_search')}</p></div>`;

export function saveActions(label = tr('save_changes')) {
  return `<div class="actions form-actions"><button type="submit">${label}</button><span data-save-state role="status">${tr('no_changes_yet')}</span></div>`;
}
