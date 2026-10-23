import test from 'node:test';
import assert from 'node:assert/strict';
import { WclClient, ApiError } from '../server/wcl.js';
import { demoData } from '../shared/demo.js';
import { MemoryStore } from '../server/store.js';
import { runAnalysis } from '../server/jobs.js';
import { ingestPull } from '../server/ingest.js';
const response = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
test('OAuth refresh is single-flight and upstream concurrency is bounded at three', async () => {
  let auth = 0,
    active = 0,
    max = 0;
  const client = new WclClient('client', 'private', async (input) => {
    if (String(input).includes('/oauth/')) {
      auth++;
      return response({ access_token: 'TOKEN', expires_in: 3600 });
    }
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 3));
    active--;
    return response({ data: { ok: true } });
  });
  await Promise.all(Array.from({ length: 20 }, () => client.query('query{ok}')));
  assert.equal(auth, 1);
  assert.equal(max, 3);
});
test('event pagination follows empty pages and rejects a non-advancing cursor', async () => {
  let pages = 0;
  const fight = demoData().report.fights[0];
  const client = new WclClient('c', 's', async (input) =>
    String(input).includes('/oauth/')
      ? response({ access_token: 'T', expires_in: 3600 })
      : response({
          data: {
            reportData: {
              report: {
                events:
                  ++pages === 1
                    ? { data: [], nextPageTimestamp: 100 }
                    : { data: [{ type: 'death', timestamp: 200 }], nextPageTimestamp: null },
              },
            },
          },
        }),
  );
  const events: unknown[] = [];
  await client.events('6fjJxRFC21YHdTXB', fight, 'All', (page) => events.push(...page));
  assert.equal(pages, 2);
  assert.equal(events.length, 1);
  const bad = new WclClient('c', 's', async (input) =>
    String(input).includes('/oauth/')
      ? response({ access_token: 'T', expires_in: 3600 })
      : response({
          data: { reportData: { report: { events: { data: [], nextPageTimestamp: 0 } } } },
        }),
  );
  await assert.rejects(
    () => bad.events('6fjJxRFC21YHdTXB', fight, 'All', () => {}),
    (e: unknown) => e instanceof ApiError && e.code === 'WCL_PAGINATION_FAILED',
  );
});
test('401 refresh and 429 backoff are bounded; partial GraphQL results are rejected', async () => {
  let auth = 0,
    calls = 0,
    pauses = 0;
  const client = new WclClient(
    'c',
    's',
    async (input) => {
      if (String(input).includes('/oauth/')) {
        auth++;
        return response({ access_token: `T${auth}`, expires_in: 3600 });
      }
      calls++;
      return calls === 1
        ? response({}, 401)
        : calls === 2
          ? response({}, 429, { 'retry-after': '1' })
          : response({ data: { ok: true } });
    },
    async () => {
      pauses++;
    },
  );
  assert.equal((await client.query('x')).ok, true);
  assert.equal(auth, 2);
  assert.equal(pauses, 1);
  const partial = new WclClient('c', 's', async (input) =>
    String(input).includes('/oauth/')
      ? response({ access_token: 'T', expires_in: 3600 })
      : response({ data: { reportData: {} }, errors: [{ message: 'Field not available' }] }),
  );
  await assert.rejects(
    () => partial.query('x'),
    (e: unknown) => e instanceof ApiError && e.code === 'WCL_QUERY_FAILED',
  );
});
test('API budget exhaustion stops subsequent requests and missing credentials never fetch', async () => {
  let calls = 0;
  const client = new WclClient('c', 's', async (input) => {
    if (String(input).includes('/oauth/')) return response({ access_token: 'T', expires_in: 3600 });
    calls++;
    return response({
      data: { rateLimitData: { limitPerHour: 100, pointsSpentThisHour: 98, pointsResetIn: 100 } },
    });
  });
  await client.query('x');
  await assert.rejects(() => client.query('x'));
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      new WclClient('', '', async () => {
        throw Error('Must not fetch');
      }).query('x'),
    (e: unknown) => e instanceof ApiError && e.code === 'WCL_NOT_CONFIGURED',
  );
});
test('invalid event records are rejected before aggregation, not silently counted as perfect survival', async () => {
  for (const event of [{}, { type: 'death' }, { type: 'death', timestamp: '200' }, null]) {
    const client = new WclClient('c', 's', async (input) =>
      String(input).includes('/oauth/')
        ? response({ access_token: 'T', expires_in: 3600 })
        : response({
            data: {
              reportData: { report: { events: { data: [event], nextPageTimestamp: null } } },
            },
          }),
    );
    let called = false;
    await assert.rejects(
      () =>
        client.events('6fjJxRFC21YHdTXB', demoData().report.fights[0], 'All', () => {
          called = true;
        }),
      (e: unknown) => e instanceof ApiError && e.code === 'WCL_INVALID_EVENTS',
    );
    assert.equal(called, false);
  }
});
test('one filtered event stream produces survival, defenses, utility and unscored observations', async () => {
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  const fight = report.fights[0];
  let eventScans = 0,
    tableScans = 0;
  class FixtureClient extends WclClient {
    override async tables() {
      tableScans++;
      return {
        damage: { entries: [{ id: 7, total: 1000 }] },
        healing: { entries: [] },
        taken: { entries: [{ id: 7, total: 500 }] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      eventScans++;
      assert.equal(args[2], 'All');
      assert.ok(args[4]!.includes('ability.id = 22812'));
      assert.ok(args[4]!.includes('type = "applydebuff"'));
      args[3]([
        { type: 'death', targetID: 7, timestamp: 20000 },
        { type: 'applydebuff', targetID: 7, timestamp: 21000, abilityGameID: 999 },
        { type: 'applydebuff', targetID: 7, timestamp: 23000, abilityGameID: 999 },
        { type: 'cast', sourceID: 7, timestamp: 30000, abilityGameID: 22812 },
      ]);
      args[3]([
        { type: 'resurrect', targetID: 7, timestamp: 40000 },
        { type: 'interrupt', sourceID: 7, timestamp: 47000, abilityGameID: 106839 },
        { type: 'dispel', sourceID: 7, timestamp: 50000, abilityGameID: 2782 },
        { type: 'steal', sourceID: 7, timestamp: 52000, abilityGameID: 30449 },
        { type: 'cast', sourceID: 7, timestamp: 60000, abilityGameID: 22812 },
      ]);
    }
  }
  const result = await ingestPull(
    new FixtureClient('c', 's'),
    report,
    fight,
    new Map([[22812, 'Barkskin']]),
    async () => {},
  );
  const metric = result.metrics.find((m) => m.actorId === 7)!;
  assert.equal(eventScans, 1);
  assert.equal(tableScans, 1);
  assert.equal(metric.aliveMs, 75000);
  assert.equal(metric.deaths, 1);
  assert.equal(metric.damage, 1000);
  assert.equal(metric.damageTaken, 500);
  assert.equal(metric.defensives, 2);
  assert.equal(metric.interrupts, 1);
  assert.equal(metric.dispels, 2);
  assert.equal(metric.mechanicFailures, null);
  const auras = metric.evidence.filter((e) => e.kind === 'mechanic-observed');
  assert.equal(auras.length, 1);
  assert.ok(auras[0].description.includes('2 time(s)'));
  assert.ok(auras[0].url?.includes('fight=1'));
});
test('malformed metric totals fail the import instead of appearing as zero output', async () => {
  class InvalidClient extends WclClient {
    override async tables() {
      return { damage: { entries: [{ id: 7 }] }, healing: { entries: [] }, taken: { entries: [] } };
    }
  }
  const { report } = demoData();
  await assert.rejects(
    () =>
      ingestPull(new InvalidClient('c', 's'), report, report.fights[0], new Map(), async () => {}),
    (e: unknown) => e instanceof ApiError && e.code === 'WCL_INVALID_TABLE',
  );
});
test('changing whole-report analysis to one boss reuses every completed pull and master data', async () => {
  let tables = 0,
    abilities = 0,
    metadata = 0;
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  class FixtureClient extends WclClient {
    override async report() {
      metadata++;
      return report;
    }
    override async abilities() {
      abilities++;
      return new Map<number, string>();
    }
    override async tables() {
      tables++;
      return { damage: { entries: [] }, healing: { entries: [] }, taken: { entries: [] } };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      args[3]([]);
    }
    override async killPercentiles() {
      return new Map<number, number>();
    }
  }
  const client = new FixtureClient('c', 's'),
    store = new MemoryStore();
  const selection = {
    encounterId: null,
    difficulty: null,
    mode: 'all' as const,
    fightIds: null,
    excludeWipeTail: false,
  };
  const first = await store.createJob(report.code, selection, false);
  await runAnalysis(first.id, store, client);
  assert.equal((await store.getJob(first.id))!.status, 'complete');
  assert.equal(tables, 12);
  assert.equal(abilities, 1);
  assert.equal(metadata, 1);
  const second = await store.createJob(report.code, { ...selection, encounterId: 3420 }, false);
  await runAnalysis(second.id, store, client);
  assert.equal((await store.getJob(second.id))!.result!.summary.pulls, 4);
  assert.equal(tables, 12);
  assert.equal(abilities, 1);
  assert.equal(metadata, 1);
});
