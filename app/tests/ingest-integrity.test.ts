import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPull } from '../server/ingest.js';
import { ApiError, WclClient } from '../server/wcl.js';
import { fixture } from './execution-fixtures.js';

type Event = Record<string, unknown>;
const death = (at: number): Event => ({ type: 'death', timestamp: at, targetID: 1 });
const cast = (at: number, abilityGameID = 21169): Event => ({
  type: 'cast',
  timestamp: at,
  sourceID: 1,
  targetID: 1,
  abilityGameID,
});

async function ingest(events: Event[], abilities = new Map([[21169, 'Reincarnation']])) {
  const { report, fight } = fixture({ boss: 990001, roles: ['dps'], duration: 100000 });
  fight.startTime = 0;
  fight.endTime = 100000;
  fight.kill = false;
  report.endTime = fight.endTime;
  report.players[0].class = 'Shaman';
  report.players[0].spec = 'Elemental';
  fight.playerSpecs = { 1: 'Elemental' };
  report.petOwners = { 99: 1 };
  class Client extends WclClient {
    override async tables() {
      return {
        damage: { entries: [{ id: 1, total: 1000 }] },
        healing: { entries: [] },
        taken: { entries: [] },
      };
    }
    override async events(...args: Parameters<WclClient['events']>) {
      assert.equal(args[1].startTime, 0);
      assert.equal(args[1].endTime, 100000);
      assert.equal(args[5]?.includeResources, true);
      // Deliberately split pages; normalizing self-res must not rely on page membership.
      const split = Math.floor(events.length / 2);
      args[3](events.slice(0, split));
      args[3](events.slice(split));
    }
  }
  const pull = await ingestPull(
    new Client('synthetic', 'synthetic'),
    report,
    fight,
    abilities,
    async () => {},
  );
  return pull.metrics[0];
}

test('verified Reincarnation cast restores the actual dead interval and preserves both deaths', async () => {
  const metric = await ingest([death(20000), cast(40000), death(80000)]);
  assert.equal(metric.deaths, 2);
  assert.equal(metric.aliveMs, 60000);
  assert.equal(metric.life!.deadMs, 40000);
  assert.equal(metric.life!.complete, true);
  assert.equal(metric.life!.resurrections, 1);
  assert.deepEqual(metric.life!.intervals, [
    { start: 20000, end: 40000 },
    { start: 80000, end: 100000 },
  ]);
  assert.deepEqual(metric.facts!.lifeEvents[1], {
    timestamp: 40000,
    type: 'resurrect',
    sourceId: 1,
    abilityId: 21169,
    abilityName: 'Reincarnation',
  });
});

test('native resurrection takes precedence over matching self-res cast and duplicate pages', async () => {
  for (const at of [40000, 45000]) {
    const native = {
      type: 'resurrect',
      timestamp: at,
      targetID: 1,
      sourceID: 1,
      abilityGameID: 21169,
    };
    const metric = await ingest([
      death(20000),
      cast(40000),
      cast(40000),
      native,
      { ...native },
      death(80000),
    ]);
    assert.equal(metric.life!.complete, true);
    assert.equal(metric.life!.resurrections, 1);
    assert.equal(metric.deaths, 2);
    assert.equal(metric.life!.deadMs, at);
    assert.equal(metric.facts!.lifeEvents[1].timestamp, at);
  }
});

test('unverified spell IDs/names and Rebirth casts never invent an accepted resurrection', async () => {
  const cases = [
    { ability: 21169, names: new Map<number, string>() },
    { ability: 21169, names: new Map([[21169, 'Unverified replacement']]) },
    { ability: 42, names: new Map([[42, 'Reincarnation']]) },
    { ability: 20484, names: new Map([[20484, 'Rebirth']]) },
    { ability: 20707, names: new Map([[20707, 'Soulstone']]) },
  ];
  for (const row of cases) {
    const metric = await ingest([death(20000), cast(40000, row.ability), death(80000)], row.names);
    assert.equal(metric.life!.complete, false);
    assert.equal(metric.life!.resurrections, 0);
    assert.equal(metric.life!.deadMs, 80000);
    assert.ok(metric.life!.issues.includes('death-without-recorded-resurrection'));
  }
});

test('positive source health during a cast detects a missing recovery after only one death', async () => {
  const metric = await ingest([
    death(20000),
    { ...cast(40000, 385899), resourceActor: 1, hitPoints: 500, maxHitPoints: 1000 },
  ]);
  assert.equal(metric.life!.complete, false);
  assert.deepEqual(metric.life!.issues, ['positive-health-cast-without-recorded-resurrection']);
  assert.equal(metric.life!.resurrections, 0, 'A living observation does not date resurrection');
  assert.equal(metric.deaths, 1);
});

