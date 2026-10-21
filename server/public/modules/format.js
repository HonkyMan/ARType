import {t as tr, intlLocale} from './i18n.js';
const htmlEntities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};


export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
export const fmt = value => Number(value || 0).toLocaleString(intlLocale());
export const money = value => new Intl.NumberFormat(intlLocale(), {style:'currency',currency:'USD'}).format(Number(value || 0) / 100);

export function cents(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(tr('enter_an_amount_with_no_more_than_two_decimal_places'));
  }
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 9000000000000) {
    throw new Error(tr('the_amount_is_too_large'));
  }
  return result;
}

export const roles = {
  get owner() {return tr('workspace_owner');}, get admin() {return tr('workspace_administrator');},
  get member() {return tr('member');}, get operator() {return tr('platform_administrator');},
};
export const statuses = {
  get active() {return tr('active');}, get suspended() {return tr('suspended');}, get invited() {return tr('invited');}, get disabled() {return tr('disabled');},
  get success() {return tr('done');}, get failed() {return tr('failed');}, get pending() {return tr('pending');},
};
export const languages = {
  get ru() {return tr('russian');}, get en() {return tr('english');}, get bn() {return tr('bengali');},
  get hi() {return tr('hindi');}, get zh() {return tr('chinese');}, get es() {return tr('spanish_espa_ol');},
  get fr() {return tr('french_fran_ais');}, get ar() {return tr('arabic');},
  get pt() {return tr('portuguese_portugu_s');}, get id() {return tr('indonesian_indonesia');},
};
export const brand = '<a class="brand" href="/"><img src="/assets/artype-mark.svg" alt="">ARType</a>';
export const button = (text, action, classes = '') =>
  `<button type="button" class="${classes}" data-action="${action}">${text}</button>`;
export const tag = status => `<span class="tag ${esc(status)}">${esc(statuses[status] || status)}</span>`;
