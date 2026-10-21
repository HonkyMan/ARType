import {getLocale, t} from './modules/i18n.js';
import {createConsole} from './modules/console.js';

document.documentElement.lang = getLocale();
document.querySelector('#app').textContent = t('connecting_workspace');
const application = createConsole({
  document,
  fetch: (...arguments_) => window.fetch(...arguments_),
  location,
  history,
  navigator,
  FormData,
  crypto,
  setTimeout,
  sessionStorage: {
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
  },
});

void application.start();
window.addEventListener('popstate', () => {
  void application.start();
});
window.addEventListener('beforeunload', event => {
  if (document.querySelector('form[data-dirty="true"]')) {
    event.preventDefault();
    event.returnValue = '';
  }
});
