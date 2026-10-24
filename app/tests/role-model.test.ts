import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../shared/analysis.js';
import { scoreSurvival } from '../shared/execution.js';
import { summarizeLife } from '../shared/life.js';
import { assessmentWindow } from '../shared/windows.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { fixture, selection, check } from './execution-fixtures.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('survival formula reproduces full-time examples without a flat death charge', () => {
  for (const [alive, total, expected] of [
    [300000, 300000, 100],
    [294000, 300000, 98],
    [240000, 300000, 80],
    [0, 300000, 0],
    [10000, 300000, 100 / 30],
    [1, 1, 100],
  ])
    close(scoreSurvival(alive, total), expected);
  for (const [alive, total] of [
    [NaN, 1],
    [Infinity, 1],
    [-1, 1],
    [2, 1],
    [0, 0],
    [1, -1],
    [1, NaN],
    [1, Infinity],
  ])
    assert.throws(() => scoreSurvival(alive, total));
});

test('2,000 seeded scenarios enforce monotonicity, bounds and duration-unit invariance', () => {
  let state = 0x71ab9e;
  const random = () => (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const duration = 1 + Math.floor(random() * 3600000);
    const alive = Math.floor(random() * (duration + 1));
    const extraDead = Math.floor(random() * (alive + 1));
    const score = scoreSurvival(alive, duration);
    assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
    assert.ok(scoreSurvival(alive - extraDead, duration) <= score);
    close(scoreSurvival(alive * 1000, duration * 1000), score);
    close(score, 100 * (1 - (duration - alive) / duration));
  }
});

test('mechanic counts and arbitrary weights are observations, never survival score inputs', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics) {
    m.aliveMs = 240000;
    m.deaths = 1;
    m.mechanics = [
      check(100, 0, { ruleId: 'easy' }),
      check(1, 1, { ruleId: 'other', weight: 999 }),
    ];
  }
  pull.metrics[2].mechanics![1].unknown = 1;
  const a = analyze(report, [pull], selection);
  assert.equal(a.model.id, 'survival/v1');
  assert.equal(a.model.deathPenalty, 0);
  assert.ok(a.players.every((p) => p.score === 80 && p.execution.mechanicsScore === null));
  assert.ok(
    a.players.every((p) => p.pullReviews.every((r) => r.mechanics.every((m) => !m.scored))),
  );
});

test('resurrection stops the dead interval and keeps both its duration and death count', () => {
  const { report, pull, fight } = fixture();
  const m = pull.metrics[0];
  m.facts!.lifeEvents = [
    { type: 'death', timestamp: 11000 },
    { type: 'resurrect', timestamp: 17000, combatRes: true, abilityId: 20484 },
  ];
  m.life = summarizeLife(fight, m.facts!.lifeEvents);
  m.deaths = m.life.deaths;
  m.aliveMs = m.life.aliveMs;
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
  assert.equal(p.score, 98);
  assert.equal(p.deaths, 1);
  assert.equal(p.durationMs - p.aliveMs, 6000);
  assert.equal(p.execution.deathPenalty, 0);
  assert.equal(p.pullReviews[0].facts.lifeEvents[1].combatRes, true);
});

test('deaths remain factual counts without arbitrary score deductions when dead time is identical', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics) m.aliveMs = 240000;
  pull.metrics[0].deaths = 1;
  pull.metrics[1].deaths = 6;
  const a = analyze(report, [pull], selection);
  assert.equal(a.players.find((p) => p.id === 1)!.score, 80);
  assert.equal(a.players.find((p) => p.id === 2)!.score, 80);
  assert.equal(a.players.find((p) => p.id === 1)!.deaths, 1);
  assert.equal(a.players.find((p) => p.id === 2)!.deaths, 6);
});

