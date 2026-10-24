import type {
  Analysis,
  ExecutionAssessment,
  ExecutionBossScore,
  ExecutionMechanic,
  ExecutionPullReview,
  Fight,
  MechanicResult,
  Metric,
  Player,
  PlayerFacts,
  PullData,
  RankedPlayer,
  Report,
  Role,
  Selection,
} from './types.js';
import { selectFights } from './report-url.js';
import { roleFromSpec } from './players.js';
import { VERSION } from './version.js';
import { assessmentWindow } from './windows.js';

export const EXECUTION_MODEL_VERSION = 'execution/v3';
export const DEATH_PENALTY = 5;
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const percent = (value: number) => Math.max(0, Math.min(100, value));
const order: Record<Role, number> = { dps: 0, healer: 1, tank: 2, unknown: 3 };

/** Percentages, not probabilities. There are no neutral or inferred input values. */
export function scoreExecution(mechanicsScore: number, alivePercent: number, deaths = 0) {
  for (const value of [mechanicsScore, alivePercent])
    if (!Number.isFinite(value) || value < 0 || value > 100)
      throw new Error('Execution percentages must be finite and between 0 and 100.');
  if (!Number.isInteger(deaths) || deaths < 0) throw new Error('Invalid death count.');
  const baseScore = (mechanicsScore * alivePercent) / 100;
  return {
    score: Math.max(0, baseScore - DEATH_PENALTY * deaths),
    baseScore,
    deathPenalty: DEATH_PENALTY * deaths,
    capped: false,
  };
}
const roleFor = (player: Player, fight: Fight) =>
  roleFromSpec(fight.playerSpecs?.[player.id] ?? player.spec);
const blankFacts = (): PlayerFacts => ({
  snapshot: false,
  activeAtPull: [],
  consumables: [],
  lifeEvents: [],
  casts: 0,
});
const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const windowFor = (report: Report, pull: PullData, selection: Selection) =>
  assessmentWindow(
    report,
    pull.fight,
    selection,
    pull.boundaryLife
      ? new Map(pull.boundaryLife.map((row) => [row.actorId, row.events]))
      : undefined,
  );
function validatePull(report: Report, pull: PullData, fight: Fight, selection: Selection) {
  const window = windowFor(report, pull, selection);
  const duration = window.endTime - fight.startTime;
  if (
    pull.window
      ? pull.window.endTime !== window.endTime ||
        pull.window.source !== window.source ||
        pull.window.confirmed !== window.confirmed
      : window.endTime !== fight.endTime
  )
    throw new Error('Cached facts do not match the requested assessment window.');
  if (
    !pull.complete ||
    pull.fight.encounterId !== fight.encounterId ||
    pull.fight.difficulty !== fight.difficulty ||
    pull.fight.startTime !== fight.startTime ||
    pull.fight.endTime !== fight.endTime
  )
    throw new Error('Pull measurements do not match the completed report selection.');
  if (
    new Set(fight.friendlyPlayers).size !== fight.friendlyPlayers.length ||
    new Set(pull.metrics.map((m) => m.actorId)).size !== pull.metrics.length
  )
    throw new Error('Duplicate participant measurements.');
  if (
    pull.metrics.length !== fight.friendlyPlayers.length ||
    fight.friendlyPlayers.some(
      (id) =>
        !pull.metrics.some((m) => m.actorId === id) || !report.players.some((p) => p.id === id),
    )
  )
    throw new Error('A participating player is missing measurements. No ranking was produced.');
  for (const m of pull.metrics) {
    if (
      ![m.damage, m.healing, m.damageTaken, m.aliveMs, m.deaths, m.interrupts, m.dispels].every(
        finiteNonnegative,
      ) ||
      m.aliveMs > duration + 1e-6 ||
      !Number.isInteger(m.deaths)
    )
      throw new Error('Invalid player measurements.');
    const ids = new Set<string>();
    for (const r of m.mechanics ?? []) {
      if (ids.has(r.ruleId)) throw new Error('Duplicate mechanic measurements.');
      ids.add(r.ruleId);
      if (
        ![r.opportunities, r.failures, r.unknown, r.observed, r.missedWhileDead ?? 0].every(
          (v) => Number.isInteger(v) && v >= 0,
        ) ||
        r.failures + (r.missedWhileDead ?? 0) > r.opportunities
      )
        throw new Error('Invalid mechanic measurements.');
    }
  }
}

