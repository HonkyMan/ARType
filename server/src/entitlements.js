import { membershipEnabled } from './membership-policy.js';

/** Product access is separate from the role that permits managing a tenant. */
export function describeProductAccess(member, tenantStatus, accessUntil, paid, period, now = new Date()) {
  let status = 'disabled';
  let message = 'Доступ к программе отключён. Обратитесь к владельцу организации.';
  const enabled = membershipEnabled(member, now);

  if (enabled && !member.product_enabled && member.role === 'owner') {
    status = 'management_only';
    message = 'Вы управляете организацией бесплатно. Чтобы пользоваться ARType, добавьте себя как пользователя в кабинете.';
  } else if (enabled && member.product_enabled) {
    if (tenantStatus !== 'active' || (accessUntil && new Date(accessUntil) <= now)) {
      status = 'suspended';
      message = 'Доступ организации приостановлен. Обратитесь к администратору платформы.';
    } else if (!paid) {
      status = 'awaiting_payment';
      message = 'ARType не работает: не пополнен баланс аккаунта организации. Обратитесь к владельцу организации для оплаты инвойса.';
    } else {
      status = 'active';
      message = 'Доступ к программе оплачен.';
    }
  }

  const end = new Date(period + 'T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    app_status: status,
    can_translate: status === 'active',
    access_message: message,
    paid_until: paid ? end.toISOString() : null,
  };
}
