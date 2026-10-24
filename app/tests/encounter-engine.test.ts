import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ENCOUNTERS, RAID_DIFFICULTIES } from '../shared/encounters.js';
import { evaluateEncounter, type EncounterEvent } from '../server/encounter-engine.js';
import { baseMetric } from '../server/ingest.js';
import { demoData } from '../shared/demo.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { analyze } from '../shared/analysis.js';
import { MemoryStore } from '../server/store.js';
import type { Analysis, Role, PullData } from '../shared/types.js';
function fixture(boss = 3420, difficulty = 5, role: Role = 'tank') {
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.visibility = 'public';
  report.code = '6fjJxRFC21YHdTXB';
  report.players = [
    {
      id: 1,
      name: 'TankA',
      class: 'DeathKnight',
      spec: role === 'tank' ? 'Blood' : role === 'healer' ? 'Restoration' : 'Balance',
      role,
    },
    { id: 2, name: 'TankB', class: 'Warrior', spec: 'Protection', role: 'tank' },
    { id: 3, name: 'Damage', class: 'Mage', spec: 'Frost', role: 'dps' },
  ];
  const fight = {
    ...report.fights[0],
    encounterId: boss,
    id: 1,
    startTime: 0,
    endTime: 120000,
    difficulty,
    friendlyPlayers: [1, 2, 3],
    playerSpecs: Object.fromEntries(report.players.map((p) => [p.id, p.spec])),
  };
  report.fights = [fight];
  report.wipeCalls = {};
  const metrics = new Map(report.players.map((p) => [p.id, baseMetric(p.id, 120000)]));
  return { report, fight, metrics };
}
const e = (
  type: string,
  timestamp: number,
  id: number,
  targetID = 1,
  extra: Partial<EncounterEvent> = {},
): EncounterEvent => ({ type, timestamp, abilityGameID: id, sourceID: 202, targetID, ...extra });
test('all ten encounter catalogues gate Mythic mechanics and keep required raid damage contextual on every difficulty', () => {
  assert.equal(ENCOUNTERS.length, 10);
  assert.equal(new Set(ENCOUNTERS.map((e) => e.id)).size, 10);
  for (const boss of ENCOUNTERS)
    for (const difficulty of RAID_DIFFICULTIES) {
      const { report, fight, metrics } = fixture(boss.id, difficulty);
      const abilities = new Map<number, string>();
      let id = 9000000;
      for (const rule of boss.rules) for (const name of rule.hits) abilities.set(id++, name);
      evaluateEncounter(report, fight, metrics, [], new Map(), abilities);
      for (const m of metrics.values()) {
        assert.equal(m.mechanicFailures, 0);
        assert.equal(m.mechanicOpportunities, 0);
        assert.ok(m.mechanics!.every((r) => r.failures === 0 && r.opportunities === 0));
        assert.equal(
          m.mechanics!.some((r) => r.name === 'Water Jet'),
          boss.id === 3379 && difficulty === 5,
        );
        assert.equal(
          m.mechanics!.some((r) => r.name === 'Iceblade Flurry'),
          boss.id === 3379 && difficulty !== 5,
        );
      }
    }
});
test('same-time initial tank aura and full absorbs are required contact, while a second fresh strike under vulnerability is a swap review', () => {
  for (const profile of TANK_PROFILES) {
    const { report, fight, metrics } = fixture();
    report.players[0] = { ...report.players[0], class: profile.class, spec: profile.spec };
    fight.playerSpecs[1] = profile.spec;
    const abilities = new Map([
      [1277101, 'Ravage'],
      [1277105, 'Ravage'],
      [1277002, 'Ravage'],
    ]);
    const events = [
      e('begincast', 1000, 1277002),
      e('applydebuff', 2000, 1277105),
      e('damage', 2000, 1277101, 1, { amount: 0, absorbed: 100000 }),
      e('begincast', 9000, 1277002),
      e('damage', 10000, 1277101),
      e('refreshdebuff', 10000, 1277105),
      e('removedebuff', 20000, 1277105),
      e('begincast', 29000, 1277002),
      e('damage', 30000, 1277101),
    ];
    evaluateEncounter(report, fight, metrics, events, new Map(), abilities);
    const r = metrics.get(1)!.mechanics!.find((r) => r.name === 'Ravage')!;
    assert.equal(r.failures, 1, profile.class);
    assert.equal(r.opportunities, 2);
    assert.equal(r.unknown, 1);
    assert.equal(r.events[0].outcome, 'unknown');
  }
});
test('tank channel components share their cast even when they extend past six seconds', () => {
  const { report, fight, metrics } = fixture(3379, 4);
  const abilities = new Map([
    [1282937, 'Iceblade Flurry'],
    [1282945, 'Iceblade Flurry'],
    [1282947, 'Iceblade Flurry'],
  ]);
  const events = [
    e('cast', 1000, 1282937),
    e('applydebuff', 1010, 1282947),
    ...Array.from({ length: 9 }, (_, i) => e('damage', 1010 + i * 1000, 1282945)),
    e('removedebuff', 50000, 1282947),
  ];
  evaluateEncounter(report, fight, metrics, events, new Map(), abilities);
  const r = metrics.get(1)!.mechanics!.find((r) => r.name === 'Iceblade Flurry')!;
  assert.equal(r.failures, 0);
  assert.equal(r.opportunities, 0);
  assert.equal(r.unknown, 1);
});
test('Tempest ignores periodic ticks, misses, other sources and dead-only exposure; unknown linkage grants no clean checks', () => {
  const { report, fight, metrics } = fixture();
  const abilities = new Map([
    [1287072, 'Tempest'],
    [1287083, 'Tempest'],
  ]);
  const events = [
    e('begincast', 1000, 1287072),
    e('cast', 1500, 1287072),
    e('damage', 2000, 1287083, 1, { tick: true }),
    e('damage', 3000, 1287083, 1, { missType: 'immune' }),
    e('damage', 4000, 1287083, 3),
    e('damage', 5000, 1287083, 3),
  ];
  evaluateEncounter(
    report,
    fight,
    metrics,
    events,
    new Map([[2, [{ type: 'death', timestamp: 0 }]]]),
    abilities,
  );
  const r = (id: number) => metrics.get(id)!.mechanics!.find((r) => r.name === 'Tempest')!;
  assert.equal(r(1).failures, 0);
  assert.equal(r(1).opportunities, 1);
  assert.equal(r(1).scoreEligible, true);
  assert.equal(r(2).opportunities, 1);
  assert.equal(r(2).missedWhileDead, 1);
  assert.equal(r(3).failures, 1);
  assert.equal(r(3).opportunities, 1, 'Repeated direct hits collapse to one failed cast window');
  assert.equal(r(3).scoreEligible, true);
  evaluateEncounter(report, fight, metrics, [e('damage', 2000, 1287083)], new Map(), abilities);
  assert.equal(r(1).unknown, 1);
  assert.equal(r(1).scoreEligible, false);
  assert.equal(r(2).opportunities, 0);
});

