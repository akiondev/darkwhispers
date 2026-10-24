import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../shared/analysis.js';
import { scoreSurvival } from '../shared/execution.js';
import { summarizeLife } from '../shared/life.js';
import { assessmentWindow } from '../shared/windows.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { fixture as baseFixture, selection, check } from './execution-fixtures.js';
import { measuredComponent, scoreComposite } from '../shared/composite.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function fixture(options: Parameters<typeof baseFixture>[0] = {}) {
  const result = baseFixture({
    roles: ['tank', 'healer', 'dps', 'dps', 'tank', 'healer'],
    ...options,
  });
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

test('verified mechanics alter composite points without altering the survival measurement', () => {
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
  assert.equal(a.model.id, 'composite/v2');
  assert.equal(a.model.deathPenalty, 0);
  assert.ok(a.players.every((p) => p.execution.alivePercent === 80));
  for (const p of a.players.filter((p) => p.role === 'dps')) {
    assert.equal(p.score, 96);
    assert.equal(p.execution.composite!.components.mechanics.score, 100);
    assert.ok(p.pullReviews[0].mechanics.find((m) => m.ruleId === 'other')?.scored === false);
  }
  for (const p of a.players.filter((p) => p.role !== 'dps')) {
    assert.ok(p.execution.composite!.components.mechanics.score! < 1);
    assert.ok(p.pullReviews[0].mechanics.some((m) => m.scored && m.failed === 1));
  }
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
  assert.equal(p.execution.alivePercent, 98);
  close(p.score!, 99.4);
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
  assert.equal(a.players.find((p) => p.id === 1)!.execution.alivePercent, 80);
  assert.equal(a.players.find((p) => p.id === 2)!.execution.alivePercent, 80);
  assert.equal(a.players.find((p) => p.id === 1)!.deaths, 1);
  assert.equal(a.players.find((p) => p.id === 2)!.deaths, 6);
  const previousScore = a.players.find((p) => p.id === 1)!.score;
  pull.metrics[0].deaths = 6;
  assert.equal(
    analyze(report, [pull], selection).players.find((p) => p.id === 1)!.score,
    previousScore,
  );
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
        a.players.every(
          (p) => p.execution.alivePercent === 20 && p.deaths === 1 && p.durationMs === 300000,
        ),
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
    assert.equal(p.execution.alivePercent, 70);
    assert.equal(
      p.execution.alivePercent,
      before.players.find((v) => v.id === p.id)!.execution.alivePercent,
    );
    const expected = p.role === 'dps' ? 88 : p.role === 'healer' ? 82 : 77.5;
    close(p.score!, expected);
    assert.equal(p.execution.composite!.scope, 'output-survival');
    assert.equal(p.execution.composite!.components.mechanics.score, null);
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
  a.players.forEach((p) => close(p.execution.alivePercent, (100 * 130000) / 310000));
});

