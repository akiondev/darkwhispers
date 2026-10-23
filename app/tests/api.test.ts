import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { WclClient } from '../server/wcl.js';
import { runAnalysis } from '../server/jobs.js';
import type { Selection } from '../shared/types.js';
import { demoData } from '../shared/demo.js';
import { clientAddress } from '../server/client-ip.js';
const selection: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};

test('Cloudflare visitors have separate rate limits and untrusted headers cannot spoof them', async () => {
  assert.equal(
    clientAddress({ ip: '2606:4700::1', headers: { 'cf-connecting-ip': '2001:db8::1' } }),
    '2001:db8::1',
  );
  assert.equal(
    clientAddress({
      ip: '162.158.1.1',
      headers: { 'cf-connecting-ip': '198.51.100.2,198.51.100.3' },
    }),
    '162.158.1.1',
  );
  assert.equal(
    clientAddress({ ip: '198.51.100.1', headers: { 'cf-connecting-ip': '198.51.100.2' } }),
    '198.51.100.1',
  );
  const app = await createApi(new MemoryStore(), new WclClient('', ''), async () => {});
  try {
    for (const visitor of ['198.51.100.1', '198.51.100.2']) {
      for (let i = 0; i < 7; i++) {
        const reply = await app.inject({
          method: 'POST',
          url: '/api/reports/inspect',
          remoteAddress: '127.0.0.1',
          headers: { 'x-forwarded-for': '162.158.1.1', 'cf-connecting-ip': visitor },
          payload: { url: 'invalid' },
        });
        assert.equal(reply.statusCode, i < 6 ? 400 : 429);
      }
    }
    for (let i = 0; i < 7; i++) {
      const reply = await app.inject({
        method: 'POST',
        url: '/api/reports/inspect',
        remoteAddress: '198.51.100.3',
        headers: { 'x-forwarded-for': '162.158.1.1', 'cf-connecting-ip': `198.51.100.${i + 10}` },
        payload: { url: 'invalid' },
      });
      assert.equal(reply.statusCode, i < 6 ? 400 : 429);
    }
  } finally {
    await app.close();
  }
});

test('malformed JSON and oversized requests retain their client error status', async () => {
  const app = await createApi(new MemoryStore(), new WclClient('', ''), async () => {});
  try {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    assert.equal(malformed.statusCode, 400);
    const large = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { padding: 'x'.repeat(17000) },
    });
    assert.equal(large.statusCode, 413);
    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      headers: { 'content-type': 'application/octet-stream' },
      payload: 'x',
    });
    assert.equal(unsupported.statusCode, 415);
  } finally {
    await app.close();
  }
});

test('expired metadata is refreshed, and an accepted selection cannot grow while queued', async () => {
  const store = new MemoryStore(),
    { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  let imports = 0;
  class Client extends WclClient {
    override async report() {
      imports++;
      return report;
    }
  }
  const app = await createApi(store, new Client('c', 's'), async () => {});
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { reportCode: report.code, selection: { ...selection, encounterId: 3420 } },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(imports, 1);
    const job = (await store.getJob(created.json().id))!;
    assert.deepEqual(
      job.selection.fightIds,
      report.fights.filter((f) => f.encounterId === 3420).map((f) => f.id),
    );
    report.fights.push({ ...report.fights[4], id: 99 });
    assert.ok(!job.selection.fightIds!.includes(99));
    const changed = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { reportCode: report.code, selection: { ...selection, fightIds: [999] } },
    });
    assert.equal(changed.statusCode, 422);
  } finally {
    await app.close();
  }
});

test('concurrent submissions cannot exceed queue admission, and expired jobs terminate', async () => {
  const store = new MemoryStore();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => store.createJob('demo', selection, true)),
  );
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 12);
  const job = [...store.jobs.values()][0];
  job.createdAt = new Date(Date.now() - 3 * 3600000).toISOString();
  assert.equal((await store.getJob(job.id))!.status, 'failed');
  assert.equal((await store.getJob(job.id))!.errorCode, 'ANALYSIS_EXPIRED');
  await store.updateJob(job.id, { status: 'complete', progress: 100 });
  assert.equal((await store.getJob(job.id))!.status, 'failed');
  assert.equal(await store.activeJobs(), 11);
});
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
            selection: { ...selection, excludeWipeTail: 'yes' },
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
