import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../shared/analysis.js';
import { scoreExecution } from '../shared/execution.js';
import { assessmentWindow, validateWipeStops } from '../shared/windows.js';
import { evaluateEncounter } from '../server/encounter-engine.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { fixture, selection, check } from './execution-fixtures.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('multiplicative execution and persistent death costs reproduce declared examples', () => {
  for (const [m, a, d, expected] of [
    [100, 100, 0, 100],
    [100, 98, 1, 93],
    [100, 80, 1, 75],
    [0, 100, 0, 0],
    [90, 80, 1, 67],
    [100, 20, 1, 15],
  ]) {
    close(scoreExecution(m, a, d).score, expected);
  }
  assert.equal(scoreExecution(80, 80).score, 64);
  assert.ok(scoreExecution(90, 80).score > scoreExecution(80, 80).score);
});
test('score is bounded, monotone and death never helps with a fixed opportunity denominator', () => {
  for (let m = 0; m <= 100; m++)
    for (let a = 0; a <= 100; a++)
      for (const d of [0, 1, 2]) {
        const s = scoreExecution(m, a, d).score;
        assert.ok(s >= 0 && s <= a && s <= m);
        if (m < 100) assert.ok(scoreExecution(m + 1, a, d).score >= s);
        if (a < 100) assert.ok(scoreExecution(m, a + 1, d).score >= s);
        assert.ok(scoreExecution(m, a, d + 1).score <= s);
      }
  for (const v of [NaN, Infinity, -1, 101]) assert.throws(() => scoreExecution(v, 100));
  for (const v of [-1, 0.5, NaN, Infinity]) assert.throws(() => scoreExecution(100, 100, v));
});
test('equal family budgets prevent frequent easy checks from diluting another family', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics)
    m.mechanics = [
      check(100, 0, { ruleId: 'easy' }),
      check(1, 1, { ruleId: 'other', weight: 999 }),
    ];
  const a = analyze(report, [pull], selection);
  assert.equal(a.model.deathPenalty, 5);
  assert.ok(a.players.every((p) => p.score === 50 && p.execution.mechanicsScore === 50));
});
test('ambiguous peer evidence withholds the whole role/pull grade rather than boosting clean leftovers', () => {
  const { report, pull } = fixture();
  for (const m of pull.metrics)
    m.mechanics = [check(10, 0, { ruleId: 'clean' }), check(4, 4, { ruleId: 'uncertain' })];
  pull.metrics[2].mechanics![1].unknown = 1;
  const a = analyze(report, [pull], selection);
  assert.ok(a.players.filter((p) => p.role === 'dps').every((p) => p.score === null));
  assert.equal(a.players.find((p) => p.role === 'tank')!.score, 50);
});
test('resurrection restores availability without erasing the death deduction', () => {
  const { report, pull } = fixture();
  const m = pull.metrics[0];
  m.deaths = 1;
  m.aliveMs = 294000;
  m.facts!.lifeEvents = [
    { type: 'death', timestamp: 11000 },
    { type: 'resurrect', timestamp: 17000, combatRes: true, abilityId: 20484 },
  ];
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
  assert.equal(p.score, 93);
  assert.equal(p.execution.deathPenalty, 5);
  assert.equal(p.pullReviews[0].facts.lifeEvents[1].combatRes, true);
});
test('actual encounter opportunities remain uncredited during death, including a late partial window', () => {
  function result(dead: boolean) {
    const { report, pull, fight } = fixture({ boss: 3470 });
    const m = pull.metrics[2];
    const times = [
      ...Array.from({ length: 10 }, (_, i) => fight.startTime + 5000 + i * 25000),
      fight.startTime + 281000,
    ];
    const events: any[] = times.map((timestamp) => ({
      type: 'cast',
      timestamp,
      sourceID: 999,
      sourceInstance: 1,
      abilityGameID: 990001,
    }));
    const life = new Map();
    if (dead) {
      m.aliveMs = 297000;
      m.deaths = 1;
      life.set(m.actorId, [{ type: 'death', timestamp: fight.startTime + 297000 }]);
    } else
      events.push({
        type: 'damage',
        timestamp: fight.startTime + 297500,
        sourceID: 999,
        sourceInstance: 1,
        targetID: m.actorId,
        abilityGameID: 990001,
        amount: 10,
      });
    evaluateEncounter(
      report,
      fight,
      new Map(pull.metrics.map((m) => [m.actorId, m])),
      events,
      life,
      new Map([[990001, 'Soul Transfer']]),
    );
    return analyze(report, [pull], selection).players.find((p) => p.id === m.actorId)!;
  }
  const dead = result(true),
    alive = result(false);
  assert.equal(dead.mechanicOpportunities, 11);
  assert.equal(alive.mechanicOpportunities, 11);
  assert.equal(dead.execution.missedWhileDead, 1);
  assert.equal(dead.mechanicFailures, 0);
  close(dead.score!, 85);
  close(alive.score!, (100 * 10) / 11);
  assert.ok(dead.score! < alive.score!);
});
test('pending windows at the shared assessment end grant neither passes nor failures', () => {
  const { report, pull, fight } = fixture({ boss: 3470 });
  evaluateEncounter(
    report,
    fight,
    new Map(pull.metrics.map((m) => [m.actorId, m])),
    [
      { type: 'cast', timestamp: fight.endTime - 2000, sourceID: 999, abilityGameID: 990001 },
      {
        type: 'damage',
        timestamp: fight.endTime - 1000,
        sourceID: 999,
        targetID: 3,
        abilityGameID: 990001,
        amount: 5,
      },
    ],
    new Map(),
    new Map([[990001, 'Anguished Echoes']]),
  );
  assert.ok(
    pull.metrics.every(
      (m) => m.mechanics!.find((r) => r.name === 'Anguished Echoes')!.opportunities === 0,
    ),
  );
  assert.ok(analyze(report, [pull], selection).players.every((p) => p.score === null));
});
test('unconfirmed wipes retain all role rows and statistics but carry no grade', () => {
  const { report, pull } = fixture();
  pull.fight.kill = false;
  const a = analyze(report, [pull], selection);
  assert.equal(a.players.length, 4);
  assert.ok(a.players.every((p) => p.score === null && p.damage > 0));
  assert.ok(a.players.every((p) => /wipe call/i.test(p.pullReviews[0].execution.reasons[0])));
});
test('manual stops are shared, explicit and strictly bounded; mismatched cached windows are rejected', () => {
  const { report, pull, fight } = fixture();
  fight.kill = false;
  report.wipeCalls = { [fight.id]: fight.startTime + 100000 };
  assert.equal(assessmentWindow(report, fight, selection).source, 'logged');
  const manual = { ...selection, wipeStops: { [fight.id]: 50000 } };
  assert.deepEqual(assessmentWindow(report, fight, manual), {
    endTime: fight.startTime + 50000,
    source: 'manual',
    confirmed: true,
  });
  assert.throws(() => analyze(report, [pull], manual), /window/);
  for (const wipeStops of [{ '1': 0 }, { '1': 300001 }, { '999': 1 }, { bad: 1 }] as Record<
    string,
    number
  >[])
    assert.throws(() => validateWipeStops(report, { ...selection, wipeStops }));
  fight.kill = true;
  assert.throws(() => validateWipeStops(report, manual));
});
test('pull duration weighting stops a ten-second clean pull equalling five minutes of mistakes', () => {
  const { report, pull } = fixture();
  const short = structuredClone(pull);
  short.fight = { ...short.fight, id: 2, endTime: short.fight.startTime + 10000 };
  for (const m of short.metrics) {
    m.aliveMs = 10000;
    m.mechanics = [check(1, 0)];
  }
  for (const m of pull.metrics) m.mechanics = [check(100, 60)];
  report.fights = [short.fight, pull.fight];
  const a = analyze(report, [short, pull], selection);
  close(a.players[0].score!, (100 * 10000 + 40 * 300000) / 310000);
});
test('partial attendance keeps a visible score without a misleading ordinal rank', () => {
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
test('all six tank classes use identical mechanics, availability and death rules', () => {
  for (const profile of TANK_PROFILES) {
    const { report, pull } = fixture();
    report.players[0].class = profile.class;
    report.players[0].spec = profile.spec;
    pull.fight.playerSpecs![1] = profile.spec;
    pull.metrics[0].mechanics = [check(10, 2)];
    pull.metrics[0].deaths = 1;
    pull.metrics[0].aliveMs = 240000;
    const tank = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
    close(tank.score!, 59);
    assert.equal(tank.role, 'tank');
  }
});
test('zero contribution remains ungraded instead of passive perfection', () => {
  const { report, pull } = fixture();
  const m = pull.metrics[0];
  m.damage = 0;
  m.healing = 0;
  m.interrupts = 0;
  m.dispels = 0;
  m.facts!.casts = 0;
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
  assert.equal(p.score, null);
  assert.equal(p.roleRank, null);
});
