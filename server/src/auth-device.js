import {randomBytes} from 'node:crypto';
import {transaction, uid} from './database.js';
import {fail} from './errors.js';
import {hash, sameSecret, secret} from './auth-crypto.js';
import {issueSession} from './auth-session.js';

export function createDeviceService({pool, config, validate, z}) {
  async function start(body) {
    const {challenge} = validate(z.object({
      challenge: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(), body);
    const id = uid();
    const poll = secret();
    const code = randomBytes(3).toString('hex').toUpperCase();
    await pool.query(`
      INSERT INTO devices(id,poll_hash,challenge,code,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '5 minutes')
    `, [id, hash(poll), challenge, code]);
    return {
      id, poll_token: poll, code, expires_in: 300, interval: 3,
      login_url: config.origin + '/auth/google?device=' + id,
    };
  }

  async function poll(body) {
    const input = validate(z.object({
      id: z.string().uuid(),
      poll_token: z.string().min(20).max(200),
      verifier: z.string().min(32).max(128),
    }).strict(), body);
    return transaction(pool, async client => {
      const device = (await client.query(
        'SELECT * FROM devices WHERE id=$1 FOR UPDATE', [input.id],
      )).rows[0];
      if (!device || device.consumed || new Date(device.expires_at) <= new Date()) {
        fail(410, 'device_expired', 'Вход истёк. Начните снова.');
      }
      if (!sameSecret(device.poll_hash, hash(input.poll_token)) ||
          !sameSecret(device.challenge, hash(input.verifier))) {
        fail(403, 'device_secret', 'Неверное подтверждение устройства.');
      }
      if (!device.user_id) return null;
      // Consumption and token issuance commit together while the grant is locked.
      await client.query('UPDATE devices SET consumed=true WHERE id=$1', [device.id]);
      return issueSession(client, device.user_id, 'desktop');
    });
  }

  async function get(idValue) {
    const id = validate(z.string().uuid(), idValue);
    const device = (await pool.query(
      'SELECT code FROM devices WHERE id=$1 AND expires_at>now() AND NOT consumed', [id],
    )).rows[0];
    if (!device) fail(410, 'device_expired', 'Вход устарел.');
    return device;
  }

  async function approve(idValue, body, userId) {
    const id = validate(z.string().uuid(), idValue);
    const code = validate(z.string().max(20), body?.code);
    const result = await pool.query(`
      UPDATE devices SET user_id=$1
      WHERE id=$2 AND code=$3 AND expires_at>now() AND user_id IS NULL AND NOT consumed
    `, [userId, id, code]);
    if (!result.rowCount) {
      fail(403, 'device_code', 'Код не совпадает или запрос уже подтверждён.');
    }
  }

  return {start, poll, get, approve};
}
