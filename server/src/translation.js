import { transaction, uid } from './database.js';
import { fail } from './errors.js';
import { access } from './access.js';
import { decryptCredential } from './credentials.js';
import { reconcileTenantBilling, productAccess } from './billing.js';

async function resolveProvider(db, tenant, config) {
  const result = await db.query('SELECT ciphertext,base_url FROM provider_credentials WHERE alias=$1', [tenant.credential]);
  const saved = result.rows[0];
  let providerKey = config.providerKeys[tenant.credential];
  if (saved) {
    try {
      providerKey = decryptCredential(saved.ciphertext, config.credentialEncryptionKey, tenant.credential);
    } catch {
      fail(503, 'credential_unavailable', 'Не удалось прочитать ключ AI. Оператору нужно проверить ключ шифрования сервера.');
    }
  }
  if (!providerKey) fail(503, 'provider_not_configured', 'Администратор ещё не подключил провайдера перевода.');
  return { providerKey, providerBaseURL: saved?.base_url || config.providerBaseURL };
}

export async function reserve(pool, user, body, config) {
  return transaction(pool, async db => {
    const tenant = await access(db, body.tenant_id, user, config, { lock: true });
    if (tenant.status !== 'active' || (tenant.access_until && new Date(tenant.access_until) <= new Date())) {
      fail(403, 'tenant_inactive', 'Доступ организации приостановлен или истёк. Обратитесь к администратору.');
    }
    await reconcileTenantBilling(db, tenant.id);
    const entitlement = await productAccess(db, tenant.id, user.email);
    if (entitlement.app_status === 'awaiting_payment') fail(402, 'billing_unpaid', entitlement.access_message);
    if (!entitlement.can_translate) fail(403, 'product_disabled', entitlement.access_message);
    const characters = Array.from(body.text).length;
    if (characters > tenant.max_text) {
      fail(422, 'text_too_long', `Максимальная длина текста: ${tenant.max_text} символов.`);
    }
    if (!tenant.languages.includes(body.target) || (body.source && !tenant.languages.includes(body.source))) {
      fail(422, 'language_not_allowed', 'Этот язык не разрешён в организации.');
    }
    const provider = await resolveProvider(db, tenant, config);
    const duplicate = await db.query('SELECT id FROM usage WHERE user_id=$1 AND request_id=$2', [user.id, body.request_id]);
    if (duplicate.rowCount) {
      fail(409, 'already_processed', 'Этот запрос уже обработан. Повторите действие вручную.');
    }
    // PostgreSQL now() is the transaction start, which can precede a lock wait
    // and even the current UTC month. Use one observed instant for all counters
    // and the reservation timestamp after acquiring access.
    const observedAt = (await db.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
    const result = await db.query(`
      SELECT COALESCE(sum(characters) FILTER(
        WHERE created_at>=date_trunc('month',$3::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND (status='success' OR (status='pending' AND created_at>$3::timestamptz-interval '70 seconds'))
      ),0)::bigint AS used,
        count(*) FILTER(WHERE created_at>$3::timestamptz-interval '1 minute')::int AS rpm,
        count(*) FILTER(WHERE status='pending' AND created_at>$3::timestamptz-interval '70 seconds')::int AS pending,
        count(*) FILTER(WHERE user_id=$2 AND status='pending' AND created_at>$3::timestamptz-interval '70 seconds')::int AS personal
      FROM usage WHERE tenant_id=$1
        AND created_at>=LEAST(
          date_trunc('month',$3::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
          $3::timestamptz-interval '70 seconds'
        )
    `, [tenant.id, user.id, observedAt]);
    const totals = result.rows[0];
    if (Number(totals.used) + characters > Number(tenant.monthly_characters)) {
      fail(429, 'monthly_limit', 'Месячный лимит организации исчерпан.');
    }
    if (totals.rpm >= tenant.rpm || totals.pending >= tenant.concurrency || totals.personal >= 2) {
      fail(429, 'busy', 'Слишком много запросов. Повторите через минуту.');
    }
    const id = uid();
    await db.query(`
      INSERT INTO usage(id,tenant_id,user_id,request_id,characters,status,created_at)
      VALUES($1,$2,$3,$4,$5,'pending',$6)
    `, [id, tenant.id, user.id, body.request_id, characters, observedAt]);
    return { id, tenant, ...provider };
  });
}
