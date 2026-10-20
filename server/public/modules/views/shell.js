import {t as tr, intlLocale, languageSelector} from '../i18n.js';
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
    dialog.querySelector('#discard-title').textContent = tr('you_have_unsaved_changes');
    dialog.querySelector('#discard-description').textContent = tr('discard_description');
    dialog.querySelector('[value=cancel]').textContent = tr('continue_editing');
    dialog.querySelector('[value=discard]').textContent = tr('leave_without_saving');
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
  document.title = tr('sign_in_artype');
  root.innerHTML=`<div class="login">
      <section class="login-art">${brand}<div class="hero">
      <div class="eyebrow">${tr('language_is_no_barrier')}</div>
      <h1>${tr('your_thoughts')}<br>${tr('in_any_language')}</h1>
      <p>${tr('translate_and_edit_text_right_where_you_work')}</p>
      <div class="key-demo">
      <div class="line"><span>${tr('select_translate')}</span><kbd>⌥ / Alt + D</kbd>
      </div>
      <div class="line"><span>${tr('write_replace')}</span><kbd>⌥ / Alt + R</kbd>
      </div>
      </div>
      </div>
      <footer>${tr('artype_your_team_s_working_language')}</footer>
      </section>
      <main class="login-form">
      <div class="login-content">${languageSelector()}
      <div class="eyebrow">${tr('workspace')}</div>
      <h1>${tr('welcome')}</h1>
      <p>${tr('sign_in_with_google_to_create_your_workspace_or_join_a_team')}</p>
      <div id="page-error" class="error" hidden>
      </div>
      <button class="google" data-action="login"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 5.9Z"/></svg>${tr('continue_with_google')}</button>
      <p class="legal">${tr('your_account_is_created_automatically_after_sign_in_choose_plus')}</p>
      <p class="legal">${tr('translations_use_the_artype_server_and_an_ai_provider_translatio')}</p>
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
      <a class="skip-link" href="#main-content">${tr('skip_to_content')}</a>
      <aside class="sidebar"><div class="sidebar-header">${brand}<button type="button" class="mobile-menu quiet" data-action="toggle-menu" aria-expanded="false" aria-controls="main-navigation">${tr('menu')}</button></div>
      <nav id="main-navigation" aria-label="${tr('main_navigation')}"><div class="nav-group"><div class="eyebrow">${tr('work')}</div>
      ${me.operator ? nav(tr('platform_overview'), 'dashboard', section === 'dashboard') : ''}
      ${nav(tr('workspaces_275'), 'home', ['home', 'new-tenant'].includes(section))}
      ${me.tenants.map(t=>`<button type="button" class="navitem tenant-nav ${current===t.id?'active':''}" data-tenant="${t.id}" ${current===t.id?'aria-current="page"':''}>${esc(t.name)}</button>`).join('')}</div>
      ${me.operator ? `<div class="nav-group"><div class="eyebrow">${tr('platform_settings')}</div>
      ${nav(tr('ai_connections'), 'provider', section.startsWith('provider'))}
      ${nav(tr('pricing_and_registration'), 'pricing', section === 'pricing')}
      ${nav(tr('administrators'), 'admins', section === 'admins')}</div>` : ''}
      <div class="nav-group">${nav(tr('install_and_help'), 'help', section === 'help')}</div></nav>
      <footer><span>${tr('signed_in_as')}</span>
      <div class="identity"><span class="avatar">${esc(me.user.name.slice(0,1))}</span>
      <div>${esc(me.user.name)}<br><small>${esc(me.user.email)}</small>
      </div>
      </div>${button(tr('sign_out'),'logout','quiet small')}</footer>
      </aside>
      <main class="workspace" id="main-content" tabindex="-1">
      <div class="topline">${languageSelector()}<span>ARType &nbsp; / &nbsp; ${current?tr('workspace'):tr('console')}</span><span><span class="dot"></span>${me.operator?tr('platform_administrator'):tr('my_account')}</span>
      </div>
      <div id="page-error" class="error" role="alert" tabindex="-1" hidden>
      </div>
      <div class="heading">
      <div>
      <div class="eyebrow">${me.operator?'ARType Console':tr('my_account')}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
      </div>${actions}</div>${content}</main>
      </div>`;
  if (!content.includes('class="loading"')) document.querySelector('#main-content')?.focus?.({preventScroll: true});
}

  return {root, toast, showError, login, shell, hasUnsavedChanges, confirmDiscard};
}
