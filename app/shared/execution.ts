import type {
  Analysis,
  ExecutionAssessment,
  ExecutionBossScore,
  ExecutionMechanic,
  ExecutionPullReview,
  Fight,
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

export const EXECUTION_MODEL_VERSION = 'survival/v1';
export const DEATH_PENALTY = 0;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const order: Record<Role, number> = { dps: 0, healer: 1, tank: 2, unknown: 3 };
export function scoreSurvival(aliveMs: number, durationMs: number): number {
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(aliveMs) ||
    aliveMs < 0 ||
    aliveMs > durationMs
  )
    throw Error('Invalid survival duration.');
  return (100 * aliveMs) / durationMs;
}
/** Legacy caller adapter. Mechanics and death count no longer alter the time measurement. */
export function scoreExecution(_mechanicsScore: number, alivePercent: number, _deaths = 0) {
  const score = scoreSurvival(alivePercent, 100);
  return { score, baseScore: score, deathPenalty: 0, capped: false };
}
const roleFor = (p: Player, f: Fight) => roleFromSpec(f.playerSpecs?.[p.id] ?? p.spec);
const blankFacts = (): PlayerFacts => ({
  snapshot: false,
  activeAtPull: [],
  consumables: [],
  lifeEvents: [],
  casts: 0,
});
const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function assessment(
  aliveMs: number,
  durationMs: number,
  deaths: number,
  pulls: number,
  scoredPulls: number,
  issues: string[] = [],
): ExecutionAssessment {
  const alivePercent = scoreSurvival(aliveMs, durationMs);
  const score = issues.length || scoredPulls !== pulls ? null : alivePercent;
  return {
    version: EXECUTION_MODEL_VERSION,
    score,
    baseScore: score,
    alivePercent,
    mechanicsScore: null,
    scoreBasis: 'recorded-survival',
    capped: false,
    deathPenalty: 0,
    deaths,
    missedWhileDead: 0,
    weightMs: durationMs,
    passedChecks: 0,
    failedChecks: 0,
    checkedMechanics: 0,
    scoredPulls,
    totalPulls: pulls,
    reasons:
      score === null
        ? [
            ...new Set(
              issues.length
                ? issues
                : ['Some survival measurements are incomplete; no score was inferred.'],
            ),
          ]
        : [
            `${time(durationMs - aliveMs)} dead of ${time(durationMs)} recorded encounter time � ${deaths} deaths.`,
            `Score = time alive � encounter time � 100. All selected kills and wipes are included.`,
          ],
  };
}
export function combineExecutions(
  values: ExecutionAssessment[],
  _mode: 'duration' | 'equal' = 'duration',
): ExecutionAssessment {
  if (!values.length) throw Error('No survival measurements to combine.');
  const duration = sum(values.map((v) => v.weightMs ?? 0));
  const alive = sum(values.map((v) => (v.alivePercent * (v.weightMs ?? 0)) / 100));
  return assessment(
    alive,
    duration,
    sum(values.map((v) => v.deaths ?? 0)),
    sum(values.map((v) => v.totalPulls)),
    sum(values.map((v) => v.scoredPulls)),
    values.filter((v) => v.score === null).flatMap((v) => v.reasons),
  );
}
function validatePull(pull: PullData, fight: Fight) {
  const duration = fight.endTime - fight.startTime;
  if (
    !pull.complete ||
    pull.fight.encounterId !== fight.encounterId ||
    pull.fight.difficulty !== fight.difficulty ||
    pull.fight.startTime !== fight.startTime ||
    pull.fight.endTime !== fight.endTime
  )
    throw Error('Incomplete or mismatched pull measurements.');
  if (
    pull.window &&
    (pull.window.endTime !== fight.endTime || !['full', 'kill'].includes(pull.window.source))
  )
    throw Error('Cached assessment window is clipped. Reimport full encounter facts.');
  if (
    new Set(fight.friendlyPlayers).size !== fight.friendlyPlayers.length ||
    new Set(pull.metrics.map((m) => m.actorId)).size !== pull.metrics.length ||
    pull.metrics.length !== fight.friendlyPlayers.length ||
    fight.friendlyPlayers.some((id) => !pull.metrics.some((m) => m.actorId === id))
  )
    throw Error('Missing or duplicate participant measurements.');
  for (const m of pull.metrics) {
    if (pull.window && !m.life) throw Error('Full-encounter cache is missing life measurements.');
    if (
      ![m.damage, m.healing, m.damageTaken, m.aliveMs, m.deaths, m.interrupts, m.dispels].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) ||
      m.aliveMs > duration ||
      !Number.isInteger(m.deaths)
    )
      throw Error('Invalid player measurements.');
    if (
      m.life &&
      (![m.life.aliveMs, m.life.deadMs, m.life.deaths, m.life.resurrections].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) ||
        !Number.isInteger(m.life.deaths) ||
        !Number.isInteger(m.life.resurrections) ||
        typeof m.life.complete !== 'boolean' ||
        !Array.isArray(m.life.issues) ||
        (m.life.complete && m.life.issues.length > 0))
    )
      throw Error('Invalid life summary.');
    if (
      m.life &&
      (Math.abs(m.life.aliveMs - m.aliveMs) > 1e-6 ||
        m.life.deaths !== m.deaths ||
        Math.abs(m.life.deadMs + m.life.aliveMs - duration) > 1e-6)
    )
      throw Error('Life timeline does not reconcile with player measurements.');
  }
}
function observations(m: Metric): ExecutionMechanic[] {
  return (m.mechanics ?? [])
    .filter((r) => r.observed > 0 || r.events.some((e) => e.outcome === 'failed'))
    .map((r) => ({
      ruleId: r.ruleId,
      name: r.name,
      kind: r.kind,
      scored: false,
      exclusion: 'Context only. No universal mistake or assignment is inferred.',
      passed: 0,
      failed: 0,
      missedWhileDead: 0,
      opportunities: 0,
      observed: r.observed,
      detail: r.detail,
      source: r.source,
      breakdown: r.breakdown,
      events: r.events
        .filter((e) => ['failed', 'observed'].includes(e.outcome))
        .map((e) => ({ ...e, outcome: 'observed' as const })),
    }));
}
export function analyzeExecution(
  report: Report,
  allPulls: PullData[],
  selection: Selection,
): Analysis {
  const chosen = selectFights(report, selection).sort(
    (a, b) => a.startTime - b.startTime || a.id - b.id,
  );
  if (!chosen.length) throw Error('No completed boss pulls match this selection.');
  const metadata = new Map(report.players.map((p) => [p.id, p]));
  if (metadata.size !== report.players.length) throw Error('Duplicate actor metadata.');
  const selectedIds = new Set(chosen.map((f) => f.id));
  const pulls = allPulls
    .filter((p) => selectedIds.has(p.fight.id))
    .sort((a, b) => a.fight.startTime - b.fight.startTime || a.fight.id - b.fight.id);
  if (
    pulls.length !== chosen.length ||
    new Set(pulls.map((p) => p.fight.id)).size !== chosen.length
  )
    throw Error('Missing or duplicate selected pulls.');
  const fightMap = new Map(chosen.map((f) => [f.id, f]));
  const rows = new Map<
    string,
    {
      player: Player;
      role: Role;
      pulls: PullData[];
      metrics: Metric[];
      reviews: ExecutionPullReview[];
    }
  >();
  const rolesByFight = new Map<number, Set<Role>>();
  for (const p of pulls) {
    const f = fightMap.get(p.fight.id)!;
    validatePull(p, f);
    const duration = f.endTime - f.startTime;
    const first = Math.min(
      ...p.metrics.flatMap((m) =>
        (m.facts?.lifeEvents ?? []).filter((e) => e.type === 'death').map((e) => e.timestamp),
      ),
    );
    const roles = new Set<Role>();
    rolesByFight.set(f.id, roles);
    for (const m of p.metrics) {
      const player = metadata.get(m.actorId);
      if (!player) throw Error('A participating player is missing metadata.');
      const role = roleFor(player, f);
      roles.add(role);
      const key = `${player.id}:${role}`;
      const row = rows.get(key) ?? { player, role, pulls: [], metrics: [], reviews: [] };
      rows.set(key, row);
      const facts = m.facts ?? blankFacts();
      const issues =
        m.life?.complete === false
          ? ['Death/resurrection events are inconsistent. Exact dead time cannot be verified.']
          : [];
      const activity =
        m.damage > 0 ||
        m.healing > 0 ||
        m.interrupts > 0 ||
        m.dispels > 0 ||
        facts.casts > 0 ||
        m.deaths > 0;
      const reasons = activity
        ? issues
        : [
            ...issues,
            'No recorded combat contribution; survival alone cannot establish participation.',
          ];
      const execution = assessment(
        m.aliveMs,
        duration,
        m.deaths,
        1,
        reasons.length ? 0 : 1,
        reasons,
      );
      row.pulls.push(p);
      row.metrics.push(m);
      row.reviews.push({
        fightId: f.id,
        window: assessmentWindow(report, f, selection),
        role,
        execution,
        aliveMs: m.aliveMs,
        durationMs: duration,
        deaths: m.deaths,
        damage: m.damage,
        healing: m.healing,
        damageTaken: m.damageTaken,
        mechanics: observations(m),
        facts,
        deadIntervals: m.life?.intervals,
        firstDeath: facts.lifeEvents.some((e) => e.type === 'death' && e.timestamp === first),
        resurrections:
          m.life?.resurrections ?? facts.lifeEvents.filter((e) => e.type === 'resurrect').length,
        lifeIssues: issues,
      });
    }
  }
  const players: RankedPlayer[] = [];
  for (const [rowKey, row] of rows) {
    const { player, role, metrics, reviews } = row;
    const ownSum = (
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
    const durationMs = sum(reviews.map((r) => r.durationMs));
    const execution = assessment(
      ownSum('aliveMs'),
      durationMs,
      ownSum('deaths'),
      reviews.length,
      reviews.filter((r) => r.execution.score !== null).length,
      reviews.filter((r) => r.execution.score === null).flatMap((r) => r.execution.reasons),
    );
    const expected = pulls.filter((p) => rolesByFight.get(p.fight.id)!.has(role)).length;
    const rankingReason =
      execution.score === null
        ? 'Incomplete evidence; no survival score was inferred.'
        : reviews.length < expected
          ? 'Partial role attendance; compare the listed pulls before judging this score.'
          : undefined;
    const perBoss: ExecutionBossScore[] = [];
    const contexts = new Map<string, ExecutionPullReview[]>();
    for (const r of reviews) {
      const f = fightMap.get(r.fightId)!;
      const key = `${f.encounterId}:${f.difficulty}`;
      const list = contexts.get(key) ?? [];
      list.push(r);
      contexts.set(key, list);
    }
    for (const group of contexts.values()) {
      const f = fightMap.get(group[0].fightId)!;
      const grade = assessment(
        sum(group.map((r) => r.aliveMs)),
        sum(group.map((r) => r.durationMs)),
        sum(group.map((r) => r.deaths)),
        group.length,
        group.filter((r) => r.execution.score !== null).length,
        group.filter((r) => r.execution.score === null).flatMap((r) => r.execution.reasons),
      );
      perBoss.push({
        encounterId: f.encounterId,
        name: f.name,
        difficulty: f.difficulty,
        score: grade.score,
        pulls: group.length,
        execution: grade,
      });
    }
    const evidence = metrics
      .flatMap((m) => m.evidence)
      .map((e) =>
        e.kind === 'mechanic'
          ? {
              ...e,
              kind: 'mechanic-observed' as const,
              description:
                'Recorded encounter contact; review its context in Warcraft Logs. Not part of the survival score.',
            }
          : e,
      );
    players.push({
      ...player,
      role,
      spec: [...new Set(row.pulls.map((p) => p.fight.playerSpecs?.[player.id] ?? player.spec))]
        .sort()
        .join(' / '),
      roles: [
        ...new Set([...rows.values()].filter((r) => r.player.id === player.id).map((r) => r.role)),
      ],
      rowKey,
      rank: null,
      roleRank: null,
      rolePeers: 0,
      rankingReason,
      score: execution.score,
      provisional: false,
      execution,
      pulls: reviews.length,
      bosses: new Set(row.pulls.map((p) => p.fight.encounterId)).size,
      scoredPulls: execution.scoredPulls,
      durationMs,
      aliveMs: ownSum('aliveMs'),
      deaths: ownSum('deaths'),
      damage: ownSum('damage'),
      healing: ownSum('healing'),
      damageTaken: ownSum('damageTaken'),
      interrupts: ownSum('interrupts'),
      dispels: ownSum('dispels'),
      defensives: ownSum('defensives'),
      mechanicFailures: 0,
      mechanicOpportunities: 0,
      perBoss,
      pullReviews: reviews,
      evidence,
      notes: execution.reasons,
      firstDeaths: reviews.filter((r) => r.firstDeath).length,
      resurrections: sum(reviews.map((r) => r.resurrections ?? 0)),
    });
  }
  players.sort(
    (a, b) =>
      order[a.role] - order[b.role] ||
      Number(!!a.rankingReason) - Number(!!b.rankingReason) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.id - b.id,
  );
  for (const role of ['dps', 'healer', 'tank', 'unknown'] as Role[]) {
    const ranked = players.filter((p) => p.role === role && p.score !== null && !p.rankingReason);
    let previous = -1,
      rank = 0;
    ranked.forEach((p, i) => {
      const shown = Math.floor(p.score! * 10 + 1e-8);
      if (shown !== previous) rank = i + 1;
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
      name: 'Survival score',
      deathPenalty: 0,
      deathPolicy: 'full-encounter-time',
      formula: 'alive-time-over-encounter-time',
    },
    report,
    selection: { ...selection, wipeStops: undefined, excludeWipeTail: false },
    players,
    pulls: pulls.map(({ metrics, boundaryLife, ...p }) => ({
      ...p,
      window: assessmentWindow(report, p.fight, selection),
      evaluation: undefined,
      wipeTailMs: 0,
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
      durationMs: sum(chosen.map((f) => f.endTime - f.startTime)),
      complete: true,
    },
    methodology: {
      formula:
        'Score = 100 � recorded time alive � full attended encounter time, separately for each role.',
      aggregation:
        'Sum milliseconds across the selected pulls in this role. Every recorded second has equal weight. No wipe cutoff, boss weights or fixed death penalties.',
      limitations: [
        'This is survival, not total player skill or proof of who caused a wipe.',
        'All deaths during the encounter are included, including intentional wipe deaths. Voice calls cannot be inferred.',
        'Resurrection ends dead time but never removes the death. A death at encounter end adds a death with zero remaining dead time.',
        'DPS/HPS, damage taken, mechanics and preparation are context only; no universal mistake is inferred.',
        'Partial role attendance is labelled. Inconsistent life events or no recorded participation cannot earn an assumed perfect score.',
      ],
    },
  };
}
