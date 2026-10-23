import test from 'node:test';
import assert from 'node:assert/strict';
import { demoData } from '../shared/demo.js';
import { baseMetric, aliveTime } from '../server/ingest.js';
import { applyTempest, supportsTempest, type MechanicEvent } from '../server/mechanics.js';
import { evaluationWindow } from '../server/evaluation.js';
test('Tempest counts direct contacts once per eligible cast window, not DoT ticks or another source', () => {
  const { report } = demoData();
  report.source = 'warcraftlogs';
  report.code = '6fjJxRFC21YHdTXB';
  const fight = { ...report.fights[0], encounterId: 3420, startTime: 0, endTime: 95000 };
  const metrics = new Map([1, 2, 3].map((id) => [id, baseMetric(id, 95000)]));
  const life = new Map([
    [
      1,
      [
        { type: 'death', timestamp: 40000 },
        { type: 'resurrect', timestamp: 70000 },
      ],
    ],
    [2, [{ type: 'resurrect', timestamp: 80000 }]],
    [3, [{ type: 'death', timestamp: 10000 }]],
  ]);
  const events: MechanicEvent[] = [
    { type: 'begincast', timestamp: 15000, sourceID: 202, abilityGameID: 1287072 },
    { type: 'begincast', timestamp: 60000, sourceID: 202, abilityGameID: 1287072 },
    { type: 'damage', timestamp: 16000, sourceID: 202, targetID: 1, abilityGameID: 1287083 },
    { type: 'damage', timestamp: 18000, sourceID: 202, targetID: 1, abilityGameID: 1287083 },
    {
      type: 'damage',
      timestamp: 75000,
      sourceID: 202,
      targetID: 1,
      abilityGameID: 1287083,
      tick: true,
    },
    { type: 'damage', timestamp: 81000, sourceID: 203, targetID: 2, abilityGameID: 454015 },
  ];
  const result = applyTempest(report, fight, metrics, events, life);
  assert.ok(result.rule);
  assert.equal(metrics.get(1)!.mechanicFailures, 1);
  assert.equal(metrics.get(1)!.mechanicOpportunities, 2);
  assert.equal(metrics.get(1)!.evidence.length, 1);
  assert.equal(metrics.get(1)!.evidence[0].timestamp, 16000);
  assert.equal(metrics.get(2)!.mechanicOpportunities, 1);
  assert.equal(metrics.get(2)!.mechanicFailures, 0);
  assert.equal(metrics.get(3)!.mechanicOpportunities, 0);
  assert.equal(aliveTime(fight, life.get(2)!), 15000);
});
test('unmatched contacts are ungraded; no observed waves means zero opportunities rather than perfection', () => {
  const { report } = demoData(),
    fight = { ...report.fights[0], encounterId: 3420 };
  const metrics = new Map([[1, baseMetric(1, 95000)]]);
  const result = applyTempest(
    report,
    fight,
    metrics,
    [{ type: 'damage', timestamp: 1000, sourceID: 202, targetID: 1, abilityGameID: 1287083 }],
    new Map(),
  );
  assert.equal(result.rule, null);
  assert.equal(metrics.get(1)!.mechanicFailures, null);
  applyTempest(report, fight, metrics, [], new Map());
  assert.equal(metrics.get(1)!.mechanicOpportunities, 0);
  assert.equal(
    supportsTempest(
      fight,
      new Map([
        [1287072, 'Tempest'],
        [1287083, 'Tempest'],
      ]),
    ),
    true,
  );
  assert.equal(
    supportsTempest(
      { ...fight, difficulty: 4 },
      new Map([
        [1287072, 'Tempest'],
        [1287083, 'Tempest'],
      ]),
    ),
    true,
  );
  assert.equal(
    supportsTempest(
      fight,
      new Map([
        [1287072, 'Unexpected name'],
        [1287083, 'Tempest'],
      ]),
    ),
    false,
  );
});

test('expired Tempest windows do not grant free opportunities after a late resurrection', () => {
  const { report } = demoData(),
    fight = { ...report.fights[0], startTime: 0, endTime: 100000, encounterId: 3420 };
  const metrics = new Map([[1, baseMetric(1, 100000)]]);
  applyTempest(
    report,
    fight,
    metrics,
    [{ type: 'begincast', timestamp: 10000, sourceID: 202, abilityGameID: 1287072 }],
    new Map([[1, [{ type: 'resurrect', timestamp: 80000 }]]]),
  );
  assert.equal(metrics.get(1)!.mechanicOpportunities, 0);
});

test('collapse policy ignores Feign Death and temporary recovery, retains kills and unaudited bosses', () => {
  const fight = {
    ...demoData().report.fights[0],
    startTime: 0,
    endTime: 100000,
    encounterId: 3420,
    friendlyPlayers: Array.from({ length: 10 }, (_, i) => i + 1),
  };
  const life = new Map(
    Array.from({ length: 5 }, (_, i) => [
      i + 1,
      [{ type: 'death', timestamp: 60000, feign: i === 4 }],
    ]),
  );
  assert.equal(evaluationWindow(fight, life, null), undefined);
  life.get(5)![0].feign = false;
  assert.equal(evaluationWindow(fight, life, null)!.endTime, 60000);
  assert.equal(evaluationWindow(fight, life, 50000)!.reason, 'boss-enrage');
  life.get(5)!.push({ type: 'resurrect', timestamp: 70000, feign: false });
  assert.equal(evaluationWindow(fight, life, null), undefined);
  assert.equal(evaluationWindow({ ...fight, kill: true }, life, 50000), undefined);
  assert.equal(evaluationWindow({ ...fight, encounterId: 999 }, life, 50000), undefined);
});
