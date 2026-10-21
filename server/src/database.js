import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID();

export async function transaction(pool, operation) {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      failed = true;
      // Preserve the original failure and discard an unusable pooled connection.
      throw new AggregateError([error, rollbackError], 'Transaction rollback failed');
    }
    throw error;
  } finally {
    client.release(failed);
  }
}
