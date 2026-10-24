import type { Evidence, Fight, Metric, Player, PullData, Report } from './types.js';
import { aliveTime } from './life.js';

const roster: [string, string, string, Player['role']][] = [
  ['Veyra', 'DeathKnight', 'Blood', 'tank'],
  ['Draxen', 'Warrior', 'Protection', 'tank'],
  ['Aelith', 'Priest', 'Discipline', 'healer'],
  ['Sylara', 'Druid', 'Restoration', 'healer'],
  ['Elowen', 'Shaman', 'Restoration', 'healer'],
  ['Vaelis', 'Paladin', 'Holy', 'healer'],
  ['Noctis', 'Druid', 'Balance', 'dps'],
  ['Lyssara', 'Mage', 'Frost', 'dps'],
  ['Kaelen', 'Hunter', 'Marksmanship', 'dps'],
  ['Morrigan', 'Warlock', 'Affliction', 'dps'],
  ['Riven', 'Rogue', 'Outlaw', 'dps'],
  ['Ashen', 'DemonHunter', 'Havoc', 'dps'],
  ['Thalor', 'Shaman', 'Enhancement', 'dps'],
  ['Seraphis', 'Evoker', 'Devastation', 'dps'],
  ['Fenrik', 'Warrior', 'Arms', 'dps'],
  ['Sable', 'Priest', 'Shadow', 'dps'],
  ['Orion', 'Mage', 'Arcane', 'dps'],
  ['Vesper', 'Monk', 'Windwalker', 'dps'],
  ['Calyra', 'Paladin', 'Retribution', 'dps'],
  ['Zephyr', 'DeathKnight', 'Frost', 'dps'],
];
export function demoData(): { report: Report; pulls: PullData[] } {
  const players: Player[] = roster.map(([name, cls, spec, role], index) => ({
    id: index + 1,
    name,
    class: cls,
    spec,
    role,
  }));
  const bosses = [
    { id: 900101, name: 'The Hollow Sentinel' },
    { id: 3420, name: 'Sszorak · training simulation' },
    { id: 900102, name: 'Crimson Council' },
  ];
  const fights: Fight[] = [];
  const pulls: PullData[] = [];
  let time = 0;
  bosses.forEach((boss, bossIndex) => {
    [95000, 142000, 210000, 270000].forEach((duration, pullIndex) => {
      const fight: Fight = {
        id: fights.length + 1,
        encounterId: boss.id,
        name: boss.name,
        difficulty: 5,
        startTime: time,
        endTime: time + duration,
        kill: pullIndex === 3,
        percentage: null,
        friendlyPlayers: players.map((p) => p.id),
      };
      fights.push(fight);
      const metrics: Metric[] = players.map((player, index) => {
        const quality = 1 - index / 26;
        const opportunities = 5 + pullIndex;
        const failures = Math.min(
          opportunities,
          Math.max(
            0,
            Math.floor(index / 5) + (index % 4 === pullIndex ? 1 : 0) - (bossIndex === 1 ? 0 : 1),
          ),
        );
        const dies =
          (index > 8 && (index + pullIndex + bossIndex) % 4 === 0) || (index > 15 && !fight.kill);
        const deadMs = dies ? Math.round(duration * (0.06 + (index / 20) * 0.2)) : 0;
        const aliveMs = duration - deadMs;
        const dps =
          player.role === 'healer'
            ? 22000 + index * 500
            : player.role === 'tank'
              ? 88000 + index * 4000
              : 195000 + (index % 7) * 12000;
        const damage = Math.round((dps * aliveMs) / 1000),
          healing =
            player.role === 'healer'
              ? Math.round(((175000 + quality * 90000) * aliveMs) / 1000)
              : Math.round(damage * 0.04);
        const evidence: Evidence[] = [];
        for (let n = 0; n < failures; n++)
          evidence.push({
            fightId: fight.id,
            timestamp: fight.startTime + 20000 + n * 8000 + index * 100,
            abilityId: 990000 + bossIndex,
            ability: 'Training hazard',
            kind: 'mechanic',
            description:
              'Synthetic failed opportunity from the demo fixture. This is not a real Sszorak spell or a live boss rule.',
            confidence: 'observed',
            ruleId: 'demo-hazard/v1',
            url: null,
          });
        if (dies)
          evidence.push({
            fightId: fight.id,
            timestamp: fight.endTime - deadMs,
            ability: 'Recorded death',
            kind: 'death',
            description: 'Synthetic death event. The log alone does not establish fault.',
            confidence: 'observed',
            url: null,
          });
        const defensiveCount = Math.max(0, Math.round(duration / 90000) - (index > 14 ? 1 : 0));
        for (let n = 0; n < defensiveCount; n++)
          evidence.push({
            fightId: fight.id,
            timestamp: fight.startTime + 30000 + n * 60000,
            ability: 'Training defensive',
            kind: 'defensive',
            description:
              'Observed defensive cast in the synthetic fixture. Cast count alone is not graded.',
            confidence: 'observed',
            url: null,
          });
        return {
          actorId: player.id,
          damage,
          healing,
          damageTaken: Math.round(
            (player.role === 'tank' ? 18000000 : 7000000) *
              (duration / 270000) *
              (1 + failures * 0.12),
          ),
          aliveMs,
          deaths: dies ? 1 : 0,
          interrupts: player.role === 'dps' ? (index + pullIndex) % 4 : 0,
          dispels: player.role === 'healer' ? 2 + pullIndex : 0,
          defensives: defensiveCount,
          defensiveSpells: [{ id: 990100, name: 'Training defensive', count: defensiveCount }],
          mechanicFailures: failures,
          mechanicOpportunities: opportunities,
          mechanics: [
            {
              ruleId: 'demo-hazard/v1',
              name: 'Synthetic training hazard',
              kind: 'avoid',
              weight: 1,
              scoreEligible: true,
              opportunities,
              failures,
              unknown: 0,
              observed: failures,
              detail:
                'Labelled synthetic opportunity data; this is not a real boss spell or live rule.',
              source: 'https://www.warcraftlogs.com/help/pins',
              abilityIds: [990000 + bossIndex],
              events: evidence
                .filter((e) => e.kind === 'mechanic')
                .map((e) => ({
                  timestamp: e.timestamp,
                  outcome: 'failed' as const,
                  detail: e.description,
                  url: null,
                })),
            },
          ],
          facts: {
            snapshot: false,
            activeAtPull: [],
            consumables: [],
            casts: 20,
            lifeEvents: dies ? [{ timestamp: fight.endTime - deadMs, type: 'death' as const }] : [],
          },
          utilitySuccesses: Math.max(
            0,
            3 - (index > 15 ? 1 : 0) - (index % 6 === pullIndex ? 1 : 0),
          ),
          utilityOpportunities: 3,
          outputPercentile: fight.kill ? Math.max(10, 98 - index * 2 + (bossIndex % 2) * 3) : null,
          evidence,
        };
      });
      pulls.push({
        fight,
        metrics,
        complete: true,
        warnings: [],
        mechanicRule: 'demo-hazard/v1 · synthetic assigned opportunities only',
        wipeTailMs: null,
      });
      time = fight.endTime + 45000;
    });
  });
  const wipeCalls: Record<number, number> = {};
  for (const pull of pulls) {
    const endTime = pull.fight.endTime - (pull.fight.kill ? 0 : 1);
    if (!pull.fight.kill) wipeCalls[pull.fight.id] = endTime;
    pull.window = { endTime, source: pull.fight.kill ? 'kill' : 'logged', confirmed: true };
    for (const metric of pull.metrics)
      metric.aliveMs = aliveTime({ ...pull.fight, endTime }, metric.facts?.lifeEvents ?? []);
  }
  return {
    report: {
      wipeCalls,
      code: 'DEMONOTAREALLOG1',
      title: 'The midnight rehearsal',
      startTime: Date.UTC(2026, 9, 22, 18, 30),
      endTime: Date.UTC(2026, 9, 22, 18, 30) + time,
      revision: 1,
      visibility: 'demo',
      source: 'demo',
      players,
      fights,
      zone: 'Synthetic raid session',
      warnings: [
        'DEMO: All players, events, scores and mechanic opportunities in this session are synthetic. This is not report 6fjJxRFC21YHdTXB, and no real player has been evaluated.',
      ],
    },
    pulls,
  };
}
