import type {
  Fight,
  MechanicResult,
  Metric,
  PullData,
  Report,
  Role,
  Selection,
} from '../shared/types.js';

export const selection: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};

export function check(
  opportunities = 10,
  failures = 0,
  overrides: Partial<MechanicResult> = {},
): MechanicResult {
  return {
    ruleId: 'synthetic-common-check/v1',
    name: 'Synthetic common hazard',
    kind: 'avoid',
    weight: 1,
    opportunities,
    failures,
    unknown: 0,
    observed: opportunities,
    scoreEligible: true,
    requiredForScore: true,
    detail: 'Synthetic, complete denominator; not a live boss claim.',
    source: 'https://www.warcraftlogs.com/help/pins',
    abilityIds: [990000],
    events: [],
    ...overrides,
  };
}

export function fixture(
  options: { boss?: number; difficulty?: number; duration?: number; roles?: Role[] } = {},
) {
  const duration = options.duration ?? 300000;
  const roles = options.roles ?? ['tank', 'healer', 'dps', 'dps'];
  const players = roles.map((role, index) => ({
    id: index + 1,
    name: `Synthetic ${index + 1}`,
    role,
    class: role === 'tank' ? 'DeathKnight' : role === 'healer' ? 'Priest' : 'Hunter',
    spec:
      role === 'tank'
        ? 'Blood'
        : role === 'healer'
          ? 'Holy'
          : role === 'dps'
            ? 'BeastMastery'
            : 'Unknown',
  }));
  const fight: Fight = {
    id: 1,
    encounterId: options.boss ?? 3420,
    name: 'Synthetic encounter',
    difficulty: options.difficulty ?? 5,
    startTime: 10000,
    endTime: 10000 + duration,
    kill: true,
    percentage: 0,
    friendlyPlayers: players.map((p) => p.id),
    playerSpecs: Object.fromEntries(players.map((p) => [p.id, p.spec])),
  };
  const metrics: Metric[] = players.map((p) => ({
    actorId: p.id,
    damage: duration * (p.role === 'healer' ? 10 : 100),
    healing: duration * (p.role === 'healer' ? 100 : 2),
    damageTaken: duration * (p.role === 'tank' ? 200 : 10),
    aliveMs: duration,
    deaths: 0,
    interrupts: 1,
    dispels: 1,
    defensives: 1,
    defensiveSpells: [],
    mechanicFailures: 0,
    mechanicOpportunities: 10,
    utilitySuccesses: null,
    utilityOpportunities: null,
    outputPercentile: null,
    mechanics: [check()],
    evidence: [],
    facts: { snapshot: false, activeAtPull: [], consumables: [], lifeEvents: [], casts: 30 },
  }));
  const report: Report = {
    code: '6fjJxRFC21YHdTXB',
    title: 'SYNTHETIC execution regression fixture',
    startTime: 0,
    endTime: fight.endTime,
    revision: 1,
    visibility: 'public',
    source: 'warcraftlogs',
    players,
    fights: [fight],
    zone: 'Synthetic raid',
    warnings: ['Synthetic test data, not a live class/boss validation.'],
  };
  const pull: PullData = {
    fight,
    metrics,
    complete: true,
    warnings: [],
    mechanicRule: 'synthetic-common-check/v1',
    mechanicScope: 'complete',
    wipeTailMs: null,
  };
  return { report, pull, fight, metrics };
}
