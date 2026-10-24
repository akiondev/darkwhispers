import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeExecution } from '../shared/execution.js';
import { summarizeLife } from '../shared/life.js';
import {
  attendanceLabel,
  lifeComplete,
  pullAttendance,
  samePullSelection,
} from '../web/attendance.js';
import CompactPlayerDetails from '../web/CompactPlayerDetails.js';
import { fixture, selection } from './execution-fixtures.js';

function partialFixture() {
  const f = fixture({ duration: 100000, roles: ['dps', 'dps'] });
  const second = structuredClone(f.pull);
  second.fight.id = 2;
  second.fight.startTime += 200000;
  second.fight.endTime += 200000;
  const events = [
    { timestamp: second.fight.startTime + 10000, type: 'death' as const },
    { timestamp: second.fight.startTime + 80000, type: 'death' as const },
  ];
  const life = summarizeLife(second.fight, events, [second.fight.startTime + 30000]);
  Object.assign(second.metrics[0], { life, aliveMs: life.aliveMs, deaths: life.deaths });
  second.metrics[0].facts!.lifeEvents = events;
  const report = { ...f.report, fights: [f.fight, second.fight], endTime: second.fight.endTime };
  const analysis = analyzeExecution(report, [f.pull, second], selection);
  return { analysis, player: analysis.players.find((p) => p.id === 1)! };
}

test('comparison submits only exact verified IDs, not all attended pulls or a count', () => {
  const { analysis, player } = partialFixture();
  const target = samePullSelection(player, analysis)!;
  assert.deepEqual(target.fightIds, [1]);
  assert.equal(target.excludeWipeTail, false);
  assert.equal(target.wipeStops, undefined);
  assert.deepEqual(
    analysis.pulls.map((p) => p.fight.id),
    [1, 2],
    'original selection remains intact',
  );
  const alternative = structuredClone(player);
  alternative.pullReviews[0].execution.score = null;
  alternative.pullReviews[1].execution.score = 90;
  assert.deepEqual(
    samePullSelection(alternative, analysis)!.fightIds,
    [2],
    'same count is a different comparison',
  );
});

test('coverage distinguishes excluded data from absence and role changes', () => {
  const { analysis, player } = partialFixture();
  const a = pullAttendance(player, analysis);
  assert.equal(a.scoredPulls, 1);
  assert.equal(a.selectedPulls, 2);
  assert.equal(a.attendedPulls, 2);
  assert.equal(a.excludedPulls, 1);
  assert.equal(a.absentPulls, 0);
  assert.equal(attendanceLabel(player, analysis), '1 excluded');
  const changed = { ...player, attendance: { ...a, otherRolePulls: 3, absentPulls: 1 } };
  assert.equal(attendanceLabel(changed, analysis), 'Role switch · 1 absent · 1 excluded');
});

test('missing resurrection keeps both death links but never renders guessed dead intervals', () => {
  const { analysis, player } = partialFixture();
  const html = renderToStaticMarkup(
    createElement(CompactPlayerDetails, {
      analysis,
      player,
      onPlayerChange() {},
      onCompare() {},
    }),
  );
  assert.match(html, /1\/2 selected pulls scored/);
  assert.match(html, /Compare same pulls/);
  assert.match(html, /2 recorded deaths/);
  assert.equal((html.match(/View death/g) ?? []).length, 2);
  assert.equal((html.match(/Dead duration unverified/g) ?? []).length, 2);
  assert.doesNotMatch(html, /1:30 dead|90\.000 seconds|Life timeline needs review/);
  assert.match(html, /1\/1|1\/2 verified|verified across 1\/2 pulls/);
  assert.match(html, /fight=2&amp;type=deaths&amp;source=1/);
});

test('a player without verified pulls cannot start a same-pull comparison', () => {
  const { analysis, player } = partialFixture();
  player.pullReviews.forEach((r) => {
    r.execution.score = null;
  });
  player.attendance!.scoredPulls = 0;
  assert.equal(samePullSelection(player, analysis), null);
  const html = renderToStaticMarkup(
    createElement(CompactPlayerDetails, {
      analysis,
      player,
      onPlayerChange() {},
      onCompare() {},
    }),
  );
  assert.match(html, /<button[^>]*disabled=""[^>]*>Compare same pulls<\/button>/);
});

test('life completeness uses the explicit backend flag even without a human issue message', () => {
  const { player } = partialFixture();
  const review = { ...player.pullReviews[0], lifeComplete: false, lifeIssues: [] };
  assert.equal(lifeComplete(review), false);
});
