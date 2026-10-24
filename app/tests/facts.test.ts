import test from 'node:test';
import assert from 'node:assert/strict';
import { demoData } from '../shared/demo.js';
import { emptyFacts, factRecorder, recordedLifeEvent } from '../server/facts.js';

const fight = { ...demoData().report.fights[0], startTime: 10000, endTime: 110000 };
const abilities = new Map([
  [1235111, 'Flask of the Shattered Sun'],
  [1294727, 'Well Fed'],
  [1236994, 'Potion of Recklessness'],
  [1295247, 'Concentrated Silvermoon Health Potion'],
  [6262, 'Healthstone'],
  [452930, 'Demonic Healthstone'],
  [1230862, 'Potion of Devoured Dreams'],
  [1230863, 'Potion of Zealotry'],
]);

test('pull preparation records verified positive observations, enchants and actual socketed gems only', () => {
  const recorder = factRecorder(fight, [1, 2], abilities);
  recorder.observe([
    {
      type: 'combatantinfo',
      timestamp: 10000,
      sourceID: 1,
      auras: [
        { ability: 1235111 },
        { ability: { gameID: 1294727 } },
        { abilityGameID: 1236994 },
        { ability: 1235111 },
        { ability: 9999999 },
        { ability: 1230862 },
      ],
      gear: [
        { id: 123, permanentEnchant: 456, gems: [{ id: 789, itemLevel: 0, icon: 'discarded' }] },
        { id: 124, gems: [{ id: 790 }, { id: 790 }, { id: 0 }, null, { itemLevel: 10 }] },
        null,
        { id: 125, permanentEnchant: 0 },
      ],
    },
    { type: 'combatantinfo', timestamp: 10500, sourceID: 1, auras: [] },
  ]);
  assert.deepEqual(recorder.facts.get(1), {
    snapshot: true,
    preparation: {
      flask: 'present',
      food: 'present',
      basis: 'Verified pull-start buff ID and name. Unmatched preparation remains unverified.',
    },
    activeAtPull: [
      { id: 1235111, name: 'Flask of the Shattered Sun', category: 'flask' },
      { id: 1294727, name: 'Well Fed', category: 'food' },
      { id: 1236994, name: 'Potion of Recklessness', category: 'combat-potion' },
    ],
    consumables: [],
    enchantsObserved: [{ slot: 1, itemId: 123, enchantId: 456 }],
    gemsObserved: [
      { slot: 1, itemId: 123, gemId: 789 },
      { slot: 2, itemId: 124, gemId: 790 },
      { slot: 2, itemId: 124, gemId: 790 },
    ],
    lifeEvents: [],
    casts: 0,
  });
  assert.deepEqual(
    recorder.facts.get(2),
    emptyFacts(),
    'Missing snapshot is not missing preparation',
  );
});

test('invalid snapshots and ambiguous ability names never establish preparation', () => {
  const recorder = factRecorder(
    fight,
    [1, 2],
    new Map([
      [1235111, 'Different spell'],
      [1294727, 'Different food'],
    ]),
  );
  recorder.observe([
    { type: 'combatantinfo', timestamp: 10000, sourceID: 1 },
    { type: 'combatantinfo', timestamp: 14000, sourceID: 1, auras: [{ ability: 1235111 }] },
    {
      type: 'combatantinfo',
      timestamp: 10000,
      sourceID: 2,
      auras: [{ ability: 1235111 }, { ability: 1294727 }],
    },
  ]);
  assert.equal(recorder.facts.get(1)?.snapshot, false);
  assert.deepEqual(recorder.facts.get(2)?.activeAtPull, []);
  assert.equal(recorder.facts.get(2)?.snapshot, true);
  assert.equal(recorder.facts.get(2)?.preparation?.flask, 'unknown');
  assert.equal(recorder.facts.get(2)?.preparation?.food, 'unknown');
  assert.equal(
    recorder.facts.get(2)?.gemsObserved,
    undefined,
    'Absent gear cannot establish gem availability',
  );
  assert.equal(
    recorder.facts.get(2)?.enchantsObserved,
    undefined,
    'Absent gear is not an empty enchant inventory',
  );
});

