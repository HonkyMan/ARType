import {esc} from '../format.js';

export function createHelpViews({state, location}) {

function downloadsContent() {
  const {downloadFiles} = state;
return `<section class="panel">
      <div class="panel-head">
      <h2>Скачать ARType</h2>
      </div>
      <div class="panel-body">${downloadFiles.length?downloadFiles.map(f=>`<article class="download">
      <h3>${f.platform==='macos-arm64'?'macOS 26+ · Apple Silicon':'Windows 10/11 · x64'} <span class="tag">${esc(f.version)}</span>
      </h3>
      <p>${f.signing==='unsigned-validation'?'Пилотная сборка без сертификата подписи. ОС может потребовать ручного разрешения запуска.':'Подписанный установщик.'}</p>${f.service_url!==location.origin?'<div class="notice">Этот установщик настроен на другой адрес сервера. Попросите администратора пересобрать приложение для текущего кабинета.</div>':''}<p><small>Адрес сервиса: ${esc(f.service_url)}</small>
      </p><a class="button secondary" href="${esc(f.url)}" download>↓ Скачать ${f.platform==='macos-arm64'?'DMG':'EXE'} · ${(f.size_bytes/1048576).toFixed(1)} МБ</a>
      <details>
      <summary>Проверить SHA-256</summary><code class="hash">${esc(f.sha256)}</code>
      </details>
      </article>`).join(''):'<p>Установщики ещё не опубликованы. Обратитесь к администратору платформы.</p>'}</div>
      </section>`}

function helpContent() {
return `${downloadsContent()}<div class="split">
      <section class="panel">
      <div class="panel-head">
      <h2>Начать работу</h2>
      </div>
      <div class="panel-body">
      <ol class="steps">
      <li>Установите ARType<p>Скачайте установщик для своей платформы в блоке выше.</p>
      </li>
      <li>Войдите через Google<p>Используйте адрес, на который вас пригласили. Сверьте код устройства в приложении и браузере.</p>
      </li>
      <li>Выберите организацию<p>Модель и правила загрузятся с корпоративного сервера автоматически.</p>
      </li>
      <li>На Mac выдайте Accessibility<p>Системные настройки → Конфиденциальность и безопасность → Универсальный доступ → ARType.</p>
      </li>
      </ol>
      </div>
      </section>
      <section class="panel">
      <div class="panel-head">
      <h2>Каждый день</h2>
      </div>
      <div class="panel-body">
      <h3>Прочитать выделенное</h3>
      <p>Выделите текст и нажмите Option / Alt + D. Перевод появится рядом.</p>
      <h3>Перевести и заменить</h3>
      <p>Выделите написанный текст и нажмите Option / Alt + R. Проверьте результат перед отправкой.</p>
      <h3>Нет доступа</h3>
      <p>Проверьте Google-аккаунт и выбранную организацию. Попросите администратора проверить приглашение и лимиты.</p><small>Ключи AI-провайдера сотрудникам не нужны.</small>
      </div>
      </section>
      </div>`}

  return {helpContent};
}