test('Tempest needs a completed cast from the same creature instance before awarding clean checks', () => {
  const { report, fight, metrics } = fixture();
  const abilities = new Map([
    [1287072, 'Tempest'],
    [1287083, 'Tempest'],
  ]);
  const row = (id: number) => metrics.get(id)!.mechanics!.find((r) => r.name === 'Tempest')!;
  evaluateEncounter(report, fight, metrics, [e('begincast', 1000, 1287072)], new Map(), abilities);
  assert.equal(
    row(1).opportunities,
    0,
    'An interrupted start does not establish successful avoidance',
  );
  assert.equal(row(1).scoreEligible, false);
  evaluateEncounter(
    report,
    fight,
    metrics,
    [
      e('begincast', 1000, 1287072, 1, { sourceInstance: 1 }),
      e('cast', 1500, 1287072, 1, { sourceInstance: 1 }),
      e('damage', 2000, 1287083, 3, { sourceInstance: 2 }),
    ],
    new Map(),
    abilities,
  );
  assert.equal(row(1).opportunities, 1);
  assert.equal(row(1).failures, 0);
  assert.equal(row(3).unknown, 1, 'Different creature instances cannot share a cast denominator');
  assert.equal(row(3).scoreEligible, false);
});
test('required Mutilate and Feast do not penalise non-soakers, but repeated vulnerable soaks are separate checks', () => {
  for (const [boss, name, hit, auraName, aura] of [
    [3420, 'Mutilate', 1277031, 'Mutilated Gash', 1285998],
    [3421, 'Ravenous Feast', 1290662, 'Feasted', 1310096],
  ] as const) {
    const { report, fight, metrics } = fixture(boss, 5, 'dps');
    evaluateEncounter(
      report,
      fight,
      metrics,
      [
        e('damage', 1000, hit),
        e('applydebuff', 1000, aura),
        e('damage', 2500, hit),
        e('removedebuff', 30000, aura),
      ],
      new Map(),
      new Map([
        [hit, name],
        [aura, auraName],
      ]),
    );
    const r = metrics.get(1)!.mechanics!.find((r) => r.name === name)!;
    assert.equal(r.failures, 1);
    assert.equal(metrics.get(3)!.mechanicFailures, 0);
    assert.equal(metrics.get(3)!.mechanicOpportunities, 0);
  }
});

