import test from 'node:test';
import assert from 'node:assert/strict';
import { tankRecorder } from '../server/tanks.js';
import { baseMetric } from '../server/ingest.js';
import { TANK_PROFILES, tankProfile, summarizeTankFacts } from '../shared/tanks.js';
import { analyze } from '../shared/analysis.js';
import type { Fight, Report } from '../shared/types.js';
import { fixture as executionFixture, check, selection } from './execution-fixtures.js';

const primaryIds = [195181, 2565, 132403, 192081, 215479, 203819];
function fixture(index = 0, encounterId = 999999) {
  const profile = TANK_PROFILES[index];
  const fight: Fight = {
    id: 1,
    encounterId,
    name: 'Synthetic unknown boss',
    difficulty: 5,
    startTime: 0,
    endTime: 60000,
    kill: false,
    percentage: null,
    friendlyPlayers: [1],
    playerSpecs: { 1: profile.spec },
  };
  const report: Report = {
    code: '6fjJxRFC21YHdTXB',
    title: 'Synthetic tank fixture',
    source: 'warcraftlogs',
    zone: 'Synthetic',
    startTime: 0,
    endTime: 60000,
    revision: 1,
    visibility: 'public',
    players: [{ id: 1, name: 'Fixture', class: profile.class, spec: profile.spec, role: 'tank' }],
    fights: [fight],
    warnings: ['Synthetic fixture; not a live validation of this class.'],
  };
  const ability = primaryIds[index],
    abilities = new Map([[ability, profile.primary[0]]]);
  const metrics = new Map([[1, baseMetric(1, 60000)]]);
  const hit = (timestamp: number, extra = {}) => ({
    timestamp,
    type: 'damage',
    sourceID: 901,
    targetID: 1,
    abilityGameID: 1,
    amount: 100,
    isAoE: false,
    ...extra,
  });
  return { profile, report, fight, ability, abilities, metrics, hit };
}

