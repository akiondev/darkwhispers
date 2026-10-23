import test from 'node:test';
import assert from 'node:assert/strict';
import { WclClient, ApiError, parsePercentile } from '../server/wcl.js';
import { demoData } from '../shared/demo.js';
import { MemoryStore } from '../server/store.js';
import { runAnalysis } from '../server/jobs.js';
import { ingestPull, resolvePlayerSource } from '../server/ingest.js';
const response = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
test('live-compatible report metadata uses fight specs without an unbounded playerDetails query', async () => {
  const client = new WclClient('c', 's', async (input, init) => {
    if (String(input).includes('/oauth/')) return response({ access_token: 'T', expires_in: 3600 });
    const query = JSON.parse(String(init?.body)).query;
    assert.ok(!query.includes('playerDetails'));
    return response({
      data: {
        reportData: {
          report: {
            code: '6fjJxRFC21YHdTXB',
            title: 'Anonymized fixture',
            startTime: 1,
            endTime: 10000,
            revision: 1,
            visibility: 'public',
            zone: { name: 'The Venomous Abyss' },
            masterData: {
              actors: [
                { id: 1, name: 'FixtureOne', type: 'Player', subType: 'Druid' },
                { id: 2, name: 'FixtureTwo', type: 'Player', subType: 'DeathKnight' },
              ],
            },
            fights: [
              {
                id: 17,
                encounterID: 3420,
                name: 'Sszorak',
                difficulty: 5,
                startTime: 100,
                endTime: 1000,
                kill: false,
                friendlyPlayers: [1, 2],
                friendlySpecs: ['Restoration', 'Blood'],
                inProgress: false,
              },
              {
                id: 19,
                encounterID: 3420,
                name: 'Sszorak',
                difficulty: 5,
                startTime: 1100,
                endTime: 2000,
                kill: false,
                friendlyPlayers: [1, 2],
                friendlySpecs: ['Balance', 'Blood'],
                inProgress: false,
              },
            ],
          },
        },
      },
    });
  });
  const report = await client.report('6fjJxRFC21YHdTXB');
  assert.equal(report.fights[0].playerSpecs?.[1], 'Restoration');
  assert.equal(report.players[0].role, 'unknown');
  assert.equal(report.players[0].spec, 'Mixed');
  assert.equal(report.players[1].role, 'tank');
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

test('ordinary GraphQL failures mentioning generated data are not misreported as rate limits', async () => {
  const client = new WclClient('c', 's', async (input) =>
    String(input).includes('/oauth/')
      ? response({ access_token: 'T', expires_in: 3600 })
      : response({ errors: [{ message: 'Could not generate the requested data' }] }),
  );
  await assert.rejects(
    () => client.query('x'),
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
        { type: 'death', targetID: 7, timestamp: 10000, feign: true },
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
  assert.equal(metric.evidence.filter((e) => e.kind === 'death').length, 1);
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

test('required first Ravage is unknown, while a new hit with verified prior vulnerability creates a swap review', async () => {
  const { report } = demoData();
  const fight = { ...report.fights[0], encounterId: 3420 };
  class Client extends WclClient {
    async tables() {
      return {
        damage: { entries: [] },
        healing: { entries: [{ id: 3, total: 100, overheal: 20 }] },
        taken: { entries: [] },
      };
    }
    async events(...args: Parameters<WclClient['events']>) {
      assert.ok(
        args[4]?.includes('((type = "damage" and ability.id = 1277101) or ability.id = 1277105)'),
        'Use WCL hit classification for Ravage; serialized damage also includes misses/immunities',
      );
      assert.ok(args[4]?.includes('ability.id = 56222'));
      assert.ok(!args[4]?.includes('ability.id = 3716'), 'Pet Torment is not a class taunt cast');
      assert.ok(
        !args[4]?.includes('type = "taunt"'),
        'Taunts are recorded as casts, not a taunt event type',
      );
      args[3]([
        { type: 'cast', sourceID: 1, targetID: 202, abilityGameID: 56222, timestamp: 5000 },
        { type: 'cast', sourceID: 1, targetID: 202, abilityGameID: 3716, timestamp: 5500 },
        { type: 'cast', sourceID: 3, abilityGameID: 740, timestamp: 6000 },
        {
          type: 'applydebuff',
          sourceID: 202,
          targetID: 1,
          abilityGameID: 1277105,
          timestamp: 10000,
        },
        { type: 'damage', sourceID: 202, targetID: 1, abilityGameID: 1277101, timestamp: 10000 },
        { type: 'damage', sourceID: 202, targetID: 1, abilityGameID: 1277101, timestamp: 20000 },
        {
          type: 'applydebuffstack',
          sourceID: 202,
          targetID: 1,
          abilityGameID: 1277105,
          timestamp: 20000,
        },
        { type: 'death', targetID: 2, sourceID: -1, abilityGameID: 0, timestamp: 80000 },
      ]);
    }
  }
  const p = await ingestPull(
    new Client('c', 's'),
    report,
    fight,
    new Map([
      [1277101, 'Ravage'],
      [1277105, 'Ravage'],
      [740, 'Tranquility'],
      [56222, 'Dark Command'],
      [3716, 'Torment'],
    ]),
    async () => {},
  );
  assert.equal(p.metrics[0].ravageHits, 2);
  assert.equal(p.metrics[0].ravageVulnerableHits, 1);
  assert.equal(p.metrics[0].taunts, 1);
  assert.equal(p.metrics[2].healing, 100);
  assert.equal(p.metrics[2].overhealing, 20);
  assert.equal(p.metrics[2].healingCooldowns, 1);
  assert.equal(p.metrics[1].deaths, 1, 'An unlabelled environmental death is still real');
  assert.equal(
    p.metrics[0].mechanicFailures,
    1,
    'The first required hit is not failed; only the second strike with observed prior vulnerability fails the swap check',
  );
  const duty = p.metrics[0].mechanics!.find((r) => r.name === 'Ravage')!;
  assert.equal(duty.unknown, 1);
  assert.equal(duty.opportunities, 1);
});
test('unranked percentile placeholders are missing values, and pet ownership is bounded', () => {
  assert.equal(parsePercentile('-'), null);
  assert.equal(parsePercentile(''), null);
  assert.equal(parsePercentile('99.25'), 99.25);
  assert.equal(parsePercentile(0), 0);
  assert.equal(parsePercentile(101), null);
  assert.equal(resolvePlayerSource(5, { 5: 77, 77: 7 }), 7);
  assert.equal(resolvePlayerSource(5, { 5: 77, 77: 5 }), 0);
  assert.equal(resolvePlayerSource(7, {}), 7);
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

test('a queued selection that loses a requested pull fails rather than analyzing a smaller set', async () => {
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  const store = new MemoryStore();
  const job = await store.createJob(
    report.code,
    { encounterId: null, difficulty: null, mode: 'all', fightIds: [1, 2], excludeWipeTail: false },
    false,
  );
  report.fights = report.fights.filter((f) => f.id !== 2);
  await store.putReport(report);
  const client = new WclClient('c', 's', async () => {
    throw new Error('No download should begin for a changed selection');
  });
  await runAnalysis(job.id, store, client);
  assert.equal((await store.getJob(job.id))!.errorCode, 'SELECTION_CHANGED');
  assert.equal((await store.getJob(job.id))!.result, undefined);
  await runAnalysis(job.id, store, client);
  assert.equal((await store.getJob(job.id))!.status, 'failed');
});
