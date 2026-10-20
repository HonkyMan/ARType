import {brand, button, esc} from '../format.js';

export function createShell({state, document, setTimeout}) {
  const root = document.querySelector('#app');
  let toastVersion = 0;

  function toast(text) {
    const version = ++toastVersion;
    const target = document.querySelector('#toast');
    target.textContent = text;
    target.hidden = false;
    setTimeout(() => { if (version === toastVersion) target.hidden = true; }, 6000);
  }

  function showError(error) {
    let target = document.querySelector('#page-error');
    if (!target) {
      target = document.createElement('div');
      target.id = 'page-error';
      target.className = 'error';
      document.querySelector('main')?.prepend(target);
    }
    target.textContent = error.message;
    target.hidden = false;
    target.focus?.();
    toast(error.message);
  }

  const hasUnsavedChanges = () => !!root.querySelector('form[data-dirty="true"]');

  function confirmDiscard() {
    const dialog = document.querySelector('#discard-dialog');
    if (dialog.open) return Promise.resolve(false);
    return new Promise(resolve => {
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => {
        const discard = dialog.returnValue === 'discard';
        if (discard) root.querySelectorAll('form[data-dirty]').forEach(form => delete form.dataset.dirty);
        resolve(discard);
      }, {once: true});
      dialog.showModal();
    });
  }

function login() {
  document.title = 'Вход · ARType';
  root.innerHTML=`<div class="login">
      <section class="login-art">${brand}<div class="hero">
      <div class="eyebrow">Язык больше не барьер</div>
      <h1>Ваши мысли.<br>На любом языке.</h1>
      <p>Переводите и редактируйте текст прямо там, где работаете.</p>
      <div class="key-demo">
      <div class="line"><span>Выделили → перевели</span><kbd>⌥ / Alt + D</kbd>
      </div>
      <div class="line"><span>Написали → заменили</span><kbd>⌥ / Alt + R</kbd>
      </div>
      </div>
      </div>
      <footer>ARType · Рабочий язык вашей команды</footer>
      </section>
      <main class="login-form">
      <div class="login-content">
      <div class="eyebrow">Рабочее пространство</div>
      <h1>Добро пожаловать</h1>
      <p>Войдите с Google-аккаунтом, на который вас пригласили в организацию.</p>
      <div id="page-error" class="error" hidden>
      </div>
      <button class="google" data-action="login"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 5.9Z"/></svg>Продолжить с Google</button>
      <p class="legal">Вход подтверждает вашу личность. Доступ к команде выдаёт её администратор.</p>
      <p class="legal">В переводе участвуют сервер вашей организации и AI-провайдер. Тексты переводов не сохраняются в кабинете.</p>
      </div>
      </main>
      </div>`;
}

function shell(content,title,description,actions='') {
  const {me, current, section} = state;

  if (!me) return;
  const nav = (label, action, selected) => `<button type="button" class="navitem ${selected ? 'active' : ''}" data-action="${action}" ${selected ? 'aria-current="page"' : ''}>${label}</button>`;
  document.title = `${title} · ARType`;
  root.innerHTML=`<div class="shell">
      <a class="skip-link" href="#main-content">Перейти к содержимому</a>
      <aside class="sidebar"><div class="sidebar-header">${brand}<button type="button" class="mobile-menu quiet" data-action="toggle-menu" aria-expanded="false" aria-controls="main-navigation">Меню</button></div>
      <nav id="main-navigation" aria-label="Основная навигация"><div class="nav-group"><div class="eyebrow">Работа</div>
      ${me.operator ? nav('Обзор платформы', 'dashboard', section === 'dashboard') : ''}
      ${nav('Организации', 'home', ['home', 'new-tenant'].includes(section))}
      ${me.tenants.map(t=>`<button type="button" class="navitem tenant-nav ${current===t.id?'active':''}" data-tenant="${t.id}" ${current===t.id?'aria-current="page"':''}>${esc(t.name)}</button>`).join('')}</div>
      ${me.operator ? `<div class="nav-group"><div class="eyebrow">Настройки платформы</div>
      ${nav('AI-подключения', 'provider', section.startsWith('provider'))}
      ${nav('Тариф', 'pricing', section === 'pricing')}
      ${nav('Администраторы', 'admins', section === 'admins')}</div>` : ''}
      <div class="nav-group">${nav('Установка и помощь', 'help', section === 'help')}</div></nav>
      <footer><span>Вы вошли как</span>
      <div class="identity"><span class="avatar">${esc(me.user.name.slice(0,1))}</span>
      <div>${esc(me.user.name)}<br><small>${esc(me.user.email)}</small>
      </div>
      </div>${button('Выйти','logout','quiet small')}</footer>
      </aside>
      <main class="workspace" id="main-content" tabindex="-1">
      <div class="topline"><span>ARType &nbsp; / &nbsp; ${current?'Организация':'Кабинет'}</span><span><span class="dot"></span>${me.operator?'Администратор платформы':'Корпоративный доступ'}</span>
      </div>
      <div id="page-error" class="error" role="alert" tabindex="-1" hidden>
      </div>
      <div class="heading">
      <div>
      <div class="eyebrow">${me.operator?'ARType Console':'Команда'}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
      </div>${actions}</div>${content}</main>
      </div>`;
  if (!content.includes('class="loading"')) document.querySelector('#main-content')?.focus?.({preventScroll: true});
}

  return {root, toast, showError, login, shell, hasUnsavedChanges, confirmDiscard};
}
