import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { analyze } from '../shared/analysis.js';
import { demoData } from '../shared/demo.js';
import { parseReportCode, selectFights } from '../shared/report-url.js';
import { scoreBand, scoreLabel } from '../shared/score.js';
import { aliveTime } from '../shared/life.js';
import { roleFromSpec, summarizeSpecs } from '../shared/players.js';
import { fixture as baseFixture, selection, check } from './execution-fixtures.js';

function fixture(...args: Parameters<typeof baseFixture>) {
  const result = baseFixture(...args);
  for (const m of result.metrics) {
    m.facts!.snapshot = true;
    m.facts!.preparation = {
      flask: 'present',
      food: 'present',
      basis: 'Synthetic verified preparation fixture.',
    };
  }
  return result;
}

test('selection covers a whole report, boss, wipes, kills and explicitly selected pulls', () => {
  const { report } = demoData();
  assert.equal(selectFights(report, selection).length, 12);
  assert.equal(selectFights(report, { ...selection, encounterId: 3420 }).length, 4);
  assert.equal(selectFights(report, { ...selection, mode: 'wipes' }).length, 9);
  assert.equal(selectFights(report, { ...selection, mode: 'kills' }).length, 3);
  assert.deepEqual(
    selectFights(report, { ...selection, fightIds: [2, 5] }).map((f) => f.id),
    [2, 5],
  );
  report.fights[0].inProgress = true;
  assert.equal(selectFights(report, selection).length, 11);
});

test('report parser never accepts user-chosen upstream hosts or credentials', () => {
  const code = '6fjJxRFC21YHdTXB';
  assert.equal(parseReportCode(`https://www.warcraftlogs.com/reports/${code}?fight=last`), code);
  assert.equal(parseReportCode(code), code);
  for (const url of [
    `http://warcraftlogs.com/reports/${code}`,
    `https://warcraftlogs.com.evil.test/reports/${code}`,
    `https://127.0.0.1/reports/${code}`,
    `https://user:pass@warcraftlogs.com/reports/${code}`,
    'not-a-report',
  ])
    assert.throws(() => parseReportCode(url));
});

test('the labelled demo uses the composite model without pretending to be a real log', () => {
  const { report, pulls } = demoData();
  const result = analyze(report, pulls, selection);
  assert.equal(result.report.source, 'demo');
  assert.equal(result.players.length, 20);
  assert.ok(result.warnings.some((w) => /synthetic|demo/i.test(w)));
  assert.equal(result.model.id, 'composite/v1');
  assert.ok(result.players.every((p) => p.execution.version === 'composite/v1'));
  assert.ok(result.players.every((p) => p.evidence.every((e) => e.url === null)));
  assert.ok(
    result.pulls.every((p) => !('metrics' in p)),
    'Do not return a second full raw metric copy',
  );
});

test('ranking is deterministic and separates role ordinals instead of comparing tank throughput to damage players', () => {
  const { report, pull } = fixture();
  pull.metrics[0].damageTaken = 1e14;
  const first = analyze(report, [pull], selection),
    second = analyze(report, [pull], selection);
  assert.deepEqual(first.players, second.players);
  assert.deepEqual(
    first.players.map((p) => p.role),
    ['dps', 'dps', 'healer', 'tank'],
  );
  assert.equal(new Set(first.players.map((p) => p.rowKey)).size, 4);
  assert.ok(first.players.every((p) => p.rank === p.roleRank));
  const tank = first.players.find((p) => p.role === 'tank')!;
  assert.equal(tank.execution.composite!.components.survival.score, 100);
  assert.equal(tank.execution.composite!.components.output.score, null);
  assert.equal(tank.score, null, 'A single tank is not its own perfect output benchmark');
  const peers = first.players.filter((p) => p.role === 'dps');
  assert.ok(peers.every((p) => p.roleRank === 1 && p.rolePeers === 2));
});

test('input page/actor order cannot change player scores or within-role ranks', () => {
  const { report, pull } = fixture();
  const other = structuredClone(pull);
  other.fight = { ...other.fight, id: 2, encounterId: 3513 };
  other.metrics[2].mechanics = [check(10, 3)];
  report.fights = [pull.fight, other.fight];
  const before = analyze(report, [pull, other], selection);
  const after = analyze(
    report,
    [other, { ...pull, metrics: [...pull.metrics].reverse() }],
    selection,
  );
  const comparable = (result: typeof before) =>
    result.players.map((p) => ({
      rowKey: p.rowKey,
      score: p.score,
      rank: p.roleRank,
      execution: p.execution,
      contexts: [...p.perBoss].sort(
        (a, b) => a.encounterId - b.encounterId || a.difficulty - b.difficulty,
      ),
      pullReviews: [...p.pullReviews].sort((a, b) => a.fightId - b.fightId),
    }));
  assert.deepEqual(comparable(after), comparable(before));
});

