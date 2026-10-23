import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { analyze } from '../shared/analysis.js';
import { demoData } from '../shared/demo.js';
import { parseReportCode, selectFights } from '../shared/report-url.js';
import { scoreBand, scoreLabel } from '../shared/score.js';
import { aliveTime } from '../server/ingest.js';
import type { Selection } from '../shared/types.js';
const all: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};
test('selection covers entire report, a boss, wipes, kills and individual pulls', () => {
  const { report } = demoData();
  assert.equal(selectFights(report, all).length, 12);
  assert.equal(selectFights(report, { ...all, encounterId: 3420 }).length, 4);
  assert.equal(selectFights(report, { ...all, mode: 'wipes' }).length, 9);
  assert.equal(selectFights(report, { ...all, mode: 'kills' }).length, 3);
  assert.deepEqual(
    selectFights(report, { ...all, fightIds: [2, 5] }).map((f) => f.id),
    [2, 5],
  );
  report.fights[0].inProgress = true;
  assert.equal(selectFights(report, all).length, 11);
});
test('selected player roles use each pull spec rather than a mixed whole-report label', () => {
  const { report, pulls } = demoData();
  report.players[6].spec = 'Mixed';
  report.players[6].role = 'unknown';
  for (const f of report.fights)
    f.playerSpecs = { 7: f.encounterId === 3420 ? 'Balance' : 'Restoration' };
  const player = analyze(report, pulls, { ...all, encounterId: 3420 }).players.find(
    (p) => p.id === 7,
  )!;
  assert.equal(player.spec, 'Balance');
  assert.equal(player.role, 'dps');
});
test('scoring is deterministic, bounded and not decided by raw DPS', () => {
  const { report, pulls } = demoData();
  const a = analyze(report, pulls, all),
    b = analyze(report, pulls, all);
  assert.deepEqual(a.players, b.players);
  assert.equal(a.players.length, 20);
  assert.equal(a.summary.pulls, 12);
  assert.ok(a.players.every((p) => p.score !== null && p.score >= 0 && p.score <= 100));
  const outputLeader = [...a.players].sort(
    (x, y) => y.damage / y.durationMs - x.damage / x.durationMs,
  )[0];
  assert.notEqual(a.players[0].id, outputLeader.id);
  assert.ok(a.warnings.some((w) => w.includes('synthetic')));
  assert.ok(a.players.every((p) => p.evidence.every((e) => !e.url)));
  assert.ok(
    a.pulls.every((p) => !('metrics' in p)),
    'API result must not duplicate the full evidence payload',
  );
});
test('missing or duplicate pulls and incomplete imports never create a ranking', () => {
  const { report, pulls } = demoData();
  assert.throws(() => analyze(report, pulls.slice(1), all));
  assert.throws(() => analyze(report, [pulls[0], pulls[0], ...pulls.slice(2)], all));
  pulls[0].complete = false;
  assert.throws(() => analyze(report, pulls, all));
});
test('missing output excludes that category for the whole boss cohort', () => {
  const { report, pulls } = demoData();
  const kills = { ...all, encounterId: 3420, mode: 'kills' as const };
  pulls.find((p) => p.fight.id === 8)!.metrics[0].outputPercentile = null;
  const a = analyze(report, pulls, kills);
  assert.ok(a.players.every((p) => !p.categories.output.applied && p.provisional));
});
test('bosses have equal weight regardless of pull count', () => {
  const { report, pulls } = demoData();
  const a = analyze(report, pulls, all);
  for (const p of a.players) {
    const expected = p.perBoss.reduce((n, b) => n + b.score!, 0) / p.perBoss.length;
    assert.ok(Math.abs(p.score! - expected) < 0.00001);
  }
});
test('missing attendance is not a zero; insufficient boss coverage is unranked', () => {
  const { report, pulls } = demoData();
  for (const f of report.fights.filter((f) => f.encounterId !== 3420))
    f.friendlyPlayers = f.friendlyPlayers.filter((id) => id !== 1);
  const player = analyze(report, pulls, all).players.find((p) => p.id === 1)!;
  assert.equal(player.score, null);
  assert.equal(player.rank, null);
  assert.equal(player.bosses, 1);
  assert.ok(player.perBoss[0].score! > 0);
});
test('only complete multi-factor perfection earns gold; ties share rank', () => {
  const { report, pulls } = demoData();
  for (const p of pulls)
    for (const m of p.metrics) {
      m.mechanicFailures = 0;
      m.aliveMs = p.fight.endTime - p.fight.startTime;
      m.outputPercentile = 100;
      m.utilitySuccesses = m.utilityOpportunities;
    }
  const a = analyze(report, pulls, { ...all, mode: 'kills' });
  assert.ok(a.players.every((p) => p.score === 100 && !p.provisional && p.rank === 1));
  assert.equal(scoreBand(100, false), 'perfect');
  assert.equal(scoreBand(100, true), 'provisional');
  assert.equal(scoreBand(99.999), 'pink');
  assert.equal(scoreLabel(99.999), '99.9');
  assert.equal(scoreBand(98), 'purple');
  assert.equal(scoreBand(89), 'blue');
  assert.equal(scoreBand(69), 'green');
});
test('partial live boss rules remain provisional even with all category inputs present', () => {
  const { report, pulls } = demoData();
  report.source = 'warcraftlogs';
  for (const p of pulls) p.mechanicScope = 'partial';
  const result = analyze(report, pulls, { ...all, mode: 'kills' });
  assert.ok(result.players.every((p) => p.coverage === 100 && p.provisional));
});
test('review priorities start with the most frequent mechanic failures, not the highest ranked player', () => {
  const { report, pulls } = demoData();
  for (const p of pulls) {
    const metric = p.metrics.find((m) => m.actorId === 20)!;
    metric.mechanicFailures = metric.mechanicOpportunities;
    metric.evidence.push({
      fightId: p.fight.id,
      timestamp: p.fight.startTime + 1000,
      ability: 'Fixture hazard',
      kind: 'mechanic',
      description: 'Synthetic priority fixture',
      confidence: 'observed',
      ruleId: 'fixture-priority',
      url: null,
    });
  }
  const result = analyze(report, pulls, all);
  assert.equal(result.findings[0].actorId, 20);
  assert.ok(result.findings.some((f) => f.confidence === 'inferred'));
});
test('unvalidated mechanics and raw damage taken do not create penalties', () => {
  const { report, pulls } = demoData();
  for (const p of pulls) {
    p.mechanicRule = null;
    for (const m of p.metrics) {
      m.mechanicFailures = null;
      m.mechanicOpportunities = null;
      m.evidence = m.evidence.map((e) =>
        e.kind === 'mechanic' ? { ...e, kind: 'mechanic-observed' } : e,
      );
    }
  }
  const before = analyze(report, pulls, all);
  pulls[0].metrics[0].damageTaken *= 1000;
  const after = analyze(report, pulls, all);
  assert.equal(
    before.players.find((p) => p.id === 1)!.score,
    after.players.find((p) => p.id === 1)!.score,
  );
  assert.ok(after.players.every((p) => !p.categories.mechanics.applied));
  assert.ok(!after.findings.some((f) => f.title.startsWith('Recurring')));
});
test('battle resurrections contribute only time actually alive', () => {
  const f = demoData().report.fights[0];
  assert.equal(
    aliveTime(f, [
      { type: 'death', timestamp: 20000 },
      { type: 'death', timestamp: 21000 },
      { type: 'resurrect', timestamp: 40000 },
    ]),
    75000,
  );
});
test('report parser prevents user-supplied upstream fetches', () => {
  const code = '6fjJxRFC21YHdTXB';
  assert.equal(parseReportCode(`https://www.warcraftlogs.com/reports/${code}?fight=last`), code);
  for (const url of [
    `http://warcraftlogs.com/reports/${code}`,
    `https://warcraftlogs.com.evil.test/reports/${code}`,
    `https://127.0.0.1/reports/${code}`,
    `https://user:pass@warcraftlogs.com/reports/${code}`,
    'not-a-report',
  ])
    assert.throws(() => parseReportCode(url));
});
test('150-pull ranking benchmark (synthetic, engine only)', () => {
  const demo = demoData();
  const pulls = Array.from({ length: 150 }, (_, i) => {
    const p = structuredClone(demo.pulls[i % 12]);
    p.fight = { ...p.fight, id: i + 1 };
    for (const m of p.metrics) {
      m.evidence = Array.from({ length: 30 }, (_, n) => ({
        ...(m.evidence[0] ?? {
          timestamp: p.fight.startTime,
          ability: 'Training',
          kind: 'mechanic-observed' as const,
          confidence: 'observed' as const,
          url: null,
        }),
        fightId: i + 1,
        timestamp: p.fight.startTime + n * 1000,
      }));
    }
    return p;
  });
  const report = { ...demo.report, fights: pulls.map((p) => p.fight) };
  const times: number[] = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    const a = analyze(report, pulls, all);
    times.push(performance.now() - start);
    assert.equal(a.summary.pulls, 150);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      benchmark: 'synthetic-engine-only',
      pulls: 150,
      players: 20,
      evidence: 90000,
      runs: 8,
      medianMs: +times[4].toFixed(2),
      maxMs: +times[7].toFixed(2),
      networkExcluded: true,
    }),
  );
  assert.ok(times[7] < 5000, 'Detect accidental multi-second ranking regressions');
});