test('Living Venom uses completed Toxic Droplets batches, including delayed return contact', () => {
  const { report, fight, metrics } = fixture(3445, 4);
  const abilities = new Map([
    [1284434, 'Toxic Droplets'],
    [1284209, 'Living Venom'],
  ]);
  evaluateEncounter(
    report,
    fight,
    metrics,
    [
      e('begincast', 1000, 1284434),
      e('cast', 2000, 1284434),
      e('damage', 21000, 1284209, 3),
      e('damage', 21500, 1284209, 3),
    ],
    new Map(),
    abilities,
  );
  const row = (id: number) => metrics.get(id)!.mechanics!.find((r) => r.name === 'Living Venom')!;
  assert.equal(row(1).opportunities, 1);
  assert.equal(row(1).failures, 0);
  assert.equal(row(3).opportunities, 1);
  assert.equal(row(3).failures, 1);
  assert.equal(row(3).scoreEligible, true);
  evaluateEncounter(report, fight, metrics, [e('damage', 21000, 1284209, 3)], new Map(), abilities);
  assert.equal(
    row(1).opportunities,
    0,
    'A contact without a parent batch cannot reward others with clean avoidance',
  );
  assert.equal(row(3).scoreEligible, false);
});

test('Kith Devastation checks exclude the explicit tank target for every tank class and collapse physical/shadow components', () => {
  for (const profile of TANK_PROFILES) {
    const { report, fight, metrics } = fixture(3513, 4);
    report.players[0] = { ...report.players[0], class: profile.class, spec: profile.spec };
    fight.playerSpecs[1] = profile.spec;
    const abilities = new Map([
      [1304930, 'Dark Devastation'],
      [1304946, 'Dark Devastation'],
      [1304947, 'Dark Devastation'],
    ]);
    evaluateEncounter(
      report,
      fight,
      metrics,
      [
        e('begincast', 1000, 1304930, 2),
        e('cast', 2000, 1304930, 1),
        e('damage', 2200, 1304946, 1),
        e('damage', 2200, 1304947, 1),
        e('damage', 2200, 1304946, 3),
        e('damage', 2200, 1304947, 3),
      ],
      new Map(),
      abilities,
    );
    const row = (id: number) =>
      metrics.get(id)!.mechanics!.find((r) => r.name === 'Dark Devastation splash')!;
    assert.equal(
      row(1).opportunities,
      0,
      `${profile.class}: completed cast target has required contact`,
    );
    assert.equal(row(1).failures, 0);
    assert.equal(row(1).unknown, 0);
    assert.equal(row(2).opportunities, 1, 'The unmarked tank has an avoidance opportunity');
    assert.equal(row(2).failures, 0);
    assert.equal(row(3).opportunities, 1);
    assert.equal(row(3).failures, 1, 'Two damage components represent one impact');
    assert.equal(row(3).scoreEligible, true);
  }
});

