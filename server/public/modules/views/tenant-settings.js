import {t as tr, intlLocale} from '../i18n.js';
import {button, esc} from '../format.js';
import {connectionFields, field, formSection, languageOptions, saveActions} from './components.js';

export function createTenantSettings({state}) {
  function createForm() {
    const {connections, defaultModel, credentials} = state;
    return `<section class="panel"><form class="panel-body" data-form="create">
      ${formSection(tr('organization_and_owner'), tr('the_owner_can_manage_the_console_without_buying_a_seat_app_acces'),
        field(tr('organization_name'), 'name', '', 'text', `required maxlength="120" placeholder="${tr('product_name')}"`) +
        field(tr('owner_s_google_email'), 'owner_email', '', 'email', 'required placeholder="lead@company.com"'))}
      ${formSection(tr('translation'), tr('choose_an_existing_connection_and_the_team_s_languages_you_can_c'),
        connectionFields(state, connections[0]?.alias, connections[0]?.default_model || defaultModel) +
        languageOptions(['ru', 'en', 'bn', 'hi', 'zh']))}
      ${formSection(tr('workspace_limits'), tr('these_are_usage_limits_paid_seat_count_depends_on_enabled_member'),
        field(tr('maximum_app_seats'), 'seats', 10, 'number', 'required min="1" max="100000"') +
        field(tr('characters_per_month'), 'monthly_characters', 1000000, 'number', 'required min="1" max="1000000000000"'))}
      ${!credentials.length ? `<div class="notice">${tr('add_an_ai_connection_with_a_key_first')} ${button(tr('configure_connection'), 'provider', 'secondary small')}</div>` : ''}
      <div class="actions"><button type="submit" ${!credentials.length ? 'disabled' : ''}>${tr('create_organization_300')}</button>${button(tr('cancel'), 'home', 'quiet')}</div>
      <p class="legal">${tr('the_invitation_lasts_7_days_no_email_is_sent_automatically_share')}</p>
    </form></section>`;
  }

  function translationForm(t) {
    return `<section class="panel"><form class="panel-body" data-form="settings" data-tenant-id="${t.id}">
      ${formSection(tr('languages_and_terminology'), tr('these_rules_apply_to_subsequent_translations_reinstalling_the_ap'),
        languageOptions(t.languages) + `<label class="wide">${tr('glossary_and_instructions')}<textarea name="instructions" maxlength="8000" placeholder="${tr('for_example_keep_the_product_name_artype_untranslated')}">${esc(t.instructions)}</textarea><small>${tr('terminology_product_names_and_translation_style_requirements')}</small></label>`)}
      ${state.me.operator ? formSection(tr('ai_connection'), tr('these_settings_are_available_only_to_platform_administrators'),
        connectionFields(state, t.credential, t.model)) : ''}
      ${saveActions(tr('save_translation_settings'))}
    </form></section>`;
  }

  function settingsForm(t) {
    const localDeadline = t.access_until
      ? new Date(new Date(t.access_until) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return `<section class="panel"><form class="panel-body" data-form="settings" data-tenant-id="${t.id}">
      ${formSection(tr('about_this_workspace'), tr('this_name_appears_in_the_console_and_the_app'),
        field(tr('organization_name'), 'name', t.name, 'text', 'required maxlength="120"'))}
      ${state.me.operator ? formSection(tr('access_and_limits'), tr('managed_by_the_platform_administrator_suspending_a_workspace_blo'),
        field(tr('maximum_app_seats'), 'seats', t.seats, 'number', 'required min="1" max="100000"') +
        field(tr('characters_per_month'), 'monthly_characters', t.monthly_characters, 'number', 'required min="1" max="1000000000000"') +
        `<label>${tr('translation_access')}<select name="status"><option value="active" ${t.status === 'active' ? 'selected' : ''}>${tr('active')}</option><option value="suspended" ${t.status === 'suspended' ? 'selected' : ''}>${tr('suspended')}</option></select></label>` +
        field(tr('access_until_your_local_time'), 'access_until', localDeadline, 'datetime-local') +
        `<p class="wide field-hint">${tr('leave_the_date_blank_for_access_without_an_expiry_date')}</p>`) : ''}
      ${state.me.operator ? `<details class="advanced"><summary>${tr('technical_request_limits')}</summary><div class="fields">
        ${field(tr('characters_per_request'), 'max_text', t.max_text, 'number', 'required min="1" max="20000"')}
        ${field(tr('requests_per_minute'), 'rpm', t.rpm, 'number', 'required min="1" max="10000"')}
        ${field(tr('concurrent_translations'), 'concurrency', t.concurrency, 'number', 'required min="1" max="500"')}
      </div></details>` : ''}
      ${saveActions()}
    </form></section>`;
  }

  return {createForm, translationForm, settingsForm};
}