for (let i = 0; i < TANK_PROFILES.length; i++)
  test(`${TANK_PROFILES[i].id}: same class observations work on an arbitrary boss and across pages`, () => {
    const { report, fight, ability, abilities, metrics, hit } = fixture(i);
    const r = tankRecorder(report, fight, abilities);
    assert.ok(r.active);
    r.observe([
      { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
      hit(1000),
      hit(2000, { resourceActor: 2, maxHitPoints: 300, hitPoints: 200 }),
    ]);
    r.observe([
      { type: 'removebuff', timestamp: 3000, targetID: 1, abilityGameID: ability },
      hit(4000),
      hit(4500),
    ]);
    r.finish(metrics, new Map(), 60000);
    const f = metrics.get(1)!.tank!;
    assert.equal(f.meleeEvents, 4);
    assert.equal(f.knownMeleeEvents, 4);
    assert.equal(f.protectedMeleeEvents, 2);
    assert.equal(f.unknownMeleeEvents, 0);
    assert.equal(f.protectionGapEpisodes, 1);
    assert.equal(f.largeHits, 1);
    assert.equal(f.largeHitsWithDefense, 1);
    assert.equal(summarizeTankFacts([f]).protectionPercent, 50);
    assert.equal(
      metrics.get(1)!.evidence.filter((e) => e.kind === 'tank').length,
      1,
      'Adjacent gap hits produce one review incident, never stacked penalties',
    );
  });

test('missing start state, unresolved primary spell and same-timestamp aura transitions are unknown, not failures', () => {
  const { report, fight, ability, abilities, metrics, hit } = fixture();
  const r = tankRecorder(report, fight, abilities);
  r.observe([
    hit(1000),
    { type: 'applybuff', timestamp: 2000, targetID: 1, abilityGameID: ability },
    hit(2000),
    hit(3000),
  ]);
  r.finish(metrics, new Map(), 60000);
  assert.equal(metrics.get(1)!.tank!.unknownMeleeEvents, 2);
  assert.equal(metrics.get(1)!.tank!.knownMeleeEvents, 1);
  assert.equal(metrics.get(1)!.tank!.protectedMeleeEvents, 1);
  const other = tankRecorder(report, fight, new Map());
  const m = new Map([[1, baseMetric(1, 60000)]]);
  other.observe([{ type: 'combatantinfo', sourceID: 1, timestamp: 0, auras: [] }, hit(1000)]);
  other.finish(m, new Map(), 60000);
  assert.equal(m.get(1)!.tank!.knownMeleeEvents, 0);
  assert.equal(summarizeTankFacts([m.get(1)!.tank]).protectionPercent, null);
});

test('tank evidence excludes friendly damage and Stagger, respects death/resurrection and the selected cutoff', () => {
  const { report, fight, ability, abilities, metrics, hit } = fixture(4);
  report.petOwners = { 900: 1 };
  metrics.get(1)!.evaluated = {
    aliveMs: 10000,
    deaths: 0,
    mechanicFailures: null,
    mechanicOpportunities: null,
  };
  const life = new Map([
    [
      1,
      [
        { type: 'death', timestamp: 12000 },
        { type: 'resurrect', timestamp: 40000 },
      ],
    ],
  ]);
  const r = tankRecorder(report, fight, abilities);
  r.observe([
    { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
    hit(8000),
    hit(9000, { sourceID: 1 }),
    hit(9500, { sourceID: 900 }),
    hit(10000, { abilityGameID: 124255, tick: true }),
    { type: 'death', timestamp: 12000, targetID: 1 },
    hit(41000),
  ]);
  r.finish(metrics, life, 10000);
  assert.equal(metrics.get(1)!.tank!.meleeEvents, 2);
  assert.equal(metrics.get(1)!.evaluated!.tank!.meleeEvents, 1);
  assert.equal(
    metrics.get(1)!.tank!.pressureMs,
    9000,
    'Trailing melee windows stop during actual time dead',
  );
  assert.equal(metrics.get(1)!.tank!.deathsUnderPressure, 1);
  assert.equal(metrics.get(1)!.evaluated!.tank!.deathsUnderPressure, 0);
});

test('self-heal amounts are observed, not over-heal, an external healer or a guessed defensive score', () => {
  const { report, fight, abilities, metrics } = fixture();
  abilities.set(45470, 'Death Strike');
  const r = tankRecorder(report, fight, abilities);
  r.observe([
    {
      type: 'heal',
      timestamp: 1000,
      sourceID: 1,
      targetID: 1,
      abilityGameID: 45470,
      amount: 40,
      overheal: 90,
    },
    { type: 'heal', timestamp: 2000, sourceID: 2, targetID: 1, abilityGameID: 45470, amount: 300 },
  ]);
  r.finish(metrics, new Map(), 60000);
  assert.equal(metrics.get(1)!.tank!.selfHealing, 40);
});

test('Protection requires the correct class and no tank profile is invented for an unknown spec', () => {
  assert.equal(tankProfile({ class: 'Warrior', spec: 'Protection' })!.id, 'protection-warrior');
  assert.equal(tankProfile({ class: 'Paladin', spec: 'Protection' })!.id, 'protection-paladin');
  assert.equal(tankProfile({ class: 'Mage', spec: 'Protection' }), undefined);
  assert.equal(tankProfile({ class: 'DeathKnight', spec: 'Mixed' }), undefined);
  const { report, fight } = fixture();
  report.players[0].spec = 'Unknown';
  fight.playerSpecs = { 1: 'Unknown' };
  assert.equal(tankRecorder(report, fight, new Map()).active, false);
});

test('melee parries/misses are still attack opportunities, and hostile NPC-owned adds are retained', () => {
  const { report, fight, ability, abilities, metrics, hit } = fixture();
  report.petOwners = { 902: 901 };
  const r = tankRecorder(report, fight, abilities);
  assert.ok(
    r.filter.some((f) => f.includes('inCategory("damage") = true and ability.id = 1')),
    'The WCL query includes melee misses without guessing hitType numbers',
  );
  r.observe([
    { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
    hit(1000, { amount: 0, sourceID: 902 }),
    hit(2000, { amount: 0, hitType: 7 }),
  ]);
  r.finish(metrics, new Map(), 60000);
  assert.equal(metrics.get(1)!.tank!.meleeEvents, 2);
  assert.equal(metrics.get(1)!.tank!.protectedMeleeEvents, 2);
});

test('a stack removal without a remaining stack count leaves protection unknown', () => {
  const { report, fight, ability, abilities, metrics, hit } = fixture();
  const r = tankRecorder(report, fight, abilities);
  r.observe([
    { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 2 }] },
    { type: 'removebuffstack', timestamp: 1000, targetID: 1, abilityGameID: ability },
    hit(2000),
  ]);
  r.finish(metrics, new Map(), 60000);
  assert.equal(metrics.get(1)!.tank!.knownMeleeEvents, 0);
  assert.equal(metrics.get(1)!.tank!.unknownMeleeEvents, 1);
});

test('all tank classes use the same mechanics-and-alive formula while legacy defensive facts remain unscored', () => {
  for (const profile of TANK_PROFILES) {
    const { report, pull } = executionFixture({ roles: ['tank', 'dps'] });
    report.players[0] = { ...report.players[0], class: profile.class, spec: profile.spec };
    pull.fight.playerSpecs![1] = profile.spec;
    pull.metrics[0].mechanics = [check(10, 2)];
    const before = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
    assert.equal(before.role, 'tank');
    assert.equal(before.score, 86);
    const m = pull.metrics[0];
    m.damage = 1e14;
    m.damageTaken = 1e14;
    m.defensives = 100000;
    m.healing = 1e14;
    m.outputPercentile = 100;
    m.tank = {
      profile: profile.id,
      primaryProtection: profile.primary[0],
      snapshot: true,
      meleeEvents: 100,
      knownMeleeEvents: 100,
      protectedMeleeEvents: 0,
      unknownMeleeEvents: 0,
      protectionGapEpisodes: 100,
      resourceHits: 0,
      largeHits: 100,
      largeHitsWithDefense: 0,
      deathsUnderPressure: 99,
      selfHealing: 1e14,
      pressureMs: 300000,
      responseKnownWindows: 100,
      responseCoveredWindows: 0,
      responseUnknownWindows: 0,
      tasks: [
        {
          actorId: 1,
          fightId: 999999,
          incidentId: 'retired-task',
          timestamp: -100,
          ruleId: 'retired',
          category: 'defense',
          weight: 1,
          earned: 0,
          verified: true,
        },
      ],
    };
    const after = analyze(report, [pull], selection).players.find((p) => p.id === 1)!;
    assert.equal(after.score, before.score, profile.id);
    assert.ok(!('tankReview' in after));
    assert.ok(!('assessment' in after));
    assert.equal(after.damageTaken, 1e14);
  }
});

test('a tank who changes to damage has separate role entries rather than one unknown-role score', () => {
  const { report, pull } = executionFixture({ roles: ['tank'] });
  const next = structuredClone(pull);
  next.fight.id = 2;
  next.fight.playerSpecs![1] = 'Frost';
  report.players[0] = { ...report.players[0], spec: 'Mixed', role: 'unknown' };
  report.fights = [pull.fight, next.fight];
  const rows = analyze(report, [pull, next], selection).players;
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((p) => p.role)), new Set(['tank', 'dps']));
  assert.ok(rows.every((p) => p.score === 100 && p.pulls === 1));
  assert.equal(new Set(rows.map((p) => p.rowKey)).size, 2);
});
