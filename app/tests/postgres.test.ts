import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';
import { PgStore, QueueFullError } from '../server/store.js';
import { demoData } from '../shared/demo.js';
import { analyze } from '../shared/analysis.js';
import { createApi } from '../server/api.js';
import { WclClient } from '../server/wcl.js';
test(
  'isolated PostgreSQL integration: atomic queue capacity, immutable snapshots, private feed filtering and concurrent indexed reads',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const schema = `dwrt_qa_060_${Date.now()}`;
    assert.match(schema, /^dwrt_qa_060_\d+$/);
    const connectionString = process.env.TEST_DATABASE_URL;
    const admin = new Pool({ connectionString, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
    const store = new PgStore(pool);
    try {
      await store.init();
      const { report, pulls } = demoData();
      report.title = 'SYNTHETIC isolated database test';
      report.source = 'warcraftlogs';
      report.visibility = 'public';
      const selection = {
        encounterId: null,
        difficulty: null,
        mode: 'all' as const,
        fightIds: null,
        excludeWipeTail: false,
      };
      const admission = await Promise.allSettled(
        Array.from({ length: 30 }, () => store.createJob(report.code, selection, false)),
      );
      const accepted = admission.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
      assert.equal(accepted.length, 12);
      assert.equal(await store.activeJobs(), 12);
      for (const row of admission)
        if (row.status === 'rejected') assert.ok(row.reason instanceof QueueFullError);
      for (const job of accepted) await store.updateJob(job.id, { status: 'failed' });
      const result = analyze(report, pulls, selection);
      const job = await store.createJob(report.code, selection, false);
      await store.updateJob(job.id, { status: 'complete', result });
      const original = await store.getJob(job.id);
      await store.updateJob(job.id, { status: 'failed', result: undefined });
      assert.deepEqual(await store.getJob(job.id), original);
      for (const [visibility, demo] of [
        ['unlisted', false],
        ['private', false],
        ['public', true],
      ] as const) {
        const j = await store.createJob(report.code + 'X', selection, demo);
        await store.updateJob(j.id, {
          status: 'complete',
          result: { ...result, report: { ...result.report, visibility } },
        });
      }
      assert.equal((await store.recentAnalyses()).length, 1);
      const next = await store.createJob(report.code, selection, false);
      await store.updateJob(next.id, { status: 'complete', result });
      assert.equal((await store.recentAnalyses()).length, 1, 'Latest entry per report only');
      const api = await createApi(store, new WclClient('', ''), async () => {});
      try {
        const elapsed: number[] = [];
        const responses = await Promise.all(
          Array.from({ length: 100 }, async () => {
            const t = performance.now();
            const response = await api.inject('/api/recent-analyses');
            elapsed.push(performance.now() - t);
            return response;
          }),
        );
        for (const response of responses) {
          assert.equal(response.statusCode, 200);
          assert.equal(response.json().analyses.length, 1);
          assert.equal(response.headers['cache-control'], 'no-store');
        }
        const throttled = await Promise.all(
          Array.from({ length: 30 }, () => api.inject('/api/recent-analyses')),
        );
        assert.ok(throttled.some((r) => r.statusCode === 429));
        elapsed.sort((a, b) => a - b);
        console.log(
          JSON.stringify({
            benchmark: 'synthetic-postgres-feed',
            requests: 100,
            concurrent: true,
            poolMax: 4,
            p50Ms: +elapsed[49].toFixed(2),
            p95Ms: +elapsed[94].toFixed(2),
            rateLimitEnforced: true,
          }),
        );
      } finally {
        await api.close();
      }
      await pool.query(
        "UPDATE recent_analyses SET expires=now()-interval '1 day'; UPDATE analyses SET created=now()-interval '8 days'",
      );
      await store.cleanup();
      assert.deepEqual(await store.recentAnalyses(), []);
      assert.equal(await store.getJob(job.id), null);
    } finally {
      await store.close();
      // This schema name is constructed above and validated; never drop the app's public schema.
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
