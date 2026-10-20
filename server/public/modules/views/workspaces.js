import {t as tr, intlLocale} from '../i18n.js';
import {button, esc, money} from '../format.js';
import {saveActions, connectionFields, languageOptions, field} from './components.js';

export function createWorkspaceViews({state, shell}) {
  function onboarding(data) {
    const ownPlus = state.me.tenants.find(w => w.plan === 'plus' && w.role === 'owner');
    shell(`<div class="plan-grid">${['plus','business'].map(plan => {
      const p = data.plans.find(item => item.plan === plan);
      return `<section class="panel plan-card"><div class="panel-body"><div class="eyebrow">${plan === 'plus' ? tr('personal_workspace') : tr('for_teams')}</div><h2>${plan === 'plus' ? 'Plus' : 'Business'}</h2>
        <div class="plan-price">${money(p.price_cents)}<small> ${tr('month')}</small></div>
        <p>${plan === 'plus' ? tr('for_one_person_translations_and_ai_costs_are_included_in_the_sub') : tr('business_plan_description',{price:money(p.seat_price_cents)})}</p>
        <ul>${(plan === 'plus' ? [tr('personal_balance_and_payment_history'),tr('app_for_macos_and_windows'),tr('no_invitations_or_team_settings')] : [tr('organization_and_team_invitations'),tr('roles_translation_rules_and_statistics'),tr('shared_balance_and_separate_seat_charges')]).map(text=>`<li>${text}</li>`).join('')}</ul>
        ${plan === 'plus' && ownPlus ? `<button class="secondary" data-tenant="${ownPlus.id}">${tr('open_my_plus')}</button>` : p.registration_enabled ? `<form data-form="workspace"><input type="hidden" name="plan" value="${plan}"><label>${plan === 'plus' ? tr('personal_workspace_name') : tr('organization_name')}<input name="name" maxlength="120" required value="${plan === 'plus' ? esc(state.me.user.name) : ''}" autocomplete="organization"></label><div class="actions"><button>${plan === 'plus' ? tr('create_plus') : tr('create_business')}</button></div></form>` : `<div class="notice">${tr('registration_is_temporarily_unavailable_contact_the_platform_adm')}</div>`}</div></section>`;
    }).join('')}</div><p class="legal">${tr('after_creating_a_workspace_top_up_its_balance_to_activate_the_su')}</p>`,
    tr('choose_your_workspace'), tr('personal_use_and_teamwork_are_billed_independently'), state.me.tenants.length ? button(tr('my_workspaces'),'home','quiet') : '');
  }
  return {onboarding};
}

export function planDefaultsForm(state, data) {
  return (data.defaults || []).map(p=>`<section class="panel"><div class="panel-head"><h2>${p.plan === 'plus' ? 'Plus' : 'Business'} ${tr('self_service_registration')}</h2></div>
    <form class="panel-body" data-form="plan-defaults" data-plan="${p.plan}"><div class="fields">
    <label>${tr('registration')}<select name="registration_enabled"><option value="false" ${!p.registration_enabled?'selected':''}>${tr('closed')}</option><option value="true" ${p.registration_enabled?'selected':''}>${tr('open_418')}</option></select></label>
    ${connectionFields(state,p.credential,p.model)}
    ${field(tr('monthly_character_limit'),'monthly_characters',p.monthly_characters,'number','min="1" max="1000000000000" required')}
    ${field(tr('maximum_seats'),'seats',p.seats,'number',`min="1" max="100000" required ${p.plan==='plus'?'readonly':''}`)}
    ${languageOptions(p.languages)}</div><p class="legal">${tr('these_settings_apply_to_new_workspaces_update_existing_workspace')}</p>${saveActions(tr('save_registration_settings'))}</form></section>`).join('');
}