test('missing, empty and unmatched starting auras never fabricate a preparation failure', () => {
  const recorder = factRecorder(fight, [1, 2, 3, 4], abilities);
  recorder.observe([
    { type: 'combatantinfo', timestamp: 10000, sourceID: 1, auras: [] },
    { type: 'combatantinfo', timestamp: 10000, sourceID: 2, auras: [{ ability: 999999 }] },
    {
      type: 'combatantinfo',
      timestamp: 10000,
      sourceID: 3,
      auras: [{ ability: 1235111 }, { ability: 999999 }],
    },
    { type: 'combatantinfo', timestamp: 10000, sourceID: 4, auras: null },
  ]);
  for (const id of [1, 2]) {
    assert.equal(recorder.facts.get(id)?.preparation?.flask, 'unknown');
    assert.equal(recorder.facts.get(id)?.preparation?.food, 'unknown');
  }
  assert.equal(recorder.facts.get(3)?.preparation?.flask, 'present');
  assert.equal(recorder.facts.get(3)?.preparation?.food, 'unknown');
  assert.equal(recorder.facts.get(4)?.snapshot, false);
  assert.equal(recorder.facts.get(4)?.preparation, undefined);
});

test('later item casts and duplicated combatant snapshots do not create pull-start preparation credit', () => {
  const recorder = factRecorder(fight, [1], abilities);
  recorder.observe([
    { type: 'combatantinfo', timestamp: 10000, sourceID: 1, auras: [] },
    { type: 'cast', timestamp: 11000, sourceID: 1, abilityGameID: 1235111 },
    {
      type: 'combatantinfo',
      timestamp: 11000,
      sourceID: 1,
      auras: [{ ability: 1235111 }, { ability: 1294727 }],
    },
  ]);
  assert.equal(recorder.facts.get(1)?.preparation?.flask, 'unknown');
  assert.equal(recorder.facts.get(1)?.preparation?.food, 'unknown');
  assert.deepEqual(recorder.facts.get(1)?.activeAtPull, []);
});

test('consumables count actual in-fight casts, deduplicate pages and exclude crafting recipes', () => {
  const recorder = factRecorder(fight, [1], abilities);
  const cast = (abilityGameID: number, timestamp: number) => ({
    type: 'cast',
    sourceID: 1,
    abilityGameID,
    timestamp,
  });
  const stone = cast(6262, 20000);
  recorder.observe([
    cast(1236994, 9999),
    stone,
    cast(1295247, 30000),
    cast(452930, 40000),
    cast(1230862, 50000),
    cast(1230863, 60000),
    { type: 'applybuff', sourceID: 1, abilityGameID: 1236994, timestamp: 70000 },
    cast(6262, 110001),
  ]);
  recorder.observe([stone, cast(6262, 80000), cast(1236994, 90000)]);
  assert.deepEqual(recorder.facts.get(1)?.consumables, [
    { id: 6262, name: 'Healthstone', kind: 'healthstone', uses: 2 },
    { id: 1295247, name: 'Concentrated Silvermoon Health Potion', kind: 'healing-potion', uses: 1 },
    { id: 452930, name: 'Demonic Healthstone', kind: 'healthstone', uses: 1 },
    { id: 1236994, name: 'Potion of Recklessness', kind: 'combat-potion', uses: 1 },
  ]);
  assert.equal(
    recorder.facts.get(1)?.casts,
    7,
    'All observed casts are context; recipes are not item uses',
  );
});

test('life observations distinguish actual death and accepted resurrection from feign, saves and casts', () => {
  assert.equal(recordedLifeEvent({ type: 'death', feign: true }), null);
  assert.equal(recordedLifeEvent({ type: 'death', isFeign: true }), null);
  assert.equal(recordedLifeEvent({ type: 'deathsave', abilityGameID: 31230 }), null);
  assert.equal(
    recordedLifeEvent({ type: 'death', deathSaveAbility: 31230, deathSaveTime: 1000 }),
    'death',
    'Prior death-save metadata does not invalidate an actual later death',
  );
  assert.equal(
    recordedLifeEvent({ type: 'cast', abilityGameID: 20484 }),
    null,
    'Casting Rebirth does not prove the recipient accepted it',
  );
  assert.equal(recordedLifeEvent({ type: 'resurrect', targetID: 1 }), 'resurrect');
});