/** A check enters a role's comparison only when every living peer has a complete denominator. */
function comparableRules(report: Report, pull: PullData, role: Role) {
  const peers = pull.metrics.filter(
    (m) => roleFor(report.players.find((p) => p.id === m.actorId)!, pull.fight) === role,
  );
  const candidateIds = new Set(
    peers.flatMap((m) =>
      (m.mechanics ?? [])
        .filter(
          (r) =>
            r.kind === 'avoid' &&
            r.requiredForScore !== false &&
            r.weight > 0 &&
            (r.scoreEligible === true || r.opportunities > 0 || r.unknown > 0),
        )
        .map((r) => r.ruleId),
    ),
  );
  const accepted = new Set<string>();
  for (const id of candidateIds) {
    const rows = peers.map((m) => m.mechanics?.find((r) => r.ruleId === id));
    if (
      rows.length &&
      rows.every(
        (r): r is MechanicResult =>
          !!r && r.scoreEligible === true && r.unknown === 0 && r.weight > 0,
      ) &&
      rows.every((r) => r.opportunities > 0)
    )
      accepted.add(id);
    else if (rows.some((r) => r && (r.opportunities > 0 || r.unknown > 0)))
      return { accepted: new Set<string>(), complete: false };
  }
  return { accepted, complete: true };
}
function reviewMechanics(metric: Metric, accepted: Set<string>): ExecutionMechanic[] {
  return (metric.mechanics ?? []).map((r) => {
    const scored = accepted.has(r.ruleId);
    return {
      ruleId: r.ruleId,
      name: r.name,
      kind: r.kind,
      scored,
      exclusion: scored
        ? undefined
        : (r.excludedReason ?? 'Observation only; no complete common-role exposure denominator.'),
      passed: scored ? r.opportunities - r.failures - (r.missedWhileDead ?? 0) : 0,
      failed: scored ? r.failures : 0,
      missedWhileDead: scored ? (r.missedWhileDead ?? 0) : 0,
      opportunities: scored ? r.opportunities : 0,
      observed: r.observed,
      detail: r.detail,
      source: r.source,
      breakdown: r.breakdown,
      events: r.events.map((e) =>
        !scored && ['passed', 'failed', 'missed-dead'].includes(e.outcome)
          ? { ...e, outcome: 'observed' as const }
          : e,
      ),
    };
  });
}
function pullAssessment(
  role: Role,
  metric: Metric,
  mechanics: ExecutionMechanic[],
  duration: number,
  source: import('./types.js').AssessmentWindow['source'],
  integrity: boolean,
): ExecutionAssessment {
  const checkedMechanics = sum(mechanics.map((r) => r.opportunities)),
    failedChecks = sum(mechanics.map((r) => r.failed));
  const alivePercent = percent((100 * metric.aliveMs) / duration);
  const facts = metric.facts;
  const contribution =
    metric.damage > 0 ||
    metric.healing > 0 ||
    metric.interrupts > 0 ||
    metric.dispels > 0 ||
    (facts?.casts ?? 0) > 0;
  const families = mechanics.filter((m) => m.scored && m.opportunities > 0);
  const mechanicsScore =
    families.length && integrity
      ? mean(families.map((m) => (100 * m.passed) / m.opportunities))
      : null;
  const missedWhileDead = sum(mechanics.map((m) => m.missedWhileDead ?? 0));
  const chargedDeaths = source === 'kill' || source === 'logged' ? metric.deaths : 0;
  const grade =
    mechanicsScore === null
      ? {
          score: Math.max(0, alivePercent - DEATH_PENALTY * chargedDeaths),
          baseScore: alivePercent,
          deathPenalty: DEATH_PENALTY * chargedDeaths,
          capped: false,
        }
      : scoreExecution(mechanicsScore, alivePercent, chargedDeaths);
  if (!contribution) grade.score = 0;
  const scoreBasis = !contribution
    ? ('no-contribution' as const)
    : mechanicsScore === null
      ? ('survival-only' as const)
      : ('mechanics-and-survival' as const);
  return {
    version: EXECUTION_MODEL_VERSION,
    ...grade,
    mechanicsScore,
    alivePercent,
    deathPenalty: chargedDeaths * DEATH_PENALTY,
    scoreBasis,
    survivalOnlyPulls: scoreBasis === 'survival-only' ? 1 : 0,
    deaths: metric.deaths,
    missedWhileDead,
    weightMs: duration,
    passedChecks: checkedMechanics - failedChecks - missedWhileDead,
    failedChecks,
    checkedMechanics,
    scoredPulls: 1,
    totalPulls: 1,
    reasons: [
      !contribution
        ? 'No recorded combat contribution: no execution credit.'
        : mechanicsScore === null
          ? 'Survival-only score: no complete shared mechanic measurement; no mechanic points were assumed.'
          : `${failedChecks} failed${missedWhileDead ? ` · ${missedWhileDead} not credited while dead` : ''} · ${checkedMechanics} checks.`,
      source === 'automatic'
        ? 'Automatic wipe assessment; no extra fixed death deduction without a recorded call.'
        : `${metric.deaths} deaths: −${chargedDeaths * DEATH_PENALTY} points; deduction remains after resurrection.`,
    ],
  };
}
/** Equal child weighting. Unscored exposure never supplies points; its known absence still limits availability. */
export function combineExecutions(
  values: ExecutionAssessment[],
  mode: 'duration' | 'equal' = 'duration',
): ExecutionAssessment {
  if (!values.length) throw new Error('No execution measurements to combine.');
  const scored = values.filter((v) => v.score !== null);
  const measured = scored.filter((v) => v.mechanicsScore !== null);
  const bases = new Set(scored.map((v) => v.scoreBasis ?? 'mechanics-and-survival'));
  const weighted = (items: ExecutionAssessment[], get: (v: ExecutionAssessment) => number) =>
    sum(items.map((v) => get(v) * (mode === 'equal' ? 1 : (v.weightMs ?? 1)))) /
    sum(items.map((v) => (mode === 'equal' ? 1 : (v.weightMs ?? 1))));
  const alivePercent = weighted(scored.length ? scored : values, (v) => v.alivePercent);
  const score = scored.length ? weighted(scored, (v) => v.score!) : null;
  const checkedMechanics = sum(values.map((v) => v.checkedMechanics)),
    failedChecks = sum(values.map((v) => v.failedChecks));
  const scoredPulls = sum(values.map((v) => v.scoredPulls)),
    totalPulls = sum(values.map((v) => v.totalPulls));
  const missedWhileDead = sum(values.map((v) => v.missedWhileDead ?? 0));
  return {
    version: EXECUTION_MODEL_VERSION,
    score,
    baseScore: scored.length ? weighted(scored, (v) => v.baseScore!) : null,
    mechanicsScore: measured.length ? weighted(measured, (v) => v.mechanicsScore!) : null,
    scoreBasis: bases.size === 1 ? [...bases][0] : 'mixed',
    survivalOnlyPulls: sum(values.map((v) => v.survivalOnlyPulls ?? 0)),
    alivePercent,
    capped: false,
    deathPenalty: scored.length ? weighted(scored, (v) => v.deathPenalty ?? 0) : 0,
    deaths: sum(values.map((v) => v.deaths ?? 0)),
    missedWhileDead,
    weightMs: sum(values.map((v) => v.weightMs ?? 1)),
    passedChecks: checkedMechanics - failedChecks - missedWhileDead,
    failedChecks,
    checkedMechanics,
    scoredPulls,
    totalPulls,
    reasons:
      score === null
        ? [
            checkedMechanics
              ? 'No execution grade is available from these attended pulls.'
              : 'No comparable mechanic checks were recorded in these attended pulls.',
            `0 of ${totalPulls} attended pulls scored.`,
          ]
        : [
            `${failedChecks} failed · ${missedWhileDead} not credited while dead · ${checkedMechanics} checks.`,
            `${scoredPulls} of ${totalPulls} attended pulls scored automatically${values.some((v) => (v.survivalOnlyPulls ?? 0) > 0) ? '; includes labelled survival-only pulls' : ''}.`,
          ],
  };
}