test('simultaneous first deaths stay tied factual observations across role lists', () => {
  const { report, pull, fight } = fixture();
  const times = [20000, 20000, 40000];
  for (let i = 0; i < times.length; i++) {
    const m = pull.metrics[i];
    m.facts!.lifeEvents = [{ type: 'death', timestamp: times[i] }];
    m.life = summarizeLife(fight, m.facts!.lifeEvents);
    m.aliveMs = m.life.aliveMs;
    m.deaths = m.life.deaths;
  }
  const a = analyze(report, [pull], selection);
  assert.equal(a.players.find((p) => p.id === 1)!.firstDeaths, 1);
  assert.equal(a.players.find((p) => p.id === 2)!.firstDeaths, 1);
  assert.equal(a.players.find((p) => p.id === 3)!.firstDeaths, 0);
  assert.equal(a.players.find((p) => p.id === 4)!.firstDeaths, 0);
  assert.ok(a.players.every((p) => !p.notes.some((note) => /caused the wipe/i.test(note))));
});

test('kills, logged wipe calls and unmarked wipes all retain the full encounter', () => {
  const { report, pull, fight } = fixture();
  for (const m of pull.metrics) {
    m.deaths = 1;
    m.aliveMs = 60000;
  }
  for (const kill of [true, false]) {
    fight.kill = kill;
    for (const call of [undefined, fight.startTime + 100000]) {
      report.wipeCalls = call === undefined ? {} : { [fight.id]: call };
      const manual = { ...selection, wipeStops: { [fight.id]: 50000 } };
      const a = analyze(report, [pull], manual);
      assert.equal(assessmentWindow(report, fight, manual).endTime, fight.endTime);
      assert.equal(a.pulls[0].window!.source, kill ? 'kill' : 'full');
      assert.ok(
        a.players.every((p) => p.score === 20 && p.deaths === 1 && p.durationMs === 300000),
      );
    }
  }
});

test('time-weighted aggregation survives splitting a measured interval into shorter pulls', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics) {
    m.aliveMs = 240000;
    m.deaths = 1;
  }
  const whole = analyze(report, [pull], selection);
  const first = structuredClone(pull),
    second = structuredClone(pull);
  first.fight.endTime = first.fight.startTime + 100000;
  first.metrics.forEach((m) => {
    m.aliveMs = 100000;
    m.deaths = 0;
  });
  second.fight = { ...second.fight, id: 2, startTime: first.fight.endTime };
  second.metrics.forEach((m) => {
    m.aliveMs = 140000;
    m.deaths = 1;
  });
  report.fights = [first.fight, second.fight];
  const split = analyze(report, [first, second], selection);
  for (const p of split.players) {
    const previous = whole.players.find((v) => v.rowKey === p.rowKey)!;
    close(p.score!, previous.score!);
    assert.equal(p.durationMs, previous.durationMs);
    assert.equal(p.aliveMs, previous.aliveMs);
    assert.equal(p.deaths, previous.deaths);
  }
});

test('boss identity, difficulty and specialization do not alter identical survival facts', () => {
  const { report, pull } = fixture();
  pull.metrics.forEach((m) => {
    m.aliveMs = 210000;
    m.deaths = 2;
  });
  const before = analyze(report, [pull], selection);
  pull.fight.encounterId = 99999999;
  pull.fight.difficulty = 17;
  pull.fight.name = 'Unknown future boss';
  pull.metrics.forEach((m) => {
    m.mechanics = [];
    m.mechanicFailures = 0;
    m.mechanicOpportunities = 0;
  });
  report.players[2].spec = 'Frost';
  report.players[2].class = 'Mage';
  pull.fight.playerSpecs![3] = 'Frost';
  const after = analyze(report, [pull], selection);
  for (const p of after.players) {
    assert.equal(p.score, 70);
    assert.equal(p.score, before.players.find((v) => v.id === p.id)!.score);
  }
});

test('long and short fights have proportional time weight even across different bosses', () => {
  const { report, pull } = fixture();
  const short = structuredClone(pull);
  short.fight = {
    ...short.fight,
    id: 2,
    encounterId: 99999999,
    difficulty: 17,
    endTime: short.fight.startTime + 10000,
  };
  short.metrics.forEach((m) => {
    m.aliveMs = 10000;
  });
  pull.metrics.forEach((m) => {
    m.aliveMs = 120000;
    m.deaths = 1;
  });
  report.fights = [short.fight, pull.fight];
  const a = analyze(report, [short, pull], selection);
  a.players.forEach((p) => close(p.score!, (100 * 130000) / 310000));
});

