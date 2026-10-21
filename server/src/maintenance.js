import { renewDueTenants } from './billing.js';

/** One in-flight run per task; shutdown waits for its last database operation. */
export function periodicTask(operation, onError, intervalMs = 60000) {
  let running = null;
  let stopped = false;
  const run = () => {
    if (stopped || running) return running;
    running = Promise.resolve().then(operation).catch(onError).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(run, intervalMs).unref();
  return {
    run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

export function startMaintenance(pool) {
  const cleanup = periodicTask(() => pool.query(`
    DELETE FROM oauth_states WHERE expires_at<now();
    DELETE FROM devices WHERE expires_at<now();
    DELETE FROM sessions WHERE expires_at<now();
    UPDATE usage SET status='failed' WHERE status='pending' AND created_at<now()-interval '70 seconds'
  `), () => console.error('ARType cleanup failed'));
  const billing = periodicTask(() => renewDueTenants(pool), () => console.error('ARType monthly renewal failed'));
  void billing.run();
  return { stop: () => Promise.all([cleanup.stop(), billing.stop()]) };
}
