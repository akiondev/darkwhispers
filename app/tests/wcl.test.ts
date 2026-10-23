import test from 'node:test';
import assert from 'node:assert/strict';
import { WclClient, ApiError } from '../server/wcl.js';
import { demoData } from '../shared/demo.js';
import { MemoryStore } from '../server/store.js';
import { runAnalysis } from '../server/jobs.js';
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
