import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineComposites,
  mechanicsComponent,
  measuredComponent,
  outputComponent,
  preparationComponent,
  scoreComposite,
  unknownComponent,
} from '../shared/composite.js';
import { analyzeExecution } from '../shared/execution.js';
import { check, fixture, selection } from './execution-fixtures.js';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
const measurement = (n: number) => measuredComponent(n, 'Synthetic verified test measurement.');
const components = (mechanics = 90, output = 80, survival = 95, preparation = 100) => ({
  mechanics: measurement(mechanics),
  output: measurement(output),
  survival: measurement(survival),
  preparation: measurement(preparation),
});

test('approved example gives 88.5 with fixed role weights, not survival 95', () => {
  const dps = scoreComposite('dps', components());
  assert.equal(dps.complete, true);
  close(dps.lower, 88.5);
  close(dps.upper, 88.5);
  close(dps.components.mechanics.points, 40.5);
  close(scoreComposite('healer', components()).lower, 90);
  close(scoreComposite('tank', components()).lower, 91);
});

test('an absent category stays a bounded share; survival never expands to the whole score', () => {
  const grade = scoreComposite('dps', {
    ...components(100, 100, 100, 100),
    mechanics: unknownComponent('No reviewed denominator.'),
  });
  assert.equal(grade.complete, false);
  close(grade.lower, 55);
  close(grade.upper, 100);
  close(grade.coverage, 0.55);
  close(grade.components.survival.points, 20);
  assert.equal(grade.components.mechanics.score, null);
});

test('missing preparation never masquerades as absent or perfect; verified positives bound the result', () => {
  const facts = {
    snapshot: true,
    activeAtPull: [{ id: 1, name: 'Synthetic flask', category: 'flask' as const }],
    consumables: [],
    lifeEvents: [],
    casts: 1,
  };
  assert.deepEqual(
    [preparationComponent(facts).lower, preparationComponent(facts).upper],
    [50, 100],
  );
  assert.deepEqual(
    [
      preparationComponent({ ...facts, snapshot: false }).lower,
      preparationComponent({ ...facts, snapshot: false }).upper,
    ],
    [0, 100],
  );
  const absent = preparationComponent({
    ...facts,
    preparation: { flask: 'present', food: 'absent', basis: 'Synthetic complete catalog.' },
  });
  close(absent.lower, 50);
  close(absent.upper, 50);
});

test('mechanic missing while dead is neither a passed nor failed check and carries an explicit range', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [check(10, 2, { requiredForScore: true, missedWhileDead: 3 })];
  const result = mechanicsComponent(metrics[0]);
  assert.deepEqual(
    [result.passed, result.failed, result.missed, result.opportunities],
    [5, 2, 3, 10],
  );
  close(result.observation.lower, 50);
  close(result.observation.upper, 80);
  close(result.observation.coverage, 0.7);
  assert.equal(result.reviews[0].failed, 2);
});

test('unreviewed mechanics and unknown denominators cannot earn clean-check points', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [check(100, 0, { requiredForScore: false })];
  assert.equal(mechanicsComponent(metrics[0]).observation.lower, 0);
  metrics[0].mechanics = [
    check(5, 1, { requiredForScore: true, unknown: 1, scoreEligible: false }),
  ];
  const result = mechanicsComponent(metrics[0]);
  assert.equal(result.observation.lower, 0);
  assert.equal(result.observation.upper, 100);
  assert.equal(result.reviews[0].scored, false);
});

test('mechanic family rates use fixed family weight rather than raw ticks or event volume', () => {
  const { metrics } = fixture();
  metrics[0].mechanics = [
    check(100, 0, { requiredForScore: true }),
    check(1, 1, { requiredForScore: true, ruleId: 'second-family' }),
  ];
  close(mechanicsComponent(metrics[0]).observation.lower, 50);
  metrics[0].mechanics[0].observed = 1e9;
  close(mechanicsComponent(metrics[0]).observation.lower, 50);
});

