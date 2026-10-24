import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../shared/analysis.js';
import { scoreExecution, EXECUTION_MODEL_VERSION } from '../shared/execution.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { fixture, selection, check } from './execution-fixtures.js';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('the declared 70/30 base and alive-time cap reproduce the published examples exactly', () => {
  for (const [mechanics, alive, expected, capped] of [
    [100, 100, 100, false],
    [100, 20, 20, true],
    [100, (100 * 290) / 300, (100 * 290) / 300, true],
    [100, 90, 90, true],
    [60, 80, 66, false],
  ] as const) {
    const result = scoreExecution(mechanics, alive);
    close(result.baseScore, 0.7 * mechanics + 0.3 * alive);
    close(result.score, expected);
    assert.equal(result.capped, capped);
  }
});

test('the simple formula is bounded, monotone and never exceeds recorded time alive', () => {
  for (let alive = 0; alive <= 100; alive++) {
    let previous = -1;
    for (let mechanics = 0; mechanics <= 100; mechanics++) {
      const value = scoreExecution(mechanics, alive).score;
      assert.ok(value >= 0 && value <= 100 && value <= alive + 1e-8);
      assert.ok(value + 1e-8 >= previous);
      previous = value;
    }
  }
  for (let mechanics = 0; mechanics <= 100; mechanics++) {
    let previous = -1;
    for (let alive = 0; alive <= 100; alive++) {
      const value = scoreExecution(mechanics, alive).score;
      assert.ok(value + 1e-8 >= previous);
      previous = value;
    }
  }
  close(scoreExecution(80, 80).score, 80);
  close(scoreExecution(100, 50).score, scoreExecution(60, 50).score);
});

test('invalid numeric inputs cannot become a displayed score or replacement points', () => {
  for (const value of [NaN, Infinity, -Infinity, -0.1, 100.1]) {
    assert.throws(() => scoreExecution(value, 100));
    assert.throws(() => scoreExecution(100, value));
  }
});

test('ties share a within-role position without creating a global ranking', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps', 'dps', 'tank'] });
  pull.metrics[2].mechanics = [check(10, 1)];
  const rows = analyze(report, [pull], selection).players;
  assert.deepEqual(
    rows.filter((p) => p.role === 'dps').map((p) => p.roleRank),
    [1, 1, 3],
  );
  assert.equal(rows.find((p) => p.role === 'tank')!.roleRank, 1);
});

test('mechanic success is counted from checked opportunities, not the retired sample/severity weighting', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics) {
    m.mechanics = [
      check(10, 0, { ruleId: 'hazard-A', weight: 1 }),
      check(1, 1, { ruleId: 'hazard-B', weight: 100 }),
    ];
    m.mechanicOpportunities = 11;
    m.mechanicFailures = 1;
  }
  const result = analyze(report, [pull], selection);
  assert.equal(result.model.mechanicsWeight, 70);
  assert.equal(result.model.survivalWeight, 30);
  assert.equal(result.model.cappedByAlive, true);
  for (const p of result.players) {
    close(p.execution.mechanicsScore!, (100 * 10) / 11);
    close(p.score!, 0.7 * ((100 * 10) / 11) + 30);
    assert.equal(p.execution.checkedMechanics, 11);
    assert.equal(p.execution.passedChecks, 10);
    assert.equal(p.execution.failedChecks, 1);
    assert.equal(p.execution.version, EXECUTION_MODEL_VERSION);
    assert.ok(!('factors' in p.execution));
    assert.ok(!('neutralPoints' in p.execution));
  }
});

test('an incomplete rule is omitted for the whole comparable role cohort, not selectively replaced for one person', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps', 'tank'] });
  for (const m of pull.metrics)
    m.mechanics = [check(10, 0, { ruleId: 'common' }), check(4, 4, { ruleId: 'uncertain' })];
  pull.metrics[0].mechanics![1].unknown = 1;
  const result = analyze(report, [pull], selection);
  for (const p of result.players.filter((p) => p.role === 'dps')) {
    assert.equal(p.score, 100);
    assert.equal(p.execution.checkedMechanics, 10);
    const excluded = p.pullReviews[0].mechanics.find((m) => m.ruleId === 'uncertain')!;
    assert.equal(excluded.scored, false);
    assert.ok(excluded.exclusion);
  }
  const tank = result.players.find((p) => p.role === 'tank')!;
  assert.equal(tank.execution.checkedMechanics, 14);
  close(tank.score!, 80);
});

