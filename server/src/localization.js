import en from '../public/modules/locales/en.js';
import ru from '../public/modules/locales/ru.js';

export function requestLocale(req) {
  if (['en','ru'].includes(req.headers['x-artype-language'])) return req.headers['x-artype-language'];
  const cookie = /(?:^|;\s*)artype_language=(en|ru)(?:;|$)/.exec(req.headers.cookie || '');
  if (cookie) return cookie[1];
  const accepted = (req.headers['accept-language'] || '').split(',').map((item,index) => {
    const [language, weight] = item.trim().split(';q=');
    return {language:language.toLowerCase().split('-')[0],q:weight === undefined ? 1 : Number(weight),index};
  }).filter(item=>item.q>0).sort((a,b)=>b.q-a.q||a.index-b.index);
  return accepted.find(item=>['en','ru'].includes(item.language))?.language || 'en';
}
export function errorText(code, locale = 'en', params = {}) {
  const key = 'error_' + code;
  const text = (locale === 'ru' ? ru[key] : en[key]) || en[key] || en.error_request_failed;
  return text.replace(/\{(\w+)\}/g, (_,name)=>String(params[name] ?? ''));
}
