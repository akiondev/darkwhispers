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
    if (query.startsWith('query WipeCalls'))
      return response({
        data: { reportData: { report: { events: { data: [], nextPageTimestamp: null } } } },
      });
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
test('synthetic future-zone reports import raw facts and all roles without inventing unknown-boss scores', async () => {
  for (const code of ['Z9y8X7w6V5u4T3s2', 'a1B2c3D4e5F6g7H8']) {
    const operations = new Set<string>();
    const client = new WclClient('synthetic-client', 'synthetic-secret', async (input, init) => {
      if (String(input).includes('/oauth/'))
        return response({ access_token: 'T', expires_in: 3600 });
      const { query, variables } = JSON.parse(String(init?.body));
      assert.equal(variables.code, code, 'Every API request uses the submitted report code');
      const operation = /^query (\w+)/.exec(query)?.[1];
      assert.ok(operation);
      operations.add(operation);
      const payloads: Record<string, unknown> = {
        WipeCalls: { events: { data: [], nextPageTimestamp: null } },
        Report: {
          code,
          title: 'Synthetic future-zone compatibility fixture; not live raid data',
          startTime: 1,
          endTime: 102000,
          revision: 1,
          visibility: 'public',
          zone: { name: 'Synthetic Uncatalogued Future Raid' },
          masterData: {
            actors: [
              { id: 21, name: 'SyntheticTank', type: 'Player', subType: 'Warrior' },
              { id: 22, name: 'SyntheticHealer', type: 'Player', subType: 'Druid' },
              { id: 23, name: 'SyntheticDps', type: 'Player', subType: 'Mage' },
            ],
          },
          fights: [
            {
              id: 7,
              encounterID: 990001,
              name: 'Synthetic Uncatalogued Boss',
              difficulty: 4,
              startTime: 1000,
              endTime: 101000,
              kill: false,
              inProgress: false,
              friendlyPlayers: [21, 22, 23],
              friendlySpecs: ['Protection', 'Restoration', 'Fire'],
            },
          ],
        },
        Abilities: { masterData: { abilities: [] } },
        Tables: {
          damage: {
            entries: [
              { id: 21, total: 12000 },
              { id: 23, total: 90000 },
            ],
          },
          healing: { entries: [{ id: 22, total: 100000 }] },
          taken: {
            entries: [
              { id: 21, total: 160000 },
              { id: 23, total: 25000 },
            ],
          },
        },
        Events: {
          events: {
            data: [
              { type: 'cast', timestamp: 2000, sourceID: 21, abilityGameID: 990002 },
              { type: 'cast', timestamp: 2000, sourceID: 22, abilityGameID: 990003 },
              { type: 'cast', timestamp: 2000, sourceID: 23, abilityGameID: 990004 },
              { type: 'death', timestamp: 21000, targetID: 21 },
              { type: 'resurrect', timestamp: 41000, targetID: 21 },
              { type: 'death', timestamp: 90000, targetID: 23 },
            ],
            nextPageTimestamp: null,
          },
        },
      };
      const payload = payloads[operation];
      assert.ok(payload, `Unexpected GraphQL operation: ${operation}`);
      return response({ data: { reportData: { report: payload } } });
    });
    const store = new MemoryStore();
    const job = await store.createJob(
      code,
      {
        encounterId: null,
        difficulty: null,
        mode: 'all',
        fightIds: null,
        excludeWipeTail: false,
      },
      false,
    );
    await runAnalysis(job.id, store, client);
    const finished = (await store.getJob(job.id))!;
    assert.equal(finished.status, 'complete', finished.error);
    const result = finished.result!;
    assert.equal(result.report.code, code);
    assert.equal(result.report.source, 'warcraftlogs');
    assert.equal(result.report.zone, 'Synthetic Uncatalogued Future Raid');
    assert.equal(result.pulls[0].fight.encounterId, 990001);
    assert.deepEqual([...operations].sort(), ['Abilities', 'Events', 'Report', 'Tables']);
    assert.deepEqual(result.players.map((p) => p.role).sort(), ['dps', 'healer', 'tank']);
    const tank = result.players.find((p) => p.id === 21)!;
    const healer = result.players.find((p) => p.id === 22)!;
    const dps = result.players.find((p) => p.id === 23)!;
    assert.deepEqual(
      [tank.damage, tank.damageTaken, tank.aliveMs, tank.deaths],
      [12000, 160000, 80000, 1],
    );
    assert.deepEqual([healer.healing, healer.aliveMs, healer.deaths], [100000, 100000, 0]);
    assert.deepEqual(
      [dps.damage, dps.damageTaken, dps.aliveMs, dps.deaths],
      [90000, 25000, 89000, 1],
    );
    for (const player of result.players) {
      assert.equal(player.durationMs, 100000);
      assert.equal(
        player.score,
        null,
        'Unknown mechanics cannot become a complete survival-only composite',
      );
      assert.equal(player.execution.scoreBasis, 'composite');
      const composite = player.execution.composite!;
      assert.equal(composite.components.survival.score, player.execution.alivePercent);
      assert.equal(composite.components.mechanics.score, null);
      assert.equal(composite.components.output.score, null, 'Each role has only one participant');
      assert.equal(composite.components.preparation.score, null);
      assert.equal(composite.lower, composite.components.survival.points);
      assert.ok(composite.upper > composite.lower);
      assert.equal(player.roleRank, null);
      assert.equal(player.execution.mechanicsScore, null);
      assert.equal(player.execution.checkedMechanics, 0);
      assert.equal(player.pullReviews[0].facts.casts, 1);
    }
  }
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
test('one shared full-pull event stream records survival, preparation, casts and utility without invented mechanic scores', async () => {
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  const fight = { ...report.fights[0], kill: true };
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
      assert.ok(args[4]!.includes('(type = "cast" and source.type = "player")'));
      assert.ok(args[4]!.includes('type = "combatantinfo"'));
      assert.ok(
        !args[4]!.includes('ability.id = 22812'),
        'All player casts share one stream across classes',
      );
      assert.equal(args[5]?.includeResources, true);
      args[3]([
        { type: 'combatantinfo', sourceID: 7, timestamp: 0, auras: [{ ability: 1235111 }] },
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
    override async killPercentiles(): Promise<never> {
      throw new Error('Kill-only output percentiles must not be requested');
    }
  }
  const result = await ingestPull(
    new FixtureClient('c', 's'),
    report,
    fight,
    new Map([
      [22812, 'Barkskin'],
      [1235111, 'Flask of the Shattered Sun'],
    ]),
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
  assert.equal(metric.mechanicOpportunities, null);
  assert.equal(metric.outputPercentile, null);
  assert.equal(metric.facts?.snapshot, true);
  assert.equal(metric.facts?.activeAtPull[0].category, 'flask');
  assert.equal(metric.facts?.casts, 2);
  assert.deepEqual(metric.facts?.lifeEvents, [
    { type: 'death', timestamp: 20000 },
    { type: 'resurrect', timestamp: 40000 },
  ]);
  assert.equal(metric.activity, undefined);
  assert.equal(metric.tank, undefined);
  assert.equal(metric.evaluated, undefined);
  assert.equal(result.evaluation, undefined);
  assert.equal(result.wipeTailMs, 0);
  assert.ok(metric.evidence.find((e) => e.kind === 'death')?.url?.includes('fight=1'));
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

test('required Ravage hits and a vulnerable swap review remain context, not tank score penalties', async () => {
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
      assert.ok(args[4]?.includes('source.disposition = "enemy"'));
      assert.ok(args[4]?.includes('type = "damage"'));
      assert.ok(
        args[4]?.includes('ability.id = 1277105'),
        'Vulnerability snapshots remain available for contextual review',
      );
      assert.ok(args[4]?.includes('(type = "cast" and source.type = "player")'));
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
  assert.equal(p.metrics[0].taunts, 1);
  assert.equal(p.metrics[2].healing, 100);
  assert.equal(p.metrics[2].overhealing, 20);
  assert.equal(p.metrics[2].healingCooldowns, 1);
  assert.equal(p.metrics[1].deaths, 1, 'An unlabelled environmental death is still real');
  assert.equal(
    p.metrics[0].mechanicFailures,
    0,
    'Assigned tank hits cannot be scored against a common role-wide exposure denominator',
  );
  const duty = p.metrics[0].mechanics!.find((r) => r.name === 'Ravage')!;
  assert.equal(
    duty.failures,
    1,
    'The observed vulnerable follow-up remains available for human review',
  );
  assert.equal(duty.unknown, 1);
  assert.equal(duty.opportunities, 1);
  assert.equal(duty.scoreEligible, false);
  assert.equal(p.metrics[0].mechanicOpportunities, 0);
  assert.ok(p.metrics[0].evidence.some((e) => e.kind === 'mechanic-observed'));
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

test('an endpoint continuation page retains the death at exact encounter end', async () => {
  const fight = { ...demoData().report.fights[0], startTime: 100, endTime: 200 };
  let calls = 0;
  const c = new WclClient('synthetic', 'synthetic', async (input, init) => {
    if (String(input).includes('/oauth/')) return response({ access_token: 'T', expires_in: 3600 });
    const { variables } = JSON.parse(String(init?.body));
    calls++;
    assert.equal(variables.start, calls === 1 ? 100 : 200);
    return response({
      data: {
        reportData: {
          report: {
            events:
              calls === 1
                ? { data: [], nextPageTimestamp: 200 }
                : {
                    data: [{ type: 'death', timestamp: 200, targetID: 1 }],
                    nextPageTimestamp: null,
                  },
          },
        },
      },
    });
  });
  const found: unknown[] = [];
  await c.events('6fjJxRFC21YHdTXB', fight, 'All', (page) => found.push(...page));
  assert.equal(calls, 2);
  assert.equal(found.length, 1);
});