test('context, required contacts and failure-only exposure cannot become personal scoring errors', () => {
  const { report, pull } = fixture({ roles: ['tank', 'dps'] });
  for (const m of pull.metrics)
    m.mechanics = [
      check(10, 0),
      check(50, 50, { ruleId: 'required-soak', kind: 'soak', weight: 0, scoreEligible: false }),
      check(50, 50, {
        ruleId: 'unmeasured-floor',
        kind: 'ground',
        scoreEligible: false,
        unknown: 1,
      }),
    ];
  const result = analyze(report, [pull], selection);
  assert.ok(result.players.every((p) => p.score === 100 && p.execution.checkedMechanics === 10));
  assert.ok(
    result.players.every((p) =>
      p.pullReviews[0].mechanics
        .filter((m) => m.ruleId !== 'synthetic-common-check/v1')
        .every((m) => !m.scored),
    ),
  );
});

test('no observed mechanic opportunities is not a fabricated perfect score or midpoint', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics) {
    m.mechanics = [check(0, 0)];
    m.mechanicFailures = 0;
    m.mechanicOpportunities = 0;
  }
  const result = analyze(report, [pull], selection);
  for (const p of result.players) {
    assert.equal(p.score, null);
    assert.equal(p.execution.mechanicsScore, null);
    assert.equal(p.scoredPulls, 0);
    assert.equal(p.rank, null);
    assert.ok(p.execution.reasons.length);
  }
  assert.equal(
    result.players.length,
    report.players.length,
    'Unscored participants remain visible',
  );
});

test('an early death cannot turn a single clean early check into a high final score', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  pull.metrics[0].aliveMs = 15000;
  pull.metrics[0].deaths = 1;
  pull.metrics[0].mechanics = [check(1, 0)];
  pull.metrics[1].mechanics = [check(10, 1)];
  const result = analyze(report, [pull], selection),
    early = result.players.find((p) => p.id === 1)!,
    active = result.players.find((p) => p.id === 2)!;
  assert.equal(early.score, 5);
  assert.equal(early.execution.capped, true);
  assert.ok(active.score! > early.score!);
});

test('recorded time lost, not an arbitrary count of deaths, determines the availability deduction', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  pull.metrics[0].aliveMs = pull.metrics[1].aliveMs = 270000;
  pull.metrics[0].deaths = 1;
  pull.metrics[1].deaths = 3;
  const rows = analyze(report, [pull], selection).players;
  assert.ok(rows.every((p) => p.score === 90));
  assert.deepEqual(rows.map((p) => p.deaths).sort(), [1, 3]);
});

test('dying before every mechanic on another pull cannot disappear from the aggregate availability cap', () => {
  const { report, pull } = fixture({ roles: ['dps'] });
  const deadBeforeCheck = structuredClone(pull);
  deadBeforeCheck.fight.id = 2;
  deadBeforeCheck.metrics[0].aliveMs = 30000;
  deadBeforeCheck.metrics[0].deaths = 1;
  deadBeforeCheck.metrics[0].mechanics = [check(0, 0)];
  report.fights = [pull.fight, deadBeforeCheck.fight];
  const player = analyze(report, [pull, deadBeforeCheck], selection).players[0];
  assert.equal(player.pullReviews[1].execution.score, null);
  assert.equal(player.scoredPulls, 1);
  assert.equal(player.pulls, 2);
  close(player.execution.alivePercent, 55);
  close(player.score!, 55);
});

test('an attended no-check boss still contributes observed availability to the whole-report cap', () => {
  const { report, pull } = fixture({ roles: ['dps'] });
  const ungradedBoss = structuredClone(pull);
  ungradedBoss.fight = {
    ...ungradedBoss.fight,
    id: 2,
    encounterId: 3513,
    name: 'Ungraded synthetic boss',
  };
  ungradedBoss.metrics[0].aliveMs = 30000;
  ungradedBoss.metrics[0].deaths = 1;
  ungradedBoss.metrics[0].mechanics = [check(0, 0)];
  report.fights = [pull.fight, ungradedBoss.fight];
  const player = analyze(report, [pull, ungradedBoss], selection).players[0];
  assert.equal(player.perBoss.find((b) => b.encounterId === 3513)!.score, null);
  assert.equal(player.bosses, 2);
  close(player.execution.alivePercent, 55);
  close(player.score!, 55);
});

