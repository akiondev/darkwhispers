import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { WclClient } from '../server/wcl.js';
import { runAnalysis } from '../server/jobs.js';
import type { Selection } from '../shared/types.js';
const selection: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};
test('late parallel progress updates cannot move the displayed progress backwards', async () => {
  const store = new MemoryStore();
  const job = await store.createJob('demo', selection, true);
  await store.updateJob(job.id, { progress: 50, message: 'Ready: 5 of 10 pulls' });
  await store.updateJob(job.id, { progress: 40, message: 'Ready: 4 of 10 pulls' });
  assert.equal((await store.getJob(job.id))!.progress, 50);
  assert.equal((await store.getJob(job.id))!.message, 'Ready: 5 of 10 pulls');
  await store.updateJob(job.id, { status: 'failed', error: 'Fixture failure' });
  assert.equal((await store.getJob(job.id))!.status, 'failed');
});
test('HTTP API creates a demo job and returns a complete auditable ranking', async () => {
  const store = new MemoryStore(),
    client = new WclClient('', '');
  const app = await createApi(store, client, async (id) => {
    await runAnalysis(id, store, client);
  });
  try {
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    assert.equal((await app.inject('/api/status')).json().liveConfigured, false);
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { reportCode: 'demo', demo: true, selection },
    });
    assert.equal(created.statusCode, 202);
    const result = (await app.inject(`/api/analyses/${created.json().id}`)).json();
    assert.equal(result.status, 'complete');
    assert.equal(result.result.players.length, 20);
    assert.equal(result.result.report.source, 'demo');
    const one = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: {
        reportCode: 'demo',
        demo: true,
        selection: { ...selection, encounterId: 3420, mode: 'kills' },
      },
    });
    const scoped = (await app.inject(`/api/analyses/${one.json().id}`)).json();
    assert.equal(scoped.result.summary.pulls, 1);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/analyses',
          payload: { reportCode: 'demo', demo: true, selection: { ...selection, fightIds: [] } },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reports/inspect',
          payload: { url: 'https://www.warcraftlogs.com/reports/6fjJxRFC21YHdTXB' },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reports/inspect',
          payload: { url: 'https://localhost/internal' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/analyses',
          headers: { origin: 'https://evil.test' },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject('/api/analyses/00000000-0000-4000-8000-000000000000')).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/analyses',
          payload: {
            reportCode: 'demo',
            demo: true,
            selection: { ...selection, excludeWipeTail: true },
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