test('partial attendance keeps a visible score without a misleading full-selection ordinal', () => {
  const { report, pull } = fixture();
  const other = structuredClone(pull);
  other.fight = { ...other.fight, id: 2 };
  other.fight.friendlyPlayers = other.fight.friendlyPlayers.filter((id) => id !== 3);
  other.metrics = other.metrics.filter((m) => m.actorId !== 3);
  report.fights = [pull.fight, other.fight];
  const a = analyze(report, [pull, other], selection);
  const partial = a.players.find((p) => p.id === 3)!;
  assert.equal(partial.score, 100);
  assert.equal(partial.roleRank, null);
  assert.match(partial.rankingReason!, /Partial/);
  assert.equal(a.players.find((p) => p.id === 4)!.roleRank, 1);
});

test('all six tank classes have identical survival formulas without intake or mitigation penalties', () => {
  for (const profile of TANK_PROFILES) {
    const { report, pull } = fixture();
    report.players[0].class = profile.class;
    report.players[0].spec = profile.spec;
    pull.fight.playerSpecs![1] = profile.spec;
    pull.metrics[0].mechanics = [check(10, 2)];
    pull.metrics[0].deaths = 1;
    pull.metrics[0].aliveMs = 240000;
    pull.metrics[0].damageTaken = 1e15;
    const tank = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
    close(tank.score!, 80);
    assert.equal(tank.role, 'tank');
  }
});

test('the same survival inputs receive the same score while role lists remain separate', () => {
  const { report, pull } = fixture();
  pull.metrics.forEach((m) => {
    m.aliveMs = 240000;
    m.deaths = 1;
  });
  const a = analyze(report, [pull], selection);
  assert.deepEqual(new Set(a.players.map((p) => p.role)), new Set(['tank', 'healer', 'dps']));
  assert.ok(a.players.every((p) => p.score === 80 && p.roleRank === 1));
  assert.equal(a.players.find((p) => p.role === 'tank')!.rolePeers, 1);
  assert.equal(a.players.find((p) => p.role === 'healer')!.rolePeers, 1);
  assert.equal(a.players.find((p) => p.role === 'dps')!.rolePeers, 2);
});

test('unverified life timelines never become perfect scores or silently disappear from aggregates', () => {
  const { report, pull, fight } = fixture();
  const m = pull.metrics[0];
  m.life = summarizeLife(fight, [{ type: 'resurrect', timestamp: 60000 }]);
  m.aliveMs = m.life.aliveMs;
  m.deaths = m.life.deaths;
  const other = structuredClone(pull);
  other.fight.id = 2;
  other.metrics[0].life = summarizeLife(other.fight, []);
  other.metrics[0].aliveMs = other.metrics[0].life.aliveMs;
  report.fights = [fight, other.fight];
  const p = analyze(report, [pull, other], selection).players.find((p) => p.id === 1)!;
  assert.equal(p.score, null);
  assert.equal(p.rank, null);
  assert.ok(p.rankingReason);
  assert.equal(p.pullReviews.length, 2);
  assert.equal(p.pullReviews.find((r) => r.fightId === fight.id)!.execution.score, null);
  assert.equal(p.pullReviews.find((r) => r.fightId === other.fight.id)!.execution.score, 100);
});

test('no recorded contribution is unscored rather than perfect or an invented zero-performance verdict', () => {
  const { report, pull } = fixture();
  const m = pull.metrics[0];
  m.damage = 0;
  m.healing = 0;
  m.interrupts = 0;
  m.dispels = 0;
  m.facts!.casts = 0;
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
  assert.equal(p.score, null);
  assert.equal(p.rank, null);
  assert.match(p.execution.reasons.join(' '), /No recorded combat contribution/i);
});
