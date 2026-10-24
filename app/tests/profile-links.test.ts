import test from 'node:test';
import assert from 'node:assert/strict';
import { characterLinks } from '../shared/profile-links.js';
import { fixture } from './execution-fixtures.js';
test('profile buttons use exact verified realm and encode every path segment', () => {
  const { report } = fixture(),
    player = {
      ...report.players[0],
      name: 'Éowyn',
      profile: { region: 'eu', realm: 'argent-dawn' },
    };
  const links = characterLinks(player, report);
  assert.equal(links.raiderIO, 'https://raider.io/characters/eu/argent-dawn/%C3%89owyn');
  assert.equal(
    links.armory,
    'https://worldofwarcraft.blizzard.com/en-gb/character/eu/argent-dawn/%C3%89owyn',
  );
  assert.equal(
    links.warcraftLogs,
    'https://www.warcraftlogs.com/character/eu/argent-dawn/%C3%89owyn',
  );
  assert.ok(
    characterLinks({ ...player, name: 'A/B?x#' }, report).raiderIO!.endsWith('A%2FB%3Fx%23'),
  );
});
test('missing identity never creates fake external character pages and synthetic demo has none', () => {
  const { report } = fixture(),
    player = report.players[0];
  const links = characterLinks(player, report);
  assert.equal(links.raiderIO, null);
  assert.equal(links.armory, null);
  assert.ok(links.warcraftLogs!.includes('/reports/'));
  assert.deepEqual(characterLinks(player, { ...report, source: 'demo' }), {
    warcraftLogs: null,
    raiderIO: null,
    armory: null,
  });
});
