import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLife, type LifeEvent } from '../shared/life.js';

const fight = { startTime: 10000, endTime: 310000 };
const death = (timestamp: number): LifeEvent => ({ type: 'death', timestamp });
const resurrect = (timestamp: number): LifeEvent => ({ type: 'resurrect', timestamp });

test('full-pull life facts retain the first death that precedes a rapid raid collapse', () => {
  const result = summarizeLife(fight, [death(210000)]);
  assert.deepEqual(
    [result.complete, result.deaths, result.aliveMs, result.deadMs],
    [true, 1, 200000, 100000],
  );
  assert.deepEqual(result.intervals, [{ start: 210000, end: 310000 }]);
});

test('no recorded deaths produces full recorded availability', () => {
  const result = summarizeLife(fight, []);
  assert.deepEqual(result, {
    aliveMs: 300000,
    deadMs: 0,
    deaths: 0,
    resurrections: 0,
    intervals: [],
    events: [],
    issues: [],
    complete: true,
  });
});

test('resurrection restores availability without erasing earlier deaths', () => {
  const result = summarizeLife(fight, [death(30000), resurrect(60000), death(250000)]);
  assert.deepEqual(
    [result.complete, result.deaths, result.resurrections, result.deadMs, result.aliveMs],
    [true, 2, 1, 90000, 210000],
  );
  assert.deepEqual(result.intervals, [
    { start: 30000, end: 60000 },
    { start: 250000, end: 310000 },
  ]);
});

test('death at encounter end is counted with zero remaining dead time', () => {
  const result = summarizeLife(fight, [death(fight.endTime)]);
  assert.deepEqual([result.complete, result.deaths, result.deadMs], [true, 1, 0]);
  assert.deepEqual(result.intervals, [{ start: fight.endTime, end: fight.endTime }]);
  assert.equal(summarizeLife(fight, [death(fight.startTime)]).deadMs, 300000);
});

test('out-of-window events are ignored rather than clamped into the encounter', () => {
  const result = summarizeLife(fight, [death(fight.startTime - 1), resurrect(fight.endTime + 1)]);
  assert.deepEqual(
    [result.complete, result.deaths, result.deadMs, result.events.length],
    [true, 0, 0, 0],
  );
});

test('Feign Death aliases are excluded but real death-save metadata does not remove death', () => {
  const realDeath = { ...death(30000), deathSaveTime: 20000, deathSaveAbility: 31230 };
  const result = summarizeLife(fight, [
    { ...death(15000), feign: true },
    { ...death(25000), isFeign: true },
    realDeath,
  ]);
  assert.deepEqual([result.complete, result.deaths, result.deadMs], [true, 1, 280000]);
});

test('page overlap duplicates do not double-count deaths or resurrections', () => {
  const result = summarizeLife(fight, [
    death(30000),
    resurrect(60000),
    death(30000),
    resurrect(60000),
    death(250000),
  ]);
  assert.deepEqual(
    [result.complete, result.deaths, result.resurrections, result.deadMs],
    [true, 2, 1, 90000],
  );
});

test('an initial resurrection cannot invent death since pull start', () => {
  const result = summarizeLife(fight, [resurrect(60000)]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, ['resurrection-without-recorded-death']);
  assert.equal(result.deadMs, 0);
  assert.deepEqual(result.intervals, []);
  assert.equal(result.resurrections, 1);
});

test('repeated state events at different times retain observations and flag missing transitions', () => {
  const result = summarizeLife(fight, [
    death(30000),
    death(35000),
    resurrect(60000),
    resurrect(65000),
  ]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, [
    'death-without-recorded-resurrection',
    'resurrection-without-recorded-death',
  ]);
  assert.equal(result.events.length, 4);
  assert.equal(result.deadMs, 30000);
});

test('same-time conflicting transitions are deterministic and explicitly ambiguous', () => {
  const variants = [
    [death(30000), resurrect(30000)],
    [resurrect(30000), death(30000)],
  ];
  const result = summarizeLife(fight, variants[0]);
  assert.deepEqual(summarizeLife(fight, variants[1]), result);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, ['simultaneous-life-transitions']);
});

test('malformed timestamps/types are explicit integrity issues, never silently perfect data', () => {
  const result = summarizeLife(fight, [
    death(NaN),
    death(Infinity),
    { type: 'death', timestamp: '30000' } as unknown as LifeEvent,
    { type: 'cast', timestamp: 30000 },
    null as unknown as LifeEvent,
  ]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, ['invalid-life-event-type', 'invalid-life-timestamp']);
  assert.equal(result.events.length, 0);
  assert.throws(() => summarizeLife({ startTime: 0, endTime: 0 }, []), RangeError);
  assert.throws(() => summarizeLife({ startTime: NaN, endTime: 10 }, []), RangeError);
});