test('full duration is used on every boss/difficulty and every tank class, without historical-percentile or class-defensive requirements', () => {
  const bosses = [3513, 3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379];
  for (const boss of bosses)
    for (const difficulty of [1, 3, 4, 5])
      for (const profile of TANK_PROFILES) {
        const { report, pull } = fixture({ boss, difficulty, roles: ['tank', 'dps'] });
        report.players[0] = { ...report.players[0], class: profile.class, spec: profile.spec };
        pull.fight.playerSpecs![1] = profile.spec;
        pull.metrics[0].aliveMs = 270000;
        pull.metrics[0].damageTaken = 1e15;
        pull.metrics[0].outputPercentile = null;
        const player = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
        assert.equal(player.role, 'tank');
        assert.equal(player.score, 90);
        assert.equal(player.execution.alivePercent, 90);
        assert.equal(player.perBoss[0].difficulty, difficulty);
      }
});

test('each attended boss has equal weight regardless of its pull count', () => {
  const { report, pull } = fixture();
  const repeat = structuredClone(pull),
    other = structuredClone(pull);
  repeat.fight.id = 2;
  for (const m of repeat.metrics) m.mechanics = [check(10, 10)];
  other.fight = { ...other.fight, id: 3, encounterId: 3513, name: 'Other synthetic boss' };
  for (const m of other.metrics) m.mechanics = [check(10, 10)];
  report.fights = [pull.fight, repeat.fight, other.fight];
  const result = analyze(report, [pull, repeat, other], selection);
  for (const p of result.players) {
    close(p.score!, 47.5);
    assert.equal(p.perBoss.length, 2);
  }
});

test('difficulty contexts are calculated separately and receive equal weight inside an attended boss', () => {
  const { report, pull } = fixture();
  const repeat = structuredClone(pull),
    normal = structuredClone(pull);
  repeat.fight.id = 2;
  normal.fight = { ...normal.fight, id: 3, difficulty: 3 };
  for (const m of normal.metrics) m.mechanics = [check(10, 10)];
  report.fights = [pull.fight, repeat.fight, normal.fight];
  const result = analyze(report, [pull, repeat, normal], selection);
  for (const p of result.players) {
    close(p.score!, 65);
    assert.equal(p.perBoss.length, 2);
  }
});

test('zero recorded contribution is unranked rather than promoted by passive survival', () => {
  const { report, pull } = fixture();
  const inactive = pull.metrics[3];
  inactive.damage = 0;
  inactive.healing = 0;
  inactive.interrupts = 0;
  inactive.dispels = 0;
  inactive.facts!.casts = 0;
  const player = analyze(report, [pull], selection).players.find((p) => p.id === 4)!;
  assert.equal(player.score, null);
  assert.equal(player.rank, null);
  assert.ok(player.execution.reasons.length);
  assert.equal(player.aliveMs, 300000, 'Still preserve the observed full survival fact');
});

test('one active clean pull cannot hide a fully alive zero-contribution pull inside the aggregate', () => {
  const { report, pull } = fixture({ roles: ['dps'] });
  const inactivePull = structuredClone(pull);
  inactivePull.fight.id = 2;
  const inactive = inactivePull.metrics[0];
  inactive.damage = 0;
  inactive.healing = 0;
  inactive.interrupts = 0;
  inactive.dispels = 0;
  inactive.facts!.casts = 0;
  report.fights = [pull.fight, inactivePull.fight];

  const player = analyze(report, [pull, inactivePull], selection).players[0];
  assert.equal(player.pullReviews[0].execution.score, 100);
  assert.equal(player.pullReviews[1].execution.score, null);
  assert.equal(
    player.pullReviews[1].execution.checkedMechanics,
    10,
    'The exclusion is absent contribution, not missing mechanic evidence',
  );
  assert.equal(player.execution.alivePercent, 100);
  assert.equal(player.scoredPulls, 1);
  assert.equal(player.pulls, 2);
  assert.equal(player.execution.score, null);
  assert.equal(player.score, null);
  assert.equal(player.roleRank, null);
  assert.ok(
    player.execution.reasons.some((reason) =>
      /No recorded combat contribution in 1 attended pull/.test(reason),
    ),
  );
});
