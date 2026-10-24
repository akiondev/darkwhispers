import test from 'node:test';
import assert from 'node:assert/strict';
import { WclClient, ApiError } from '../server/wcl.js';
import { ingestPull } from '../server/ingest.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { analyze } from '../shared/analysis.js';
import { fixture, selection } from './execution-fixtures.js';
import { formatStop, parseStop } from '../web/WipeStopEditor.js';
import { SCORING_FAMILIES, ENCOUNTERS } from '../shared/encounters.js';
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
test('bounded ingestion excludes post-call casts, deaths and damage queries; battle ress does not erase death', async () => {
  const { report, fight } = fixture({ boss: 990001 });
  fight.kill = false;
  report.wipeCalls = { [fight.id]: 70000 };
  class Client extends WclClient {
    override async tables(_code: string, bounded: typeof fight) {
      assert.equal(bounded.endTime, 70000);
      return {
        damage: { entries: [{ id: 1, total: 12000 }] },
        healing: { entries: [] },
        taken: { entries: [] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      assert.equal(args[1].endTime, 70000);
      args[3]([
        { type: 'cast', sourceID: 1, abilityGameID: 42, timestamp: 11000 },
        { type: 'death', targetID: 1, timestamp: 20000 },
        { type: 'resurrect', sourceID: 2, targetID: 1, abilityGameID: 20484, timestamp: 40000 },
        { type: 'resurrect', sourceID: 2, targetID: 1, abilityGameID: 20484, timestamp: 40000 },
        { type: 'death', targetID: 1, timestamp: 70000 },
        { type: 'death', targetID: 1, timestamp: 75000 },
        { type: 'cast', sourceID: 1, abilityGameID: 42, timestamp: 80000 },
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
  assert.equal(m.deaths, 1);
  assert.equal(m.aliveMs, 40000);
  assert.equal(m.facts!.casts, 1);
  assert.equal(m.facts!.lifeEvents.length, 2);
  assert.equal(m.facts!.lifeEvents[1].combatRes, true);
  assert.deepEqual(p.window, { endTime: 70000, source: 'logged', confirmed: true });
  assert.equal(p.fight.endTime, 310000);
  assert.equal(analyze(report, [p], selection).players.length, 4);
});
test('API persists one shared manual stop and rejects invalid or kill stops before enqueue', async () => {
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
    const result = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { reportCode: report.code, selection: { ...selection, wipeStops: { '1': 60000 } } },
    });
    assert.equal(result.statusCode, 202);
    assert.deepEqual((await store.getJob(result.json().id))!.selection.wipeStops, { '1': 60000 });
    for (const wipeStops of [{ '1': 0 }, { '1': 300001 }, { '999': 1000 }, { bad: 1000 }]) {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/analyses',
        payload: { reportCode: report.code, selection: { ...selection, wipeStops } },
      });
      assert.ok([400, 422].includes(bad.statusCode));
    }
    fight.kill = true;
    const bad = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { reportCode: report.code, selection: { ...selection, wipeStops: { '1': 60000 } } },
    });
    assert.equal(bad.statusCode, 422);
    assert.equal(queued, 1);
  } finally {
    await app.close();
  }
});
test('UI wipe time parsing preserves milliseconds and rejects malformed or zero inputs', () => {
  for (const ms of [1000, 60000, 125123, 3599999]) assert.equal(parseStop(formatStop(ms)), ms);
  for (const text of ['0:00', '1:60', '-1:10', '3', '1:2', '1:10x'])
    assert.equal(parseStop(text), null);
});
test('every fixed scoring family is a real avoid-rule in the versioned catalogue', () => {
  const ids = new Set(
    ENCOUNTERS.flatMap((e) =>
      e.rules.filter((r) => r.kind === 'avoid').map((r) => `${e.id}/${r.id}`),
    ),
  );
  for (const id of SCORING_FAMILIES) assert.ok(ids.has(id), id);
});
