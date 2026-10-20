import {brand, button, esc} from '../format.js';

export function createShell({state, document, setTimeout}) {
  const root = document.querySelector('#app');

  function toast(text) {
    const target = document.querySelector('#toast');
    target.textContent = text;
    target.hidden = false;
    setTimeout(() => { target.hidden = true; }, 4500);
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
    toast(error.message);
  }

function login() {

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
  root.innerHTML=`<div class="shell">
      <aside class="sidebar">${brand}<div class="eyebrow">Управление</div>
      <nav>${me.operator?button('▦ &nbsp; Dashboard','dashboard',`navitem ${section==='dashboard'?'active':''}`):''}${button('◈ &nbsp; Рабочие пространства','home',`navitem ${!current&&section==='home'?'active':''}`)}${me.tenants.map(t=>`<button class="navitem ${current===t.id?'active':''}" data-tenant="${t.id}">${esc(t.name)}</button>`).join('')}${me.operator?button('◇ &nbsp; AI-провайдеры','provider',`navitem ${section.startsWith('provider')?'active':''}`)+button('⚙ &nbsp; Администраторы','admins',`navitem ${section==='admins'?'active':''}`):''}${button('↗ &nbsp; Установка и помощь','help','navitem')}</nav>
      <footer><span>Вы вошли как</span>
      <div class="identity"><span class="avatar">${esc(me.user.name.slice(0,1))}</span>
      <div>${esc(me.user.name)}<br><small>${esc(me.user.email)}</small>
      </div>
      </div>${button('Выйти','logout','quiet small')}</footer>
      </aside>
      <main class="workspace">
      <div class="topline"><span>ARType &nbsp; / &nbsp; ${esc(current?me.tenants.find(t=>t.id===current)?.name:'Кабинет')}</span><span><span class="dot"></span>${me.operator?'Администратор платформы':'Корпоративный доступ'}</span>
      </div>
      <div id="page-error" class="error" hidden>
      </div>
      <div class="heading">
      <div>
      <div class="eyebrow">${me.operator?'ARType Console':'Команда'}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
      </div>${actions}</div>${content}</main>
      </div>`;
}

  return {root, toast, showError, login, shell};
}
