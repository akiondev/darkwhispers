import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { config } from './config.js';
import { createApi } from './api.js';
import { MemoryStore, PgStore, type Store } from './store.js';
import { WclClient } from './wcl.js';
import { runAnalysis } from './jobs.js';

const client = new WclClient(config.clientId, config.clientSecret);
let store: Store, boss: PgBoss | undefined;
if (config.production || process.env.PGHOST) {
  const pg = new PgStore(new Pool(config.database));
  await pg.init();
  store = pg;
  boss = new PgBoss({ ...config.database, max: 2, schema: 'jobs' });
  boss.on('error', () => console.error('Background queue connection error'));
  await boss.start();
  await boss.createQueue('analyze', { retryLimit: 1, retryDelay: 30, expireInSeconds: 7200 });
} else store = new MemoryStore();
const api = await createApi(
  store,
  client,
  async (id) => {
    if (boss) await boss.send('analyze', { id }, { singletonKey: id });
    else
      setImmediate(() => {
        void runAnalysis(id, store, client);
      });
  },
  config.production,
);
await api.listen({ port: config.port, host: config.host });
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, async () => {
    await api.close();
    if (boss) await boss.stop();
    await store.close();
    process.exit(0);
  });