test('report-relative output requires peers and measures ratios equally on kills and wipes', () => {
  const { metrics } = fixture({ roles: ['dps', 'dps'] });
  metrics[0].damage = 100;
  metrics[1].damage = 80;
  close(outputComponent(metrics[0], 'dps', metrics).lower, 100);
  close(outputComponent(metrics[1], 'dps', metrics).lower, 80);
  assert.equal(outputComponent(metrics[0], 'dps', [metrics[0]]).upper, 100);
  assert.equal(outputComponent(metrics[0], 'dps', [metrics[0]]).lower, 0);
  metrics.forEach((m) => (m.damage = 0));
  assert.equal(outputComponent(metrics[0], 'dps', metrics).coverage, 0);
});

test('duration aggregation preserves missing mass and is invariant to splitting the same measurement', () => {
  const full = scoreComposite('healer', components());
  const partial = scoreComposite('healer', {
    ...components(),
    output: unknownComponent('No peers.'),
  });
  const result = combineComposites([
    { composite: full, durationMs: 100 },
    { composite: partial, durationMs: 300 },
  ]);
  close(result.lower, (full.lower + partial.lower * 3) / 4);
  close(result.upper, (full.upper + partial.upper * 3) / 4);
  assert.equal(result.complete, false);
  assert.ok(result.lower < full.lower);
  const split = combineComposites([
    { composite: full, durationMs: 50 },
    { composite: full, durationMs: 50 },
    { composite: partial, durationMs: 300 },
  ]);
  close(split.lower, result.lower);
  close(split.upper, result.upper);
  assert.throws(() =>
    combineComposites([
      { composite: full, durationMs: 100 },
      { composite: scoreComposite('tank', components()), durationMs: 300 },
    ]),
  );
});

test('fixed-input factor improvements are monotone and all bounds stay inside 0–100', () => {
  let state = 42;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32) * 100;
  for (let n = 0; n < 1000; n++) {
    const m = random(),
      o = random(),
      s = random(),
      p = random();
    for (const role of ['dps', 'healer', 'tank'] as const) {
      const base = scoreComposite(role, components(m, o, s, p));
      assert.ok(base.lower >= 0 && base.upper <= 100.00000001);
      assert.ok(
        scoreComposite(role, components(m, o, Math.min(100, s + 1), p)).lower >= base.lower,
      );
      assert.ok(
        scoreComposite(role, components(Math.min(100, m + 1), o, s, p)).lower >= base.lower,
      );
    }
  }
});

test('zero observed contribution cannot manufacture a perfect rank through survival or preparation', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  for (const metric of pull.metrics) {
    metric.mechanics = [check(10, 0, { requiredForScore: true })];
    metric.facts!.preparation = { flask: 'present', food: 'present', basis: 'Synthetic fixture.' };
  }
  const absent = pull.metrics[1];
  absent.damage = absent.healing = absent.interrupts = absent.dispels = absent.deaths = 0;
  absent.facts!.casts = 0;
  const result = analyzeExecution(report, [pull], selection).players.find(
    (p) => p.id === absent.actorId,
  )!;
  assert.equal(result.score, null);
  assert.equal(result.roleRank, null);
  close(result.execution.composite!.components.survival.lower, 0);
});

test('a narrow high preliminary range is not sorted below a lower complete score', () => {
  const { report, pull } = fixture({ roles: ['dps', 'dps'] });
  pull.metrics[0].mechanics = [check(10, 0, { requiredForScore: true })];
  pull.metrics[0].facts!.preparation = {
    flask: 'present',
    food: 'unknown',
    basis: 'Synthetic partial snapshot.',
  };
  pull.metrics[1].mechanics = [check(10, 10, { requiredForScore: true })];
  pull.metrics[1].facts!.preparation = {
    flask: 'present',
    food: 'present',
    basis: 'Synthetic verified snapshot.',
  };
  const result = analyzeExecution(report, [pull], selection);
  assert.equal(result.players[0].id, 1);
  assert.equal(result.players[0].score, null);
  assert.equal(result.players[0].roleRank, null);
  assert.ok(result.players[0].execution.composite!.lower > result.players[1].score!);
});
