import pg from 'pg';
import { loadConfig } from './config.js';
import { migrate } from './migrations.js';
import { createApp } from './app.js';
import { makeGoogle } from './auth.js';
import { makeTranslator } from './provider.js';
import { startMaintenance } from './maintenance.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseURL, max: 20, statement_timeout: 10000 });
await migrate(pool);
const server = createApp({
  pool, config, google: makeGoogle(config), translate: makeTranslator(config),
}).listen(config.port, '0.0.0.0', () => console.log(`ARType listening on ${config.port}`));
server.requestTimeout = 60000;
server.headersTimeout = 10000;
const maintenance = startMaintenance(pool);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 60000).unref();
  try {
    // Stop accepting work, then drain both HTTP and background DB users before
    // ending the pool. Repeated signals must not start competing shutdowns.
    await Promise.all([
      new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      maintenance.stop(),
    ]);
    await pool.end();
    clearTimeout(deadline);
  } catch {
    console.error('ARType shutdown failed');
    process.exitCode = 1;
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void shutdown(); });