export function analyzeExecution(
  report: Report,
  allPulls: PullData[],
  selection: Selection,
): Analysis {
  const chosen = selectFights(report, selection);
  if (new Set(report.players.map((p) => p.id)).size !== report.players.length)
    throw new Error('Duplicate actor metadata.');
  if (!chosen.length) throw new Error('No completed boss pulls match this selection.');
  const selectedIds = new Set(chosen.map((f) => f.id));
  const pulls = allPulls.filter((p) => selectedIds.has(p.fight.id));
  if (
    pulls.length !== chosen.length ||
    new Set(pulls.map((p) => p.fight.id)).size !== chosen.length
  )
    throw new Error('Missing or duplicate selected pulls. No ranking was produced.');
  const byFight = new Map(pulls.map((p) => [p.fight.id, p]));
  for (const fight of chosen) validatePull(report, byFight.get(fight.id)!, fight, selection);
  const rolesByFight = new Map<number, Map<Role, ReturnType<typeof comparableRules>>>();
  for (const pull of pulls) {
    const roles = new Set(
      pull.fight.friendlyPlayers.map((id) =>
        roleFor(report.players.find((p) => p.id === id)!, pull.fight),
      ),
    );
    rolesByFight.set(
      pull.fight.id,
      new Map([...roles].map((role) => [role, comparableRules(report, pull, role)])),
    );
  }
  const players: RankedPlayer[] = [];
  for (const player of report.players) {
    const own = pulls.filter((p) => p.fight.friendlyPlayers.includes(player.id));
    for (const role of new Set(own.map((p) => roleFor(player, p.fight)))) {
      const rolePulls = own.filter((p) => roleFor(player, p.fight) === role);
      const metrics = rolePulls.map((p) => p.metrics.find((m) => m.actorId === player.id)!);
      const pullReviews: ExecutionPullReview[] = rolePulls.map((p, index) => {
        const m = metrics[index],
          window = windowFor(report, p, selection),
          duration = window.endTime - p.fight.startTime;
        const common = rolesByFight.get(p.fight.id)!.get(role)!;
        const mechanics = reviewMechanics(
          m,
          window.confirmed && common.complete ? common.accepted : new Set(),
        );
        return {
          fightId: p.fight.id,
          window,
          role,
          execution: pullAssessment(role, m, mechanics, duration, window.source, common.complete),
          aliveMs: m.aliveMs,
          durationMs: duration,
          deaths: m.deaths,
          damage: m.damage,
          healing: m.healing,
          damageTaken: m.damageTaken,
          mechanics,
          facts: m.facts ?? blankFacts(),
        };
      });
      const perBoss: ExecutionBossScore[] = [];
      const bossGrades: ExecutionAssessment[] = [];
      for (const encounterId of new Set(rolePulls.map((p) => p.fight.encounterId))) {
        const boss = rolePulls.filter((p) => p.fight.encounterId === encounterId),
          difficulties = [...new Set(boss.map((p) => p.fight.difficulty))];
        const grades = difficulties.map((difficulty) => {
          const selected = boss.filter((p) => p.fight.difficulty === difficulty),
            ids = new Set(selected.map((p) => p.fight.id));
          const execution = combineExecutions(
            pullReviews.filter((r) => ids.has(r.fightId)).map((r) => r.execution),
          );
          perBoss.push({
            encounterId,
            name: boss[0].fight.name,
            difficulty,
            score: execution.score,
            pulls: selected.length,
            execution,
          });
          return execution;
        });
        bossGrades.push(combineExecutions(grades, 'equal'));
      }
      const execution = combineExecutions(bossGrades, 'equal');
      const specs = [
        ...new Set(rolePulls.map((p) => p.fight.playerSpecs?.[player.id] ?? player.spec)),
      ];
      const expected = pulls.filter((p) => {
        const common = rolesByFight.get(p.fight.id)!.get(role);
        return !!common;
      });
      const rankingReason =
        execution.score === null
          ? 'No complete execution grade.'
          : expected.some(
                (p) =>
                  !pullReviews.some((r) => r.fightId === p.fight.id && r.execution.score !== null),
              )
            ? 'Partial attendance or evidence; this score is not ranked against the full role selection.'
            : undefined;
      const rawSum = (
        key:
          | 'damage'
          | 'healing'
          | 'damageTaken'
          | 'aliveMs'
          | 'deaths'
          | 'interrupts'
          | 'dispels'
          | 'defensives',
      ) => sum(metrics.map((m) => m[key]));
      const evidence = metrics
        .flatMap((m) => m.evidence)
        .filter(
          (e) =>
            e.kind !== 'mechanic' ||
            pullReviews.some(
              (r) =>
                r.fightId === e.fightId &&
                r.mechanics.some((m) => m.scored && m.ruleId === e.ruleId),
            ),
        );
      players.push({
        ...player,
        role,
        spec: specs.join(' / '),
        rowKey: `${player.id}:${role}`,
        rankingReason,
        rank: null,
        roleRank: null,
        rolePeers: 0,
        score: execution.score,
        provisional: false,
        execution,
        pulls: rolePulls.length,
        bosses: bossGrades.length,
        scoredPulls: execution.scoredPulls,
        durationMs: sum(pullReviews.map((r) => r.durationMs)),
        aliveMs: rawSum('aliveMs'),
        deaths: rawSum('deaths'),
        damage: rawSum('damage'),
        healing: rawSum('healing'),
        damageTaken: rawSum('damageTaken'),
        interrupts: rawSum('interrupts'),
        dispels: rawSum('dispels'),
        defensives: rawSum('defensives'),
        mechanicFailures: execution.failedChecks,
        mechanicOpportunities: execution.checkedMechanics,
        perBoss,
        pullReviews,
        evidence,
        notes: execution.reasons,
      });
    }
  }
  players.sort(
    (a, b) =>
      order[a.role] - order[b.role] ||
      Number(!!a.rankingReason) - Number(!!b.rankingReason) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.name.localeCompare(b.name),
  );
  for (const role of ['dps', 'healer', 'tank', 'unknown'] as Role[]) {
    const ranked = players.filter((p) => p.role === role && p.score !== null && !p.rankingReason);
    let previous = -1,
      rank = 0;
    ranked.forEach((p, index) => {
      const shown = Math.floor(p.score! * 10 + 1e-8);
      if (shown !== previous) rank = index + 1;
      p.rank = p.roleRank = rank;
      p.rolePeers = ranked.length;
      previous = shown;
    });
  }
  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    model: {
      id: EXECUTION_MODEL_VERSION,
      name: 'Execution score',
      deathPenalty: DEATH_PENALTY,
      deathPolicy: 'kills-and-recorded-calls',
      formula: 'mechanics-times-alive-minus-deaths',
    },
    report,
    selection: { ...selection, wipeStops: undefined, excludeWipeTail: false },
    players,
    pulls: pulls.map(({ metrics, boundaryLife, ...p }) => ({
      ...p,
      window: windowFor(report, { ...p, metrics, boundaryLife }, selection),
      evaluation: undefined,
    })),
    findings: [],
    warnings: [...report.warnings],
    summary: {
      pulls: pulls.length,
      kills: pulls.filter((p) => p.fight.kill).length,
      wipes: pulls.filter((p) => !p.fight.kill).length,
      bosses: new Set(pulls.map((p) => p.fight.encounterId)).size,
      players: new Set(players.map((p) => p.id)).size,
      rankedEntries: players.length,
      scoredPlayers: players.filter((p) => p.score !== null).length,
      durationMs: sum(pulls.map((p) => p.fight.endTime - p.fight.startTime)),
      complete: true,
    },
    methodology: {
      formula:
        'Mechanics × time alive / 100 when measured; otherwise a labelled survival-only score. Fixed death deductions apply only to kills and recorded wipe calls.',
      aggregation:
        'All completed pulls are scored automatically, weighted by assessed duration within each boss/difficulty. Difficulty contexts and bosses have equal weight. Partial attendance remains labelled.',
      limitations: [
        'Execution score measures comparable mechanic outcomes and recorded availability, not total class skill or responsibility for a wipe.',
        'DPS/HPS, damage taken, preparation and observed consumables are factual context, not score inputs.',
        'Where mechanics cannot be measured uniformly, every role peer uses labelled recorded survival instead; this is not assumed perfect mechanics.',
        'Without a recorded wipe call, a common terminal-collapse policy selects the assessment end automatically. It is an estimate, not knowledge of a voice call. No extra flat death cost applies to these wipes.',
        'On kills and recorded-call windows, the five-point death cost remains after resurrection. No recorded contribution earns zero credit, not an AFK accusation.',
      ],
    },
  };
}