test('equal output scaling preserves relative contribution and unrelated counts never manufacture points', () => {
  const { report, pull } = fixture();
  const before = analyze(report, [pull], selection);
  for (const m of pull.metrics) {
    m.damage *= 1000;
    m.healing *= 1000;
    m.damageTaken *= 1000;
    m.outputPercentile = 100;
    m.defensives = 100000;
    m.interrupts = 100000;
    m.dispels = 100000;
    m.overhealing = 1e16;
    m.activity = { activeMs: 0, eligibleMs: 300000, activeWindows: 0, eligibleWindows: 30 };
    m.facts!.casts = 0;
  }
  const after = analyze(report, [pull], selection);
  for (const p of after.players)
    assert.equal(p.score, before.players.find((old) => old.rowKey === p.rowKey)!.score);
  assert.equal(after.players.find((p) => p.id === 1)!.damage, pull.metrics[0].damage);
  assert.equal(after.players.find((p) => p.id === 1)!.damageTaken, pull.metrics[0].damageTaken);
  assert.ok(
    !('assessment' in after.players[0]),
    'Retired neutral-weight assessment must not remain in new results',
  );
});

test('missing, duplicate, incomplete or malformed pull facts fail rather than produce replacement scores', () => {
  const { report, pull } = fixture();
  assert.throws(() => analyze(report, [], selection));
  assert.throws(() => analyze(report, [pull, pull], selection));
  assert.throws(() => analyze(report, [{ ...pull, complete: false }], selection));
  assert.throws(() => analyze(report, [{ ...pull, metrics: pull.metrics.slice(1) }], selection));
  assert.throws(() =>
    analyze(report, [{ ...pull, metrics: [...pull.metrics, pull.metrics[0]] }], selection),
  );
  const invalid = structuredClone(pull);
  invalid.metrics[0].aliveMs = NaN;
  assert.throws(() => analyze(report, [invalid], selection));
});

test('missing attendance contributes neither a zero nor an invented midpoint', () => {
  const { report, pull } = fixture();
  const other = structuredClone(pull);
  other.fight = {
    ...other.fight,
    id: 2,
    encounterId: 3513,
    name: 'Another synthetic boss',
    friendlyPlayers: other.fight.friendlyPlayers.filter((id) => id !== 4),
  };
  other.metrics = other.metrics.filter((m) => m.actorId !== 4);
  other.metrics.forEach((m) => {
    m.mechanics = [check(10, 5)];
    m.mechanicFailures = 5;
  });
  report.fights = [pull.fight, other.fight];
  const player = analyze(report, [pull, other], selection).players.find((p) => p.id === 4)!;
  assert.equal(player.score, 100);
  assert.equal(player.pulls, 1);
  assert.equal(player.scoredPulls, 1);
  assert.equal(player.bosses, 1);
  assert.equal(player.perBoss.length, 1);
});

test('actual per-pull roles produce independent rows for a character who changes role', () => {
  const { report, pull } = fixture();
  const other = structuredClone(pull);
  other.fight.id = 2;
  other.fight.playerSpecs![3] = 'Restoration';
  other.metrics[2].aliveMs = 150000;
  other.metrics[2].deaths = 1;
  report.players[2] = { ...report.players[2], class: 'Druid', spec: 'Mixed', role: 'unknown' };
  pull.fight.playerSpecs![3] = 'Balance';
  report.fights = [pull.fight, other.fight];
  const rows = analyze(report, [pull, other], selection).players.filter((p) => p.id === 3);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((p) => p.role)), new Set(['dps', 'healer']));
  assert.deepEqual(new Set(rows.map((p) => p.rowKey)), new Set(['3:dps', '3:healer']));
  assert.ok(rows.every((p) => p.pulls === 1 && p.pullReviews.length === 1));
  const damage = rows.find((p) => p.role === 'dps')!;
  const healing = rows.find((p) => p.role === 'healer')!;
  assert.equal(damage.execution.alivePercent, 100);
  assert.equal(healing.execution.alivePercent, 50);
  assert.equal(damage.execution.composite!.components.output.weight, 0.3);
  assert.equal(healing.execution.composite!.components.output.weight, 0.2);
  assert.notEqual(damage.score, healing.score);
  const result = analyze(report, [pull, other], selection);
  assert.equal(result.summary.players, 4, 'A role switch does not invent another character');
  assert.equal(result.summary.rankedEntries, 5, 'The actual role rows are reported separately');
});

