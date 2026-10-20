import {createConsole} from './modules/console.js';

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
