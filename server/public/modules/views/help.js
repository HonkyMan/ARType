import {t as tr, intlLocale} from '../i18n.js';
import {esc} from '../format.js';

export function createHelpViews({state, location}) {

function downloadsContent() {
  const {downloadFiles} = state;
return `<section class="panel">
      <div class="panel-head">
      <h2>${tr('download_artype')}</h2>
      </div>
      <div class="panel-body">${downloadFiles.length?downloadFiles.map(f=>`<article class="download">
      <h3>${f.platform==='macos-arm64'?'macOS 26+ · Apple Silicon':'Windows 10/11 · x64'} <span class="tag">${esc(f.version)}</span>
      </h3>
      <p>${f.signing==='unsigned-validation'?tr('unsigned_pilot_build_your_operating_system_may_require_you_to_al'):tr('signed_installer')}</p>${f.service_url!==location.origin?`<div class="notice">${tr('this_installer_uses_a_different_server_address_ask_the_administr')}</div>`:''}<p><small>${tr('service_address')} ${esc(f.service_url)}</small>
      </p><a class="button secondary" href="${esc(f.url)}" download>${tr('download')} ${f.platform==='macos-arm64'?'DMG':'EXE'} · ${(f.size_bytes/1048576).toFixed(1)} ${tr('mb')}</a>
      <details>
      <summary>${tr('verify_sha_256')}</summary><code class="hash">${esc(f.sha256)}</code>
      </details>
      </article>`).join(''):`<p>${tr('installers_have_not_been_published_yet_contact_the_platform_admi')}</p>`}</div>
      </section>`}

function helpContent() {
return `${downloadsContent()}<div class="split">
      <section class="panel">
      <div class="panel-head">
      <h2>${tr('get_started')}</h2>
      </div>
      <div class="panel-body">
      <ol class="steps">
      <li>${tr('install_artype')}<p>${tr('download_the_installer_for_your_platform_above')}</p>
      </li>
      <li>${tr('sign_in_with_google')}<p>${tr('use_the_google_account_for_your_workspace_check_that_the_device')}</p>
      </li>
      <li>${tr('select_a_workspace')}<p>${tr('the_model_and_translation_settings_load_from_the_service_automat')}</p>
      </li>
      <li>${tr('on_mac_grant_accessibility_access')}<p>${tr('system_settings_privacy_security_accessibility_artype')}</p>
      </li>
      </ol>
      </div>
      </section>
      <section class="panel">
      <div class="panel-head">
      <h2>${tr('everyday_use')}</h2>
      </div>
      <div class="panel-body">
      <h3>${tr('read_selected_text')}</h3>
      <p>${tr('select_text_and_press_option_alt_d_the_translation_appears_along')}</p>
      <h3>${tr('translate_and_replace')}</h3>
      <p>${tr('select_your_text_and_press_option_alt_r_review_the_result_before')}</p>
      <h3>${tr('no_access')}</h3>
      <p>${tr('check_your_google_account_and_selected_workspace_for_plus_check')}</p><small>${tr('members_do_not_need_ai_provider_keys')}</small>
      </div>
      </section>
      </div>`}

  return {helpContent};
}
