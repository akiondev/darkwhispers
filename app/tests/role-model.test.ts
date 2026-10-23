import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../shared/analysis.js';
import { ROLE_WEIGHTS } from '../shared/role-model.js';
import { TANK_PROFILES } from '../shared/tanks.js';
import { baseMetric } from '../server/ingest.js';
import { actionContinuity } from '../server/activity.js';
import { evaluationWindow } from '../server/evaluation.js';
import { supportsTempest } from '../server/mechanics.js';
import type { Fight, Report, PullData, Selection } from '../shared/types.js';
const selection: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};
const bosses = [3513, 3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379];
function fixture(boss = 3513, difficulty = 4) {
  const players = [
    ...TANK_PROFILES.map((p, i) => ({
      id: i + 1,
      name: p.id,
      class: p.class,
      spec: p.spec,
      role: 'tank' as const,
    })),
    { id: 7, name: 'Damage', class: 'Hunter', spec: 'BeastMastery', role: 'dps' as const },
    { id: 8, name: 'Healer', class: 'Monk', spec: 'Mistweaver', role: 'healer' as const },
  ];
  const fight: Fight = {
    id: 1,
    encounterId: boss,
    name: `Synthetic ${boss}`,
    difficulty,
    startTime: 0,
    endTime: 120000,
    kill: true,
    percentage: 0,
    friendlyPlayers: players.map((p) => p.id),
    playerSpecs: Object.fromEntries(players.map((p) => [p.id, p.spec])),
  };
  const report: Report = {
    code: '6fjJxRFC21YHdTXB',
    title: 'Synthetic class/difficulty coverage',
    source: 'warcraftlogs',
    zone: 'Synthetic Venomous Abyss',
    startTime: 0,
    endTime: 120000,
    revision: 1,
    visibility: 'public',
    players,
    fights: [fight],
    warnings: ['Synthetic fixture, not live validity for every boss/difficulty.'],
  };
  const pull: PullData = {
    fight,
    complete: true,
    warnings: [],
    mechanicRule: null,
    mechanicScope: undefined,
    wipeTailMs: null,
    metrics: players.map((p, i) => {
      const m = baseMetric(p.id, 120000);
      m.aliveMs = 108000;
      m.activity = { activeMs: 96000, eligibleMs: 120000, activeWindows: 10, eligibleWindows: 12 };
      if (i < 6)
        m.tank = {
          profile: TANK_PROFILES[i].id,
          primaryProtection: TANK_PROFILES[i].primary[0],
          snapshot: true,
          meleeEvents: 100,
          knownMeleeEvents: 100,
          protectedMeleeEvents: 95,
          unknownMeleeEvents: 0,
          protectionGapEpisodes: 1,
          resourceHits: 0,
          largeHits: 0,
          largeHitsWithDefense: 0,
          deathsUnderPressure: 0,
          selfHealing: 0,
          pressureMs: 120000,
          responseKnownWindows: 20,
          responseCoveredWindows: 18,
          responseUnknownWindows: 0,
        };
      return m;
    }),
  };
  return { report, pull, fight };
}
test('all ten S2 Venomous Abyss bosses and LFR/Normal/Heroic/Mythic rank every tank class and role', () => {
  for (const boss of bosses)
    for (const difficulty of [1, 3, 4, 5]) {
      const { report, pull } = fixture(boss, difficulty),
        result = analyze(report, [pull], selection);
      assert.equal(result.players.length, 8);
      for (const p of result.players) {
        assert.ok(p.score !== null && p.score >= 0 && p.score <= 100);
        assert.ok(p.rank && p.roleRank);
        assert.ok(p.provisional);
        assert.equal(p.assessment!.contexts[0].difficulty, difficulty);
        assert.ok(Math.abs(p.assessment!.factors.reduce((n, f) => n + f.weight, 0) - 100) < 1e-8);
      }
      assert.equal(result.players.find((p) => p.id === 7)!.score, 68);
      assert.equal(result.players.find((p) => p.id === 1)!.score, 76.5);
    }
});
test('fixed weights reconcile measured points, neutral unknowns and uncertainty bounds', () => {
  const { report, pull } = fixture();
  const result = analyze(report, [pull], selection),
    p = result.players.find((p) => p.id === 7)!;
  assert.equal(p.assessment!.lower, 43);
  assert.equal(p.assessment!.upper, 93);
  assert.equal(p.coverage, 50);
  assert.equal(p.score, 68);
  const before = p.score;
  pull.metrics[6].damage = 1e15;
  pull.metrics[6].damageTaken = 1e15;
  pull.metrics[6].interrupts = 100000;
  assert.equal(analyze(report, [pull], selection).players.find((p) => p.id === 7)!.score, before);
  pull.metrics[6].outputPercentile = 80;
  const graded = analyze(report, [pull], selection).players.find((p) => p.id === 7)!;
  assert.equal(graded.score, 77);
  assert.equal(graded.coverage, 80);
  assert.equal(graded.assessment!.factors.find((f) => f.key === 'output')!.points, 24);
  assert.equal(ROLE_WEIGHTS.tank.output, 10);
});
test('missing another actor percentile never discards the known class/spec benchmark', () => {
  const { report, pull } = fixture();
  pull.metrics[6].outputPercentile = 80;
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 7)!;
  assert.equal(p.assessment!.factors.find((f) => f.key === 'output')!.score, 80);
  assert.equal(p.assessment!.factors.find((f) => f.key === 'output')!.measuredWeight, 30);
});
test('tiny tank samples and unknown aura states cannot masquerade as perfect defense', () => {
  const { report, pull } = fixture();
  const t = pull.metrics[0].tank!;
  t.responseKnownWindows = 1;
  t.responseCoveredWindows = 1;
  t.responseUnknownWindows = 9;
  const p = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
  const f = p.assessment!.factors.find((f) => f.key === 'protection')!;
  assert.ok(f.measuredWeight < 1);
  assert.ok(f.neutralPoints > 12);
  assert.ok(p.assessment!.upper - p.assessment!.lower > 50);
  t.selfHealing = 1e15;
  t.largeHitsWithDefense = 10000;
  assert.equal(analyze(report, [pull], selection).players.find((x) => x.id === 1)!.score, p.score);
});
test('difficulty contexts remain separate; each difficulty gets equal weight regardless of pull count', () => {
  const { report, pull } = fixture();
  const normal = structuredClone(pull);
  normal.fight = { ...normal.fight, id: 2, difficulty: 3 };
  normal.metrics.forEach((m) => (m.aliveMs = 0));
  const repeat = structuredClone(pull);
  repeat.fight.id = 3;
  report.fights = [pull.fight, normal.fight, repeat.fight];
  const combined = analyze(report, [pull, normal, repeat], selection).players.find(
    (p) => p.id === 7,
  )!;
  const first = analyze({ ...report, fights: [pull.fight] }, [pull], selection).players.find(
    (p) => p.id === 7,
  )!.score!;
  const second = analyze({ ...report, fights: [normal.fight] }, [normal], selection).players.find(
    (p) => p.id === 7,
  )!.score!;
  assert.equal(combined.score, (first + second) / 2);
  assert.equal(combined.assessment!.contexts.length, 2);
});
test('short attendance remains ranked and disclosed rather than silently removed', () => {
  const { report, pull } = fixture();
  const other = structuredClone(pull);
  other.fight = {
    ...other.fight,
    id: 2,
    encounterId: 3379,
    friendlyPlayers: other.fight.friendlyPlayers.filter((id) => id !== 7),
  };
  other.metrics = other.metrics.filter((m) => m.actorId !== 7);
  report.fights = [pull.fight, other.fight];
  const p = analyze(report, [pull, other], selection).players.find((p) => p.id === 7)!;
  assert.ok(p.rank);
  assert.equal(p.bosses, 1);
  assert.equal(p.bossCoverage, 50);
  assert.equal(p.confidence, 'limited');
});
test('action continuity excludes shared downtime and credits long-window action rather than cast spam', () => {
  const { report, fight } = fixture();
  fight.friendlyPlayers = [1, 2];
  const casts = [
    { sourceID: 1, timestamp: 1000 },
    { sourceID: 2, timestamp: 1000 },
    { sourceID: 1, timestamp: 11000 },
  ];
  const a = actionContinuity(report, fight, casts, new Map(), 120000);
  assert.equal(a.get(2)!.activeMs, 10000);
  assert.equal(a.get(2)!.eligibleMs, 20000);
  assert.equal(a.get(1)!.activeMs, 20000);
  assert.equal(a.get(1)!.eligibleMs, 20000);
  const spam = actionContinuity(
    report,
    fight,
    [...casts, ...Array.from({ length: 100 }, () => casts[0])],
    new Map(),
    120000,
  );
  assert.deepEqual(a, spam);
});
test('collapse comparison works on both new bosses and every raid difficulty; kills retain full duration', () => {
  for (const boss of [3513, 3379])
    for (const difficulty of [1, 3, 4, 5]) {
      const { fight } = fixture(boss, difficulty);
      fight.friendlyPlayers = Array.from({ length: 10 }, (_, i) => i + 1);
      fight.kill = false;
      const life = new Map(
        Array.from({ length: 5 }, (_, i) => [i + 1, [{ type: 'death', timestamp: 60000 }]]),
      );
      assert.equal(evaluationWindow(fight, life, null)!.endTime, 60000);
      assert.equal(evaluationWindow({ ...fight, kill: true }, life, null), undefined);
    }
});
test('Tempest adapter activates by verified encounter and ability identity on all four raid difficulties', () => {
  const { fight } = fixture(3420);
  const abilities = new Map([
    [1287072, 'Tempest'],
    [1287083, 'Tempest'],
  ]);
  for (const difficulty of [1, 3, 4, 5])
    assert.ok(supportsTempest({ ...fight, difficulty }, abilities));
  assert.equal(supportsTempest({ ...fight, encounterId: 3513 }, abilities), false);
});

test('missing actor measurements stay unknown instead of becoming deaths or silent perfect coverage', () => {
  const { report, pull } = fixture();
  const second = structuredClone(pull);
  second.fight.id = 2;
  second.metrics = second.metrics.filter((m) => m.actorId !== 7);
  report.fights = [pull.fight, second.fight];
  const p = analyze(report, [pull, second], selection).players.find((p) => p.id === 7)!;
  const f = p.assessment!.factors.find((f) => f.key === 'survival')!;
  assert.equal(f.score, 90);
  assert.equal(f.measuredWeight, 15);
  assert.ok(p.rank);
});
