import test from 'node:test';
import assert from 'node:assert/strict';
import { WclClient, ApiError } from '../server/wcl.js';
import { ingestPull } from '../server/ingest.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { analyze } from '../shared/analysis.js';
import { fixture, selection } from './execution-fixtures.js';
import { automaticEnd, assessmentWindow, pullCacheKey } from '../shared/windows.js';
import { SCORING_FAMILIES, ENCOUNTERS } from '../shared/encounters.js';
import { summarizeLife } from '../shared/life.js';
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });

test('logged wipe calls paginate across empty pages, take the earliest valid marker and ignore kills/gaps', async () => {
  const { report, fight } = fixture();
  fight.kill = false;
  let pages = 0;
  const c = new WclClient('synthetic', 'synthetic', async (input, init) => {
    if (String(input).includes('/oauth/')) return response({ access_token: 'T', expires_in: 3600 });
    const q = JSON.parse(String(init?.body));
    assert.equal(q.variables.filter, 'type = "wipecalled"');
    return response({
      data: {
        reportData: {
          report: {
            events:
              ++pages === 1
                ? { data: [], nextPageTimestamp: 20000 }
                : {
                    data: [
                      { type: 'wipecalled', timestamp: 9000 },
                      { type: 'wipecalled', timestamp: 110000 },
                      { type: 'wipecalled', timestamp: 100000 },
                    ],
                    nextPageTimestamp: null,
                  },
          },
        },
      },
    });
  });
  assert.deepEqual(await c.wipeCalls(report.code, [fight]), { [fight.id]: 100000 });
  assert.equal(pages, 2);
  fight.kill = true;
  assert.deepEqual(await c.wipeCalls(report.code, [fight]), {});
  assert.equal(pages, 2);
});
test('missing or malformed wipe data is an import error, not a guessed absence', async () => {
  const { report, fight } = fixture();
  fight.kill = false;
  for (const events of [
    { data: null },
    { data: [{ type: 'death', timestamp: 1 }] },
    { data: [], nextPageTimestamp: 0 },
  ]) {
    const c = new WclClient('synthetic', 'synthetic', async (input) =>
      String(input).includes('/oauth/')
        ? response({ access_token: 'T', expires_in: 3600 })
        : response({ data: { reportData: { report: { events } } } }),
    );
    await assert.rejects(
      () => c.wipeCalls(report.code, [fight]),
      (e: unknown) => e instanceof ApiError,
    );
  }
});
test('full ingestion retains post-call facts; accepted resurrection stops dead time without erasing death', async () => {
  const { report, fight } = fixture({ boss: 990001 });
  fight.kill = false;
  report.wipeCalls = { [fight.id]: 70000 };
  class Client extends WclClient {
    override async tables(_code: string, bounded: typeof fight) {
      assert.equal(bounded.endTime, fight.endTime);
      return {
        damage: { entries: [{ id: 1, total: 12000 }] },
        healing: { entries: [] },
        taken: { entries: [] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      assert.equal(args[1].endTime, fight.endTime);
      args[3]([
        { type: 'cast', sourceID: 1, abilityGameID: 42, timestamp: 11000 },
        { type: 'death', targetID: 1, timestamp: 20000 },
        { type: 'resurrect', sourceID: 2, targetID: 1, abilityGameID: 20484, timestamp: 40000 },
        { type: 'resurrect', sourceID: 2, targetID: 1, abilityGameID: 20484, timestamp: 40000 },
        { type: 'cast', sourceID: 1, abilityGameID: 42, timestamp: 80000 },
        { type: 'death', targetID: 1, timestamp: 90000 },
        { type: 'death', targetID: 1, timestamp: 90000 },
      ]);
    }
  }
  const p = await ingestPull(
    new Client('synthetic', 'synthetic'),
    report,
    fight,
    new Map([[20484, 'Rebirth']]),
    async () => {},
  );
  const m = p.metrics[0];
  assert.equal(m.deaths, 2);
  assert.equal(m.aliveMs, 60000);
  assert.equal(m.facts!.casts, 2);
  assert.equal(m.facts!.lifeEvents.length, 3);
  assert.equal(m.facts!.lifeEvents[1].combatRes, true);
  assert.deepEqual(p.window, { endTime: fight.endTime, source: 'full', confirmed: true });
  assert.equal(p.fight.endTime, 310000);
  assert.equal(analyze(report, [p], selection).players.length, 4);
});
test('API starts automatically and ignores obsolete manual overrides', async () => {
  const { report, fight } = fixture();
  fight.kill = false;
  report.wipeCalls = {};
  const store = new MemoryStore();
  await store.putReport(report);
  let queued = 0;
  const app = await createApi(store, new WclClient('synthetic', 'synthetic'), async () => {
    queued++;
  });
  try {
    for (const value of [selection, { ...selection, wipeStops: { '1': 60000 } }]) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/analyses',
        payload: { reportCode: report.code, selection: value },
      });
      assert.equal(r.statusCode, 202);
      assert.equal((await store.getJob(r.json().id))!.selection.wipeStops, undefined);
    }
    assert.equal(queued, 2);
  } finally {
    await app.close();
  }
});
test('terminal death bursts cannot erase the first death or shorten the full encounter', () => {
  const { fight } = fixture({ roles: Array(20).fill('dps') });
  fight.kill = false;
  const life = new Map<number, { timestamp: number; type: string }[]>();
  life.set(1, [{ type: 'death', timestamp: 20000 }]);
  for (let id = 2; id <= 20; id++)
    life.set(id, [{ type: 'death', timestamp: 200000 + (id - 2) * 500 }]);
  assert.equal(automaticEnd(fight, life), fight.endTime);
  fight.kill = true;
  assert.equal(automaticEnd(fight, life), fight.endTime);
});
test('a recovered collapse and Feign Death do not manufacture an early stop', () => {
  const { fight } = fixture({ roles: Array(20).fill('dps') });
  fight.kill = false;
  const life = new Map<number, { timestamp: number; type: string; feign?: boolean }[]>();
  for (let id = 1; id <= 10; id++)
    life.set(id, [
      { type: 'death', timestamp: 100000 },
      { type: 'resurrect', timestamp: 103000 },
    ]);
  life.set(11, [{ type: 'death', timestamp: 200000, feign: true }]);
  assert.equal(automaticEnd(fight, life), fight.endTime);
});
test('full ingestion reads one event stream and preserves every terminal death without exposing private cache facts', async () => {
  const { report, fight } = fixture({ boss: 990001, roles: Array(20).fill('dps') });
  fight.kill = false;
  report.wipeCalls = {};
  let streams = 0,
    tables = 0;
  class Client extends WclClient {
    override async tables(_code: string, bounded: typeof fight) {
      tables++;
      assert.equal(bounded.endTime, fight.endTime);
      return {
        damage: { entries: report.players.map((p) => ({ id: p.id, total: 1 })) },
        healing: { entries: [] },
        taken: { entries: [] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      streams++;
      assert.equal(args[1].endTime, fight.endTime);
      args[3]([
        { type: 'death', targetID: 1, timestamp: 20000 },
        ...report.players
          .slice(1)
          .map((p, i) => ({ type: 'death', targetID: p.id, timestamp: 200000 + i * 500 })),
      ]);
    }
  }
  const p = await ingestPull(new Client('s', 's'), report, fight, new Map(), async () => {});
  assert.equal(streams, 1);
  assert.equal(tables, 1);
  assert.equal(p.window!.endTime, fight.endTime);
  assert.equal(p.metrics[0].deaths, 1);
  assert.equal(p.metrics[1].deaths, 1);
  assert.equal(p.metrics[0].aliveMs, 10000);
  assert.equal(p.metrics[1].aliveMs, 190000);
  const a = analyze(report, [p], selection);
  assert.ok(
    a.players.every(
      (p) => p.score !== null && p.scoredPulls === 1 && p.execution.deathPenalty === 0,
    ),
  );
  for (const player of a.players) {
    const measured = p.metrics.find((m) => m.actorId === player.id)!;
    assert.equal(player.aliveMs, measured.aliveMs);
    assert.equal(player.deaths, measured.deaths);
    assert.ok(
      Math.abs(
        player.execution.composite!.components.survival.score! - (100 * measured.aliveMs) / 300000,
      ) < 1e-9,
    );
    assert.equal(player.execution.composite!.components.mechanics.score, null);
    assert.equal(player.execution.composite!.scope, 'output-survival');
    assert.equal(player.execution.composite!.components.mechanics.weight, 0);
    assert.equal(player.execution.composite!.complete, true);
  }
  assert.ok(!('boundaryLife' in a.pulls[0]));
  const before = pullCacheKey(report, fight, p.window!);
  assert.equal(before, pullCacheKey(report, fight, assessmentWindow(report, fight, selection)));
  p.window!.endTime++;
  assert.throws(() => analyze(report, [p], selection), /window/);
});

test('a death exactly at encounter end is retained without inventing post-encounter dead time', async () => {
  const { report, fight } = fixture({ boss: 990001 });
  class Client extends WclClient {
    override async tables() {
      return {
        damage: { entries: report.players.map((p) => ({ id: p.id, total: 1 })) },
        healing: { entries: [] },
        taken: { entries: [] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      args[3]([{ type: 'death', targetID: 1, timestamp: fight.endTime }]);
    }
  }
  const p = await ingestPull(new Client('s', 's'), report, fight, new Map(), async () => {});
  assert.equal(p.metrics[0].deaths, 1);
  assert.equal(p.metrics[0].aliveMs, fight.endTime - fight.startTime);
  assert.equal(p.metrics[0].facts!.lifeEvents[0].timestamp, fight.endTime);
  assert.ok(p.metrics[0].evidence.some((e) => e.kind === 'death' && e.timestamp === fight.endTime));
});

test('obsolete shorter assessment windows cannot be relabelled as valid full-pull measurements', () => {
  const { report, pull, fight } = fixture();
  fight.kill = false;
  report.wipeCalls = { [fight.id]: 90000 };
  pull.window = { endTime: 90000, source: 'logged', confirmed: true };
  assert.throws(() => analyze(report, [pull], selection), /window/i);
  pull.window = { endTime: fight.endTime, source: 'full', confirmed: true };
  const key = pullCacheKey(report, fight, pull.window);
  assert.match(key, /full/);
  assert.throws(() => analyze(report, [pull], selection), /missing life/);
  for (const m of pull.metrics) m.life = summarizeLife(pull.fight, m.facts?.lifeEvents ?? []);
  assert.ok(analyze(report, [pull], selection).players.every((p) => p.durationMs === 300000));
});
test('explicit repair redirects serve new scores while retaining old stored snapshots and never enqueue on reads', async () => {
  const { report, pull } = fixture();
  const store = new MemoryStore();
  const a = await store.createJob(report.code, selection, false),
    b = await store.createJob(report.code, selection, false);
  const original = analyze(report, [pull], selection);
  await store.updateJob(a.id, { status: 'complete', result: original });
  await store.updateJob(b.id, { status: 'complete', result: { ...original, version: '0.10.0' } });
  store.jobs.get(a.id)!.replacementId = b.id;
  let enqueues = 0;
  const app = await createApi(store, new WclClient('', ''), async () => {
    enqueues++;
  });
  try {
    const r = await app.inject(`/api/analyses/${a.id}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().id, b.id);
    assert.equal(enqueues, 0);
    assert.equal((await store.getJob(a.id))!.result, original);
    store.jobs.get(b.id)!.replacementId = a.id;
    assert.equal((await app.inject(`/api/analyses/${a.id}`)).statusCode, 502);
  } finally {
    await app.close();
  }
});
test('legacy mechanic observation families still resolve to real catalogue rules', () => {
  const ids = new Set(
    ENCOUNTERS.flatMap((e) =>
      e.rules.filter((r) => r.kind === 'avoid').map((r) => `${e.id}/${r.id}`),
    ),
  );
  for (const id of SCORING_FAMILIES) assert.ok(ids.has(id), id);
});
