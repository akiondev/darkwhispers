import test from 'node:test';
import assert from 'node:assert/strict';
import { tankRecorder } from '../server/tanks.js';
import { baseMetric } from '../server/ingest.js';
import { TANK_PROFILES, tankProfile, summarizeTankFacts } from '../shared/tanks.js';
import { analyze } from '../shared/analysis.js';
import type { Fight, Metric, Report, TankTask } from '../shared/types.js';
import { gradeTankTasks, combineTankGrades, TANK_WEIGHTS } from '../shared/tank-scoring.js';

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

test('mixed tank/damage selections keep separate role contexts and a provisional index', () => {
  const { report, fight, metrics } = fixture();
  const second = {
    ...fight,
    id: 2,
    startTime: 60000,
    endTime: 120000,
    playerSpecs: { 1: 'Frost' },
  };
  report.fights = [fight, second];
  const m = { ...metrics.get(1)!, mechanicFailures: 0, mechanicOpportunities: 5 };
  const result = analyze(
    report,
    [fight, second].map((f) => ({
      fight: f,
      metrics: [m],
      complete: true,
      warnings: [],
      mechanicRule: null,
      wipeTailMs: null,
    })),
    { encounterId: null, difficulty: null, mode: 'all', fightIds: null, excludeWipeTail: false },
  ).players[0];
  assert.equal(result.role, 'unknown');
  assert.ok(result.score !== null && result.provisional);
  assert.equal(result.rank, 1);
  assert.equal(result.assessment!.contexts.length, 2);
  assert.ok(result.tankReview);
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

test('every tank class receives a role index; required contacts and raw intake do not create penalties', () => {
  for (let i = 0; i < TANK_PROFILES.length; i++) {
    const { report, fight, ability, abilities, metrics, hit } = fixture(i, i % 2 ? 3420 : 99999);
    const r = tankRecorder(report, fight, abilities);
    r.observe([
      { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
      hit(1000),
    ]);
    r.finish(metrics, new Map(), 60000);
    const m = metrics.get(1)!;
    m.mechanicOpportunities = 10;
    m.mechanicFailures = 10;
    const analyzeOne = (metric: Metric) =>
      analyze(
        report,
        [
          {
            fight,
            metrics: [metric],
            complete: true,
            warnings: [],
            mechanicRule: null,
            wipeTailMs: null,
          },
        ],
        {
          encounterId: null,
          difficulty: null,
          mode: 'all',
          fightIds: null,
          excludeWipeTail: false,
        },
      ).players[0];
    const p = analyzeOne(m);
    assert.ok(p.score !== null && p.provisional);
    assert.equal(p.rank, 1);
    assert.equal(p.roleRank, 1);
    assert.equal(p.perBoss[0].score, p.score);
    assert.equal(p.tankReview!.protectionPercent, 100);
    const alt = analyzeOne({ ...m, mechanicFailures: 0, damage: 1e12, damageTaken: 1e12 });
    assert.equal(
      alt.score,
      p.score,
      'Changing avoidance, padding output or required intake cannot manufacture a tank grade',
    );
    assert.equal(summarizeTankFacts([m.tank, undefined]).pullsMissing, 1);
  }
});

function verifiedTasks(fightId = 1): TankTask[] {
  return Object.keys(TANK_WEIGHTS).map((key, i) => ({
    actorId: 1,
    fightId,
    incidentId: `independent-task-${i}`,
    timestamp: 5000 + i,
    ruleId: 'synthetic-reviewed-criterion/v1',
    category: key as TankTask['category'],
    weight: 1,
    earned: key === 'safety' ? 0.5 : 1,
    verified: true,
  }));
}
test('tank task scoring is fixed-weight, bounded, duplicate-safe and explicit about unknown evidence', () => {
  const tasks = verifiedTasks(),
    scope = { actorId: 1, fightIds: [1] };
  const grade = gradeTankTasks(tasks, scope);
  assert.equal(grade.score, 90);
  assert.equal(grade.coverage, 100);
  assert.equal(grade.knownIncidents, 5);
  assert.equal(
    gradeTankTasks([...tasks, { ...tasks[0] }], scope).score,
    90,
    'A repeated event must not double-charge an incident',
  );
  const unknown = tasks.map((t) => (t.category === 'defense' ? { ...t, earned: null } : t));
  const partial = gradeTankTasks(unknown, scope);
  assert.equal(partial.score, null);
  assert.equal(partial.lowerBound, 60);
  assert.equal(partial.upperBound, 90);
  assert.equal(partial.unknownIncidents, 1);
  assert.equal(
    gradeTankTasks(
      tasks.map((t) => ({ ...t, verified: false })),
      scope,
    ).score,
    null,
    'An unverified conclusion cannot create a score',
  );
  assert.throws(
    () => gradeTankTasks([...tasks, { ...tasks[0], category: 'defense' }], scope),
    /double-counted/,
  );
  assert.throws(() => gradeTankTasks([{ ...tasks[0], actorId: 2 }], scope), /out-of-scope/);
  assert.throws(() => gradeTankTasks([{ ...tasks[0], earned: 1.01 }], scope), /out-of-scope/);
});
test('tank grade aggregation gives each boss equal weight and missing boss evidence remains unknown', () => {
  const scope = { actorId: 1, fightIds: [1] },
    perfect = gradeTankTasks(
      verifiedTasks().map((t) => ({ ...t, earned: 1 })),
      scope,
    ),
    zero = gradeTankTasks(
      verifiedTasks().map((t) => ({ ...t, earned: 0 })),
      scope,
    );
  assert.equal(combineTankGrades([perfect, zero]).score, 50);
  const incomplete = combineTankGrades([perfect, gradeTankTasks([])]);
  assert.equal(incomplete.score, null);
  assert.equal(incomplete.lowerBound, 50);
  assert.equal(incomplete.upperBound, 100);
});
test('the generic scoring kernel can grade verified synthetic duties for every tank class on any boss', () => {
  for (let i = 0; i < TANK_PROFILES.length; i++) {
    const { report, fight, ability, abilities, metrics, hit } = fixture(i, i % 2 ? 3420 : 654321);
    const r = tankRecorder(report, fight, abilities);
    r.observe([
      { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
      hit(1000),
    ]);
    r.finish(metrics, new Map(), 60000);
    metrics.get(1)!.tank!.tasks = verifiedTasks();
    const pull = {
      fight,
      metrics: [metrics.get(1)!],
      complete: true,
      warnings: ['Synthetic criteria, not live boss validation.'],
      mechanicRule: null,
      mechanicScope: 'complete' as const,
      wipeTailMs: null,
    };
    const selection = {
      encounterId: null,
      difficulty: null,
      mode: 'all' as const,
      fightIds: null,
      excludeWipeTail: false,
    };
    const player = analyze(report, [pull], selection).players[0];
    assert.ok(player.score !== null && player.provisional);
    assert.equal(player.rank, 1);
    assert.equal(player.roleRank, 1);
    assert.equal(player.tankReview!.grade.score, 90);
    assert.notEqual(player.score, 100, 'Being best of one must not force a perfect score');
    metrics.get(1)!.tank!.tasks![0].timestamp = 60001;
    assert.throws(() => analyze(report, [pull], selection), /evaluation window/);
  }
});

test('complementary missing categories on different bosses cannot manufacture a complete tank grade', () => {
  const { report, fight, ability, abilities, metrics, hit } = fixture();
  const r = tankRecorder(report, fight, abilities);
  r.observe([
    { type: 'combatantinfo', timestamp: 0, sourceID: 1, auras: [{ ability, stacks: 1 }] },
    hit(1000),
  ]);
  r.finish(metrics, new Map(), 60000);
  const first = structuredClone(metrics.get(1)!);
  first.tank!.tasks = verifiedTasks().slice(0, 3);
  const second = structuredClone(metrics.get(1)!);
  second.tank!.tasks = verifiedTasks(2)
    .slice(3)
    .map((t) => ({ ...t, timestamp: t.timestamp + 60000 }));
  const next = { ...fight, id: 2, encounterId: 111111, startTime: 60000, endTime: 120000 };
  report.fights = [fight, next];
  const result = analyze(
    report,
    [
      { fight, metrics: [first] },
      { fight: next, metrics: [second] },
    ].map((p) => ({ ...p, complete: true, warnings: [], mechanicRule: null, wipeTailMs: null })),
    { encounterId: null, difficulty: null, mode: 'all', fightIds: null, excludeWipeTail: false },
  ).players[0];
  assert.ok(result.score !== null && result.provisional);
  assert.equal(result.tankReview!.grade.complete, false);
  assert.equal(result.tankReview!.status, 'partial');
});