test('absent health, target-owned resources and pet casts never prove the dead player alive', async () => {
  const cases: Event[] = [
    { ...cast(40000, 385899) },
    { ...cast(40000, 385899), hitPoints: 500, maxHitPoints: 1000 },
    { ...cast(40000, 385899), resourceActor: 2, hitPoints: 500, maxHitPoints: 1000 },
    { ...cast(40000, 385899), resourceActor: 99, hitPoints: 500, maxHitPoints: 1000 },
    { ...cast(40000, 385899), resourceActor: 1, hitPoints: 0, maxHitPoints: 1000 },
    { ...cast(40000, 385899), resourceActor: 1, hitPoints: 500, maxHitPoints: 0 },
    { ...cast(40000, 385899), resourceActor: 1, hitPoints: NaN, maxHitPoints: 1000 },
    { ...cast(40000, 385899), resourceActor: 1, hitPoints: '500', maxHitPoints: 1000 },
    { ...cast(40000, 385899), sourceID: 99, resourceActor: 1, hitPoints: 500, maxHitPoints: 1000 },
  ];
  for (const event of cases) {
    const metric = await ingest([death(20000), event]);
    assert.equal(metric.life!.complete, true);
    assert.deepEqual(metric.life!.issues, []);
    assert.equal(metric.life!.resurrections, 0);
    assert.equal(metric.life!.deadMs, 80000);
  }
});

test('positive source health at a verified self-res timestamp is consistent with that resurrection', async () => {
  const metric = await ingest([
    death(20000),
    { ...cast(40000), resourceActor: 1, hitPoints: 500, maxHitPoints: 1000 },
    { ...cast(50000, 385899), resourceActor: 1, hitPoints: 500, maxHitPoints: 1000 },
    death(80000),
  ]);
  assert.equal(metric.life!.complete, true);
  assert.equal(metric.life!.deadMs, 40000);
});

test('malformed life targets reject import instead of silently dropping a player death', async () => {
  for (const type of ['death', 'resurrect']) {
    for (const targetID of [undefined, null, '1', 1.5, NaN, Infinity, 0, -1]) {
      await assert.rejects(
        () => ingest([{ type, timestamp: 20000, targetID }]),
        (error: unknown) => error instanceof ApiError && error.code === 'WCL_INVALID_LIFE_TARGET',
      );
    }
  }
});

test('native resurrection with no source or ability is still a valid life transition', async () => {
  const metric = await ingest([
    death(20000),
    { type: 'resurrect', timestamp: 40000, targetID: 1 },
    death(80000),
  ]);
  assert.equal(metric.life!.complete, true);
  assert.equal(metric.life!.resurrections, 1);
  assert.equal(metric.life!.deadMs, 40000);
});

test('self-res cast from an owned pet never resurrects its owner', async () => {
  const metric = await ingest([death(20000), { ...cast(40000), sourceID: 99 }, death(80000)]);
  assert.equal(metric.life!.resurrections, 0);
  assert.equal(metric.life!.complete, false);
});

test('a continuation cursor equal to encounter end still fetches terminal death events', async () => {
  const { report, fight } = fixture({ boss: 990001, roles: ['dps'], duration: 100000 });
  const starts: number[] = [];
  const client = new WclClient('synthetic', 'synthetic', async (input, init) => {
    if (String(input).includes('/oauth/'))
      return new Response(JSON.stringify({ access_token: 'synthetic', expires_in: 3600 }));
    const body = JSON.parse(String(init?.body));
    starts.push(body.variables.start);
    return new Response(
      JSON.stringify({
        data: {
          reportData: {
            report: {
              events:
                starts.length === 1
                  ? { data: [], nextPageTimestamp: fight.endTime }
                  : { data: [death(fight.endTime)], nextPageTimestamp: null },
            },
          },
        },
      }),
    );
  });
  const received: Event[] = [];
  await client.events(report.code, fight, 'All', (events) => received.push(...events));
  assert.deepEqual(starts, [fight.startTime, fight.endTime]);
  assert.deepEqual(received, [death(fight.endTime)]);
});

test('ingestion preserves a real death at encounter end with zero remaining dead milliseconds', async () => {
  const metric = await ingest([death(100000)]);
  assert.equal(metric.deaths, 1);
  assert.equal(metric.life!.complete, true);
  assert.equal(metric.life!.deadMs, 0);
  assert.equal(metric.aliveMs, 100000);
  assert.equal(metric.evidence.filter((event) => event.kind === 'death').length, 1);
});
