const htmlEntities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const dollars = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'USD'});

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
export const fmt = value => Number(value || 0).toLocaleString('ru-RU');
export const money = value => dollars.format(Number(value || 0) / 100);

export function cents(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('Введите сумму с точностью до цента.');
  }
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 9000000000000) {
    throw new Error('Слишком большая сумма.');
  }
  return result;
}

export const roles = {
  owner: 'Владелец организации', admin: 'Администратор организации',
  member: 'Участник', operator: 'Администратор платформы',
};
export const statuses = {
  active: 'Активен', suspended: 'Приостановлен', invited: 'Приглашён', disabled: 'Отключён',
  success: 'Готово', failed: 'Ошибка', pending: 'В процессе',
};
export const languages = {
  ru: 'Русский', en: 'English', zh: '中文', hi: 'हिन्दी', es: 'Español',
  fr: 'Français', ar: 'العربية', bn: 'বাংলা', pt: 'Português', id: 'Indonesia',
};
export const brand = '<a class="brand" href="/"><img src="/assets/artype-mark.svg" alt="">ARType</a>';
export const button = (text, action, classes = '') =>
  `<button type="button" class="${classes}" data-action="${action}">${text}</button>`;
export const tag = status => `<span class="tag ${esc(status)}">${esc(statuses[status] || status)}</span>`;