test('unknown specialization does not invent a damage role', () => {
  assert.equal(roleFromSpec('New unknown specialization'), 'unknown');
  assert.equal(roleFromSpec('Augmentation'), 'dps');
  assert.equal(summarizeSpecs(['Balance', 'Unknown']).role, 'unknown');
  assert.equal(summarizeSpecs(['Balance', 'Feral']).role, 'dps');
  assert.equal(summarizeSpecs(['Restoration', 'Balance']).role, 'unknown');
});

test('recorded resurrection intervals count time actually alive, with no extra flat death deduction', () => {
  const { fight } = fixture();
  assert.equal(
    aliveTime(fight, [
      { type: 'death', timestamp: 30000 },
      { type: 'death', timestamp: 31000 },
      { type: 'resurrect', timestamp: 60000 },
    ]),
    270000,
  );
  assert.equal(aliveTime(fight, [{ type: 'death', timestamp: 30000, feign: true }]), 300000);
  assert.equal(aliveTime(fight, [{ type: 'resurrect', timestamp: 60000 }]), 250000);
  assert.equal(aliveTime(fight, [{ type: 'death', timestamp: fight.endTime }]), 300000);
});

test('old inferred wipe-cutoff facts cannot reactivate retired shortened-window scoring', () => {
  const { report, pull } = fixture();
  pull.fight.kill = false;
  pull.evaluation = { endTime: 60000, reason: 'raid-collapse', excludedMs: 250000 };
  for (const m of pull.metrics) {
    m.aliveMs = 60000;
    m.deaths = 1;
    m.evaluated = { aliveMs: 50000, deaths: 0, mechanicFailures: 0, mechanicOpportunities: 10 };
  }
  const full = analyze(report, [pull], selection),
    flagged = analyze(report, [pull], { ...selection, excludeWipeTail: true });
  assert.deepEqual(flagged.players, full.players);
  assert.equal(flagged.selection.excludeWipeTail, false);
  assert.ok(
    flagged.players.every(
      (p) => p.aliveMs === 60000 && p.durationMs === 300000 && p.execution.alivePercent === 20,
    ),
  );
});

test('complete composite has the correct colour, and score rounding never creates false 100', () => {
  const { report, pull } = fixture();
  const result = analyze(report, [pull], selection);
  assert.ok(result.players.filter((p) => p.role === 'dps').every((p) => p.score === 100));
  assert.ok(result.players.filter((p) => p.role !== 'dps').every((p) => p.score === null));
  assert.equal(scoreBand(100, false), 'perfect');
  assert.equal(scoreBand(100, true), 'provisional');
  assert.equal(scoreBand(99.999), 'pink');
  assert.equal(scoreLabel(99.999), '99.9');
  assert.equal(scoreBand(98), 'purple');
  assert.equal(scoreBand(89), 'blue');
  assert.equal(scoreBand(69), 'green');
});

test('150-pull / 20-player synthetic benchmark measures the composite pipeline', () => {
  const demo = demoData();
  const pulls = Array.from({ length: 150 }, (_, i) => {
    const p = structuredClone(demo.pulls[i % demo.pulls.length]);
    p.fight.id = i + 1;
    for (const m of p.metrics)
      m.evidence = Array.from({ length: 30 }, (_, n) => ({
        fightId: i + 1,
        timestamp: p.fight.startTime + n * 1000,
        ability: 'Synthetic stress event',
        kind: 'mechanic-observed',
        description: 'Synthetic benchmark, not live data.',
        confidence: 'observed',
        url: null,
      }));
    return p;
  });
  const report = {
      ...demo.report,
      fights: pulls.map((p) => p.fight),
      wipeCalls: Object.fromEntries(
        pulls.filter((p) => !p.fight.kill).map((p) => [p.fight.id, p.window!.endTime]),
      ),
    },
    timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now(),
      result = analyze(report, pulls, selection);
    timings.push(performance.now() - started);
    assert.equal(result.summary.pulls, 150);
    assert.equal(result.players.length, 20);
    assert.equal(
      result.players.reduce((n, p) => n + p.pullReviews.length, 0),
      3000,
    );
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      benchmark: 'synthetic-composite-engine',
      pulls: 150,
      players: 20,
      evidence: 90000,
      runs: 5,
      medianMs: +timings[2].toFixed(2),
      maxMs: +timings[4].toFixed(2),
      networkExcluded: true,
    }),
  );
  assert.ok(timings[4] < 5000, 'Detect accidental multi-second score regressions');
});