test('summaries do not mutate caller events or arrays', () => {
  const input = Object.freeze([Object.freeze(resurrect(60000)), Object.freeze(death(30000))]);
  assert.equal(summarizeLife(fight, input).complete, true);
  assert.equal(input[0].type, 'resurrect');
});

test('life accounting satisfies conservation, permutation and monotonicity on varied intervals', () => {
  // Independent grid oracle: count dead milliseconds instead of repeating interval arithmetic.
  for (let first = 0; first <= 100; first += 5) {
    for (let recovery = first + 1; recovery <= 100; recovery += 7) {
      const scope = { startTime: 0, endTime: 100 };
      const input = [death(first), resurrect(recovery)];
      const result = summarizeLife(scope, input);
      let expectedDead = 0;
      for (let time = 0; time < 100; time++) if (time >= first && time < recovery) expectedDead++;
      assert.equal(result.complete, true);
      assert.equal(result.deadMs, expectedDead);
      assert.equal(result.aliveMs + result.deadMs, 100);
      assert.ok(result.aliveMs >= 0 && result.deadMs >= 0);
      assert.deepEqual(summarizeLife(scope, [...input].reverse()), result);
      assert.deepEqual(summarizeLife(scope, [...input, ...input]), result);
      const unrecovered = summarizeLife(scope, [death(first)]);
      assert.ok(result.deadMs <= unrecovered.deadMs);
      assert.equal(result.deaths, unrecovered.deaths);
      if (first > 0)
        assert.ok(
          summarizeLife(scope, [death(first - 1), resurrect(recovery)]).deadMs >= result.deadMs,
        );
    }
  }
});

test('multi-death timelines match an independent per-millisecond state oracle', () => {
  let seed = 0x65a19b;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let sample = 0; sample < 500; sample++) {
    const scope = { startTime: 1000, endTime: 1200 };
    const input: LifeEvent[] = [];
    let recordedAlive = true;
    let expectedDead = 0;
    let expectedDeaths = 0;
    let expectedResurrections = 0;
    for (let at = scope.startTime; at <= scope.endTime; at++) {
      if (random() < 0.07) {
        input.push(recordedAlive ? death(at) : resurrect(at));
        if (recordedAlive) expectedDeaths++;
        else expectedResurrections++;
        recordedAlive = !recordedAlive;
      }
      if (at < scope.endTime && !recordedAlive) expectedDead++;
    }
    const result = summarizeLife(scope, input);
    assert.equal(result.complete, true);
    assert.equal(result.deadMs, expectedDead);
    assert.equal(result.aliveMs, 200 - expectedDead);
    assert.equal(result.deaths, expectedDeaths);
    assert.equal(result.resurrections, expectedResurrections);
    assert.equal(result.intervals.length, expectedDeaths);
    for (let index = input.length - 1; index > 0; index--) {
      const target = Math.floor(random() * (index + 1));
      [input[index], input[target]] = [input[target], input[index]];
    }
    assert.deepEqual(summarizeLife(scope, input), result);
    assert.deepEqual(summarizeLife(scope, [...input, ...input]), result);
  }
});

test('living-cast evidence inside one dead interval reveals missing resurrection without inventing a time', () => {
  const result = summarizeLife(fight, [death(30000)], [60000]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, ['positive-health-cast-without-recorded-resurrection']);
  assert.equal(result.resurrections, 0);
  assert.deepEqual(result.intervals, [{ start: 30000, end: fight.endTime }]);
});

test('living snapshots at death/resurrection boundaries do not assume an event tie order', () => {
  const result = summarizeLife(
    fight,
    [death(30000), resurrect(60000)],
    [15000, 30000, 60000, 70000, NaN, Infinity],
  );
  assert.equal(result.complete, true);
  assert.equal(result.deadMs, 30000);
});

test('a later valid resurrection does not conceal an earlier positive-health contradiction', () => {
  const result = summarizeLife(fight, [death(30000), resurrect(80000)], [60000, 90000]);
  assert.equal(result.complete, false);
  assert.equal(result.resurrections, 1);
  assert.ok(result.issues.includes('positive-health-cast-without-recorded-resurrection'));
});
