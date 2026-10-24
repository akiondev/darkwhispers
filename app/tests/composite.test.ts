import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineComposites,
  mechanicsComponent,
  measuredComponent,
  outputComponent,
  scoreComposite,
  unknownComponent,
} from '../shared/composite.js';
import { analyzeExecution } from '../shared/execution.js';
import { check, fixture, selection } from './execution-fixtures.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
const measurement = (n: number) => measuredComponent(n, 'Synthetic verified test measurement.');
const components = (mechanics = 80, output = 80, survival = 90) => ({
  mechanics: measurement(mechanics),
  output: measurement(output),
  survival: measurement(survival),
});

test('approved single-score example gives 82 from three observable factors', () => {
  const dps = scoreComposite('dps', components());
  assert.equal(dps.complete, true);
  close(dps.score!, 82);
  close(dps.components.mechanics.points, 40);
  close(dps.components.output.points, 24);
  close(dps.components.survival.points, 18);
  close(scoreComposite('healer', components()).score!, 83);
  close(scoreComposite('tank', components()).score!, 83);
  assert.deepEqual(Object.keys(dps.components).sort(), ['mechanics', 'output', 'survival']);
  assert.ok(
    !('lower' in dps) && !('upper' in dps),
    'Single scores do not retain a hidden interval',
  );
});

test('unavailable mechanics uses the documented output/survival profile, never survival alone', () => {
  for (const [role, outputWeight, survivalWeight, expected] of [
    ['dps', 0.6, 0.4, 84],
    ['healer', 0.4, 0.6, 86],
    ['tank', 0.25, 0.75, 87.5],
  ] as const) {
    const grade = scoreComposite(
      role,
      { ...components(), mechanics: unknownComponent('No reviewed denominator.') },
      false,
    );
    assert.equal(grade.complete, true);
    assert.equal(grade.scope, 'output-survival');
    close(grade.score!, expected);
    close(grade.components.mechanics.weight, 0);
    close(grade.components.output.weight, outputWeight);
    close(grade.components.survival.weight, survivalWeight);
    assert.equal(grade.components.mechanics.score, null);
  }
});

test('unknown required life/output is a data limitation, not an interval or invented replacement score', () => {
  for (const key of ['output', 'survival'] as const) {
    const grade = scoreComposite('dps', {
      ...components(),
      [key]: unknownComponent('Missing essential facts.'),
    });
    assert.equal(grade.score, null);
    assert.equal(grade.complete, false);
    assert.ok(!('lower' in grade) && !('upper' in grade));
  }
});

test('dead opportunities earn no completion credit but never become mechanic failures', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [check(20, 2, { missedWhileDead: 2 })];
  const result = mechanicsComponent(metrics[0]);
  assert.deepEqual(
    [result.passed, result.failed, result.missed, result.opportunities],
    [16, 2, 2, 20],
  );
  close(result.observation.score!, 80);
  assert.equal(result.reviews[0].failed, 2);
  assert.equal(result.reviews[0].missedWhileDead, 2);
  metrics[0].mechanics[0].missedWhileDead = 8;
  const moreDead = mechanicsComponent(metrics[0]);
  close(moreDead.observation.score!, 50);
  assert.equal(moreDead.failed, 2);
  assert.equal(moreDead.missed, 8);
});

test('unreviewed rules and invalid denominators cannot earn measured completion credit', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [check(100, 0, { requiredForScore: false })];
  assert.equal(mechanicsComponent(metrics[0]).observation.score, null);
  metrics[0].mechanics = [check(5, 1, { unknown: 1, scoreEligible: false })];
  const result = mechanicsComponent(metrics[0]);
  assert.equal(result.observation.score, null);
  assert.equal(result.reviews[0].scored, false);
  metrics[0].mechanics = [check(10, 2, { missedWhileDead: 9 })];
  assert.throws(() => mechanicsComponent(metrics[0]), /Invalid/);
});

test('mechanic families keep fixed weights rather than rewarding raw tick volume', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [check(100, 0), check(1, 1, { ruleId: 'second-family' })];
  close(mechanicsComponent(metrics[0]).observation.score!, 50);
  metrics[0].mechanics[0].observed = 1e9;
  close(mechanicsComponent(metrics[0]).observation.score!, 50);
  const restricted = mechanicsComponent(metrics[0], new Set(['second-family']));
  close(restricted.observation.score!, 0);
});

test('output ratios measure positive contribution including solo roles without inventing a peer percentile', () => {
  const { metrics } = fixture({ roles: ['dps', 'dps'] });
  metrics[0].damage = 100;
  metrics[1].damage = 80;
  close(outputComponent(metrics[0], 'dps', metrics).score!, 100);
  close(outputComponent(metrics[1], 'dps', metrics).score!, 80);
  const solo = outputComponent(metrics[0], 'dps', [metrics[0]]);
  close(solo.score!, 100);
  assert.match(solo.reason, /single|only|sole|solo|one participant/i);
  metrics.forEach((m) => (m.damage = 0));
  close(outputComponent(metrics[0], 'dps', metrics).score!, 0);
});

