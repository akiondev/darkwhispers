import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { config } from './config.js';
import { PgStore } from './store.js';
import { WclClient } from './wcl.js';
import { runAnalysis } from './jobs.js';

const store = new PgStore(new Pool(config.database));
await store.init();
const client = new WclClient(config.clientId, config.clientSecret);
const boss = new PgBoss({ ...config.database, max: 2, schema: 'jobs' });
boss.on('error', () => console.error('Background queue connection error'));
await boss.start();
await boss.createQueue('analyze', { retryLimit: 1, retryDelay: 30, expireInSeconds: 7200 });
await boss.work<{ id: string }>(
  'analyze',
  { batchSize: 1, pollingIntervalSeconds: 2 },
  async (jobs) => {
    for (const job of jobs) await runAnalysis(job.data.id, store, client);
  },
);
await store.cleanup();
const cleanup = setInterval(() => {
  void store.cleanup().catch(() => console.error('Retention cleanup failed'));
}, 3600000);
cleanup.unref();
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, async () => {
    clearInterval(cleanup);
    await boss.stop({ graceful: true, timeout: 20000 });
    await store.close();
    process.exit(0);
  });
