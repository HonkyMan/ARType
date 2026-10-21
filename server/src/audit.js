import { uid } from './database.js';

export async function audit(client, user, action, tenantId, details = {}) {
  await client.query(`
    INSERT INTO audit(id,actor_id,action,tenant_id,details) VALUES($1,$2,$3,$4,$5)
  `, [uid(), user.id, action, tenantId, details]);
}
