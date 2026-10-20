import en from './locales/en.js';
import ru from './locales/ru.js';
export const catalogs = {en, ru};
export const supportedLocales = ['en','ru'];
const storageKey = 'artype.language';

export function detectLocale(languages = [], preference = null) {
  if (supportedLocales.includes(preference)) return preference;
  for (const language of languages) {
    const base = String(language).toLowerCase().split(/[-_]/)[0];
    if (supportedLocales.includes(base)) return base;
  }
  return 'en';
}
function initialLocale() {
  let preference;
  try {preference = (typeof window === 'undefined' ? null : window.localStorage)?.getItem(storageKey);} catch { /* Locale selection still works without storage. */ }
  return detectLocale(globalThis.navigator?.languages || [], preference);
}
let locale = initialLocale();
export const getLocale = () => locale;
export const intlLocale = () => locale === 'ru' ? 'ru-RU' : 'en-US';
export function setLocale(value, storage = undefined) {
  if (!supportedLocales.includes(value)) throw new Error('Unsupported locale');
  locale = value;
  let persisted = true;
  try {(storage ?? (typeof window === 'undefined' ? null : window.localStorage))?.setItem(storageKey,value);} catch {persisted = false;}
  if (globalThis.document) {
    document.documentElement.lang = value;
    document.cookie = `artype_language=${value}; Path=/; Max-Age=31536000; SameSite=Lax${globalThis.location?.protocol === 'https:' ? '; Secure' : ''}`;
  }
  return persisted;
}
export function translate(language, key, values = {}) {
  const entry = catalogs[language]?.[key] ?? en[key];
  if (entry === undefined) throw new Error('Unknown translation key: ' + key);
  const text = typeof entry === 'object' ? entry[new Intl.PluralRules(language).select(values.count)] ?? entry.other : entry;
  return text.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in values)) throw new Error('Missing translation value: ' + name);
    return String(values[name]);
  });
}
export const t = (key, values) => translate(locale,key,values);
export const dateTime = value => new Intl.DateTimeFormat(intlLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export const dateOnly = (value, options = {}) => new Intl.DateTimeFormat(intlLocale(),{dateStyle:'medium',...options}).format(new Date(value));
export function languageSelector() {
  return `<label class="locale-control">${t('interface_language')}<select data-locale aria-label="${t('interface_language')}"><option value="en" ${locale==='en'?'selected':''}>English</option><option value="ru" ${locale==='ru'?'selected':''}>Русский</option></select></label>`;
}