test('Kith Devastation never invents a required tank target or treats a child spell as a parent cast', () => {
  const { report, fight, metrics } = fixture(3513, 4);
  const abilities = new Map([
    [1304930, 'Dark Devastation'],
    [1304946, 'Dark Devastation'],
    [1304947, 'Dark Devastation'],
  ]);
  for (const event of [
    e('cast', 2000, 1304930, 1, { targetID: undefined }),
    e('cast', 2000, 1304930, 3),
    e('cast', 2000, 1304946, 1),
  ]) {
    evaluateEncounter(report, fight, metrics, [event], new Map(), abilities);
    for (const metric of metrics.values()) {
      const row = metric.mechanics!.find((r) => r.name === 'Dark Devastation splash')!;
      assert.equal(row.opportunities, 0);
      assert.equal(row.scoreEligible, false);
    }
  }
});
test('ordinary Gravebound fragment damage is success-compatible; only lethal expiry fails, and cutoffs/deaths censor resolution', () => {
  const { report, fight, metrics } = fixture(3429);
  const abilities = new Map([
    [1286837, 'Gravebound'],
    [1308330, 'Gravebound'],
    [1297906, 'Gravebound'],
  ]);
  const events = [
    e('applydebuff', 1000, 1286837),
    e('damage', 2000, 1308330),
    e('removedebuffstack', 3000, 1286837),
    e('removedebuff', 4000, 1286837),
    e('applydebuff', 30000, 1286837),
    e('death', 45000, 0, 1, { killingAbilityGameID: 1297906 }),
    e('applydebuff', 119000, 1286837, 3),
  ];
  evaluateEncounter(
    report,
    fight,
    metrics,
    events,
    new Map([[1, [{ type: 'death', timestamp: 45000 }]]]),
    abilities,
  );
  const r = metrics.get(1)!.mechanics!.find((r) => r.name === 'Gravebound')!;
  assert.equal(r.failures, 1);
  assert.equal(r.opportunities, 2);
  assert.equal(metrics.get(3)!.mechanics!.find((r) => r.name === 'Gravebound')!.unknown, 1);
});
test('unknown mechanics remain visible without becoming errors or awarding perfection', () => {
  const { report, fight, metrics } = fixture(3513);
  evaluateEncounter(
    report,
    fight,
    metrics,
    [e('damage', 1000, 9999999)],
    new Map(),
    new Map([[9999999, 'Unverified ability']]),
  );
  const row = metrics.get(1)!.mechanics!.find((r) => r.kind === 'unmapped')!;
  assert.equal(row.weight, 0);
  assert.equal(row.failures, 0);
  assert.equal(row.observed, 1);
  assert.equal(row.unknown, 1);
});
test('recent feed excludes synthetic/private/unlisted results, deduplicates reports and retains immutable results', async () => {
  const store = new MemoryStore();
  const { report, pulls } = demoData();
  report.source = 'warcraftlogs';
  report.visibility = 'public';
  const selection = {
    encounterId: null,
    difficulty: null,
    mode: 'all' as const,
    fightIds: null,
    excludeWipeTail: false,
  };
  for (const [visibility, demo] of [
    ['private', false],
    ['unlisted', false],
    ['public', true],
    ['public', false],
    ['public', false],
  ] as const) {
    const job = await store.createJob(report.code, selection, demo);
    const r = analyze({ ...report, visibility }, pulls, selection);
    await store.updateJob(job.id, { status: 'complete', result: r });
  }
  const rows = await store.recentAnalyses();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ['id', 'title', 'reportCode', 'generatedAt', 'bosses', 'pulls', 'players', 'version'].sort(),
  );
  await store.updateJob(rows[0].id, { status: 'failed' });
  assert.equal((await store.getJob(rows[0].id))!.status, 'complete');
});
test('large mechanic timeline benchmark stays bounded and deterministic; 150-pull role/pull review construction', () => {
  const { report, fight, metrics } = fixture();
  const abilities = new Map([
    [1287072, 'Tempest'],
    [1287083, 'Tempest'],
  ]);
  const events: EncounterEvent[] = [];
  for (let i = 0; i < 60; i++) events.push(e('begincast', i * 2000, 1287072));
  for (let i = 0; i < 100000; i++) events.push(e('damage', (i * 7) % 119999, 8888888, 3));
  const t = performance.now();
  evaluateEncounter(report, fight, metrics, events, new Map(), abilities);
  const ms = performance.now() - t;
  assert.ok(ms < 4000, `100k-event engine took ${ms}ms`);
  for (let id = 4; id <= 20; id++) {
    const role = id <= 7 ? ('healer' as const) : ('dps' as const);
    report.players.push({
      id,
      name: `Synthetic ${id}`,
      class: role === 'healer' ? 'Priest' : 'Mage',
      spec: role === 'healer' ? 'Holy' : 'Frost',
      role,
    });
    fight.friendlyPlayers.push(id);
    fight.playerSpecs[id] = role === 'healer' ? 'Holy' : 'Frost';
    metrics.set(id, { ...baseMetric(id, 120000), mechanics: metrics.get(1)!.mechanics });
  }
  const pulls: PullData[] = Array.from({ length: 150 }, (_, i) => ({
    fight: { ...fight, id: i + 1 },
    complete: true,
    warnings: [],
    mechanicRule: 'synthetic-stress',
    mechanicScope: 'partial',
    wipeTailMs: null,
    metrics: [...metrics.values()].map((m) => ({ ...m, evidence: [] })),
  }));
  report.fights = pulls.map((p) => p.fight);
  const start = performance.now();
  const result = analyze(report, pulls, {
    encounterId: null,
    difficulty: null,
    mode: 'all',
    fightIds: null,
    excludeWipeTail: false,
  });
  const elapsed = performance.now() - start;
  assert.equal(result.players[0].role, 'dps');
  assert.equal(result.players[0].pullReviews!.length, 150);
  assert.ok(elapsed < 4000);
  console.log(
    JSON.stringify({
      benchmark: 'synthetic-mechanic-and-review',
      events: events.length,
      mechanicMs: +ms.toFixed(2),
      pulls: 150,
      players: 20,
      playerPullReviews: result.players.reduce((n, p) => n + (p.pullReviews?.length ?? 0), 0),
      reviewMs: +elapsed.toFixed(2),
      networkExcluded: true,
    }),
  );
});