test('aggregation combines full and reduced scopes by duration and preserves component arithmetic', () => {
  const full = scoreComposite('healer', components());
  const reduced = scoreComposite(
    'healer',
    { ...components(), mechanics: unknownComponent('Unsupported boss.') },
    false,
  );
  const result = combineComposites([
    { composite: full, durationMs: 100 },
    { composite: reduced, durationMs: 300 },
  ]);
  close(result.score!, (full.score! + 3 * reduced.score!) / 4);
  close(
    result.score!,
    Object.values(result.components).reduce((n, c) => n + c.points, 0),
  );
  assert.equal(result.complete, true);
  const split = combineComposites([
    { composite: full, durationMs: 50 },
    { composite: full, durationMs: 50 },
    { composite: reduced, durationMs: 300 },
  ]);
  close(split.score!, result.score!);
  const broken = scoreComposite('healer', {
    ...components(),
    survival: unknownComponent('Missing resurrection.'),
  });
  assert.equal(
    combineComposites([
      { composite: full, durationMs: 100 },
      { composite: broken, durationMs: 300 },
    ]).score,
    null,
  );
  assert.throws(() =>
    combineComposites([
      { composite: full, durationMs: 100 },
      { composite: scoreComposite('tank', components()), durationMs: 100 },
    ]),
  );
  const allReduced = combineComposites([
    { composite: reduced, durationMs: 100 },
    { composite: reduced, durationMs: 100 },
  ]);
  assert.equal(allReduced.components.mechanics.weight, 0);
  assert.equal(allReduced.components.mechanics.score, null);
  assert.ok(Number.isFinite(allReduced.score));
});

test('fixed-profile improvements are monotone and single scores stay inside 0–100', () => {
  let state = 42;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32) * 100;
  for (let n = 0; n < 1000; n++) {
    const m = random(),
      o = random(),
      s = random();
    for (const role of ['dps', 'healer', 'tank'] as const) {
      const base = scoreComposite(role, components(m, o, s));
      assert.ok(base.score! >= 0 && base.score! <= 100.00000001);
      assert.ok(scoreComposite(role, components(m, o, Math.min(100, s + 1))).score! >= base.score!);
      assert.ok(scoreComposite(role, components(Math.min(100, m + 1), o, s)).score! >= base.score!);
      assert.ok(scoreComposite(role, components(m, Math.min(100, o + 1), s)).score! >= base.score!);
    }
  }
});

test('missing or changed preparation cannot block or alter an otherwise measured score', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  const before = analyzeExecution(report, [pull], selection);
  pull.metrics[0].facts!.preparation = {
    flask: 'present',
    food: 'present',
    basis: 'Synthetic metadata.',
  };
  pull.metrics[1].facts!.preparation = {
    flask: 'unknown',
    food: 'unknown',
    basis: 'Synthetic unknown metadata.',
  };
  const after = analyzeExecution(report, [pull], selection);
  assert.deepEqual(
    after.players.map((p) => p.score),
    before.players.map((p) => p.score),
  );
  assert.ok(after.players.every((p) => p.score === 100 && !p.provisional));
});

test('zero contribution cannot manufacture a rank through survival or preparation', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  const absent = pull.metrics[1];
  absent.damage = absent.healing = absent.interrupts = absent.dispels = absent.deaths = 0;
  absent.facts!.casts = 0;
  const result = analyzeExecution(report, [pull], selection).players.find(
    (p) => p.id === absent.actorId,
  )!;
  assert.equal(result.score, null);
  assert.equal(result.roleRank, null);
  assert.match(result.execution.reasons.join(' '), /No recorded combat contribution/);
});

test('same-role rows sort by their single scores and identical displayed scores share rank', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps', 'dps'] });
  pull.metrics[0].mechanics = [check(10, 0)];
  pull.metrics[1].mechanics = [check(10, 5)];
  pull.metrics[2].mechanics = [check(10, 0)];
  const result = analyzeExecution(report, [pull], selection);
  assert.deepEqual(
    result.players.map((p) => p.score),
    [100, 100, 75],
  );
  assert.deepEqual(
    result.players.map((p) => p.roleRank),
    [1, 1, 3],
  );
  assert.ok(result.players.every((p) => !p.provisional));
});

test('unreliable mechanic rules are excluded for the full same-role pull cohort', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps', 'tank', 'tank'] });
  for (const m of pull.metrics)
    m.mechanics = [check(10, 2, { ruleId: 'reliable' }), check(5, 0, { ruleId: 'uncertain' })];
  pull.metrics[0].mechanics![1].unknown = 1;
  pull.metrics[0].mechanics![1].scoreEligible = false;
  const result = analyzeExecution(report, [pull], selection);
  const dps = result.players.filter((p) => p.role === 'dps');
  for (const p of dps) {
    close(p.execution.composite!.components.mechanics.score!, 80);
    assert.deepEqual(
      p.pullReviews[0].mechanics.filter((m) => m.scored).map((m) => m.ruleId),
      ['reliable'],
    );
  }
  const tanks = result.players.filter((p) => p.role === 'tank');
  for (const p of tanks) close(p.execution.composite!.components.mechanics.score!, 90);
});

test('an uncertain rule affects all peers in that pull without poisoning other pulls', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  const next = structuredClone(pull);
  next.fight.id = 2;
  next.metrics[0].mechanics![0].unknown = 1;
  next.metrics[0].mechanics![0].scoreEligible = false;
  report.fights = [pull.fight, next.fight];
  const result = analyzeExecution(report, [pull, next], selection);
  assert.ok(result.players.every((p) => p.score === 100));
  for (const p of result.players) {
    const first = p.pullReviews.find((r) => r.fightId === 1)!;
    const second = p.pullReviews.find((r) => r.fightId === 2)!;
    assert.equal(first.execution.composite!.components.mechanics.weight, 0.5);
    assert.equal(second.execution.composite!.components.mechanics.weight, 0);
    assert.equal(second.execution.composite!.components.output.weight, 0.6);
    assert.equal(p.execution.composite!.scope, 'mixed');
  }
});