test('partial attendance keeps a visible score without a misleading full-selection ordinal', () => {
  const { report, pull } = fixture({
    roles: ['tank', 'healer', 'dps', 'dps', 'tank', 'healer', 'dps'],
  });
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

test('all six tank classes use identical composite rules without intake or mitigation penalties', () => {
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
    close(tank.execution.alivePercent, 80);
    close(tank.execution.composite!.components.mechanics.score!, 80);
    close(tank.score!, 82);
    assert.equal(tank.role, 'tank');
  }
});

test('identical survival is measured equally but contributes the approved role-specific weights', () => {
  const { report, pull } = fixture();
  pull.metrics.forEach((m) => {
    m.aliveMs = 240000;
    m.deaths = 1;
  });
  const a = analyze(report, [pull], selection);
  assert.deepEqual(new Set(a.players.map((p) => p.role)), new Set(['tank', 'healer', 'dps']));
  assert.ok(a.players.every((p) => p.execution.alivePercent === 80 && p.roleRank === 1));
  assert.equal(a.players.find((p) => p.role === 'tank')!.score, 94);
  assert.equal(a.players.find((p) => p.role === 'healer')!.score, 94);
  assert.equal(a.players.find((p) => p.role === 'dps')!.score, 96);
  assert.equal(a.players.find((p) => p.role === 'tank')!.rolePeers, 2);
  assert.equal(a.players.find((p) => p.role === 'healer')!.rolePeers, 2);
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

test('approved single-score example reconciles three contributions to 82 points', () => {
  const result = scoreComposite('dps', {
    mechanics: measuredComponent(80, 'Synthetic checked mechanics'),
    output: measuredComponent(80, 'Synthetic report contribution'),
    survival: measuredComponent(90, 'Synthetic verified life interval'),
  });
  close(result.score!, 82);
  close(result.components.mechanics.points, 40);
  close(result.components.output.points, 24);
  close(result.components.survival.points, 18);
  assert.equal(Object.keys(result.components).length, 3);
  assert.equal(result.complete, true);
});

test('DPS, effective healing and tank damage each affect their own output-weighted score', () => {
  for (const [actorId, expectedScore, kind] of [
    [3, 85, 'damage'],
    [2, 90, 'healing'],
    [1, 95, 'damage'],
  ] as const) {
    const { report, pull } = fixture();
    const before = analyze(report, [pull], selection).players.find((p) => p.id === actorId)!;
    pull.metrics.find((m) => m.actorId === actorId)![kind] /= 2;
    const after = analyze(report, [pull], selection).players.find((p) => p.id === actorId)!;
    close(before.score!, 100);
    close(after.score!, expectedScore);
    close(after.execution.composite!.components.output.score!, 50);
    assert.equal(after.execution.alivePercent, before.execution.alivePercent);
    assert.equal(
      after.execution.composite!.components.output.basis,
      'report-relative contribution',
    );
  }
});

test('output peers come from the actual role in the same pull on both kills and wipes', () => {
  const { report, pull } = fixture();
  pull.metrics[2].damage /= 2;
  pull.metrics[1].damage = 1e15;
  const kill = analyze(report, [pull], selection).players.find((p) => p.id === 3)!;
  assert.equal(kill.execution.composite!.components.output.score, 50);
  pull.fight.kill = false;
  pull.metrics[2].outputPercentile = 100;
  const wipe = analyze(report, [pull], selection).players.find((p) => p.id === 3)!;
  assert.equal(wipe.score, kill.score, 'A kill-only parse is never substituted on a wipe');
  assert.equal(wipe.execution.composite!.components.output.score, 50);
});

test('verified mechanic failures reduce total score while raw intake and unassigned utility do not', () => {
  const { report, pull } = fixture();
  const actor = () => analyze(report, [pull], selection).players.find((p) => p.id === 3)!;
  assert.equal(actor().score, 100);
  pull.metrics[2].mechanics = [check(10, 2)];
  const failed = actor();
  close(failed.score!, 90);
  close(failed.execution.composite!.components.mechanics.score!, 80);
  pull.metrics[2].damageTaken = 1e20;
  pull.metrics[2].defensives = 100000;
  pull.metrics[2].interrupts = 100000;
  pull.metrics[2].dispels = 100000;
  assert.equal(actor().score, failed.score);
});

test('an unavailable mechanic rule changes the whole role cohort to the documented two-factor score', () => {
  const { report, pull } = fixture();
  const m = pull.metrics[2];
  m.mechanics = [];
  m.facts!.preparation = {
    flask: 'present',
    food: 'unknown',
    basis: 'Synthetic partial snapshot',
  };
  const result = analyze(report, [pull], selection);
  const p = result.players.find((p) => p.id === 3)!;
  const c = p.execution.composite!;
  assert.equal(p.score, 100);
  assert.equal(p.roleRank, 1);
  assert.equal(c.components.mechanics.score, null);
  close(c.components.mechanics.weight, 0);
  close(c.components.output.points, 60);
  close(c.components.survival.points, 40);
  assert.equal(c.complete, true);
  assert.equal(c.scope, 'output-survival');
  assert.ok(!('preparation' in c.components));
  assert.ok(
    result.players
      .filter((p) => p.role === 'dps')
      .every((p) => p.execution.composite!.components.mechanics.weight === 0),
  );
  assert.ok(
    result.players
      .filter((p) => p.role !== 'dps')
      .every((p) => p.execution.composite!.components.mechanics.weight > 0),
  );
});

test('a lone participant has a measured contribution score but no peer rank', () => {
  const { report, pull } = fixture({ roles: ['dps', 'healer', 'tank'] });
  for (const p of analyze(report, [pull], selection).players) {
    const c = p.execution.composite!;
    assert.equal(c.components.output.score, 100);
    assert.equal(p.score, 100);
    assert.equal(p.roleRank, null);
    assert.equal(c.components.mechanics.score, 100);
    assert.equal(c.components.survival.score, 100);
    assert.equal(c.complete, true);
    assert.match(c.components.output.reason, /single|only|sole|solo|one participant/i);
  }
});
