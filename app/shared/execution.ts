import type {
  Analysis,
  CompositeAssessment,
  ExecutionAssessment,
  ExecutionBossScore,
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
import {
  COMPOSITE_VERSION,
  combineComposites,
  mechanicRulesForPeers,
  mechanicsComponent,
  measuredComponent,
  outputComponent,
  scoreComposite,
  unknownComponent,
} from './composite.js';

export const EXECUTION_MODEL_VERSION = COMPOSITE_VERSION;
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
  composite?: CompositeAssessment,
): ExecutionAssessment {
  const alivePercent = scoreSurvival(aliveMs, durationMs);
  const score = issues.length || !composite?.complete ? null : composite.score;
  return {
    version: EXECUTION_MODEL_VERSION,
    composite,
    score,
    baseScore: score,
    alivePercent,
    mechanicsScore: composite?.components.mechanics.score ?? null,
    scoreBasis: 'composite',
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
                : [
                    'Required measurements could not be verified. Review the data issue before assigning a score.',
                  ],
            ),
          ]
        : [
            `${time(durationMs - aliveMs)} dead of ${time(durationMs)} recorded encounter time · ${deaths} deaths.`,
            composite?.scope === 'output-survival'
              ? 'Score uses output and survival. No common verified mechanic checks were available for this role; the same scope applies to every role participant in each pull.'
              : 'Score combines verified mechanic completion, report-relative output and recorded survival. All selected kills and wipes are included.',
          ],
  };
}
export function combineExecutions(
  values: ExecutionAssessment[],
  _mode: 'duration' | 'equal' = 'duration',
): ExecutionAssessment {
  if (!values.length || values.some((v) => !v.composite))
    throw Error('No composite measurements to combine.');
  const duration = sum(values.map((v) => v.weightMs ?? 0));
  const alive = sum(values.map((v) => (v.alivePercent * (v.weightMs ?? 0)) / 100));
  const result = assessment(
    alive,
    duration,
    sum(values.map((v) => v.deaths ?? 0)),
    sum(values.map((v) => v.totalPulls)),
    sum(values.map((v) => v.scoredPulls)),
    [...new Set(values.filter((v) => v.score === null).flatMap((v) => v.reasons))],
    combineComposites(values.map((v) => ({ composite: v.composite!, durationMs: v.weightMs! }))),
  );
  result.passedChecks = sum(values.map((v) => v.passedChecks));
  result.failedChecks = sum(values.map((v) => v.failedChecks));
  result.checkedMechanics = sum(values.map((v) => v.checkedMechanics));
  result.missedWhileDead = sum(values.map((v) => v.missedWhileDead ?? 0));
  return result;
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
  const hasPeerComparison = new Set<string>();
  for (const p of pulls) {
    const f = fightMap.get(p.fight.id)!;
    validatePull(p, f);
    const duration = f.endTime - f.startTime;
    const first = Math.min(
      ...p.metrics.flatMap((m) =>
        (m.facts?.lifeEvents ?? []).filter((e) => e.type === 'death').map((e) => e.timestamp),
      ),
    );
    const peersByRole = new Map<Role, Metric[]>();
    for (const metric of p.metrics) {
      const participant = metadata.get(metric.actorId);
      if (!participant) throw Error('A participating player is missing metadata.');
      const role = roleFor(participant, f);
      const peers = peersByRole.get(role) ?? [];
      peers.push(metric);
      peersByRole.set(role, peers);
    }
    const allowedByRole = new Map(
      [...peersByRole].map(([role, peers]) => [role, mechanicRulesForPeers(peers)]),
    );
    const roles = new Set<Role>(peersByRole.keys());
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
      const allowedRules = allowedByRole.get(role)!;
      const mechanical = mechanicsComponent(m, allowedRules);
      const mechanicsAvailable = activity && !issues.length;
      const peerMetrics = peersByRole.get(role)!;
      if (peerMetrics.length > 1) hasPeerComparison.add(key);
      const component = scoreComposite(
        role,
        {
          mechanics: mechanicsAvailable
            ? mechanical.observation
            : unknownComponent(
                'Participation or the life timeline is incomplete; mechanic exposure cannot be verified.',
              ),
          output: activity
            ? outputComponent(m, role, peerMetrics)
            : unknownComponent('No recorded combat contribution.'),
          survival:
            activity && !issues.length
              ? measuredComponent(
                  scoreSurvival(m.aliveMs, duration),
                  `${time(duration - m.aliveMs)} dead of ${time(duration)} recorded encounter time. Resurrection does not erase a death.`,
                  'full encounter timeline',
                )
              : unknownComponent(reasons.join(' '), 'full encounter timeline'),
        },
        allowedRules.size > 0,
      );
      const execution = assessment(
        m.aliveMs,
        duration,
        m.deaths,
        1,
        component.complete && !reasons.length ? 1 : 0,
        reasons,
        component,
      );
      execution.passedChecks = mechanicsAvailable ? mechanical.passed : 0;
      execution.failedChecks = mechanicsAvailable ? mechanical.failed : 0;
      execution.checkedMechanics = mechanicsAvailable ? mechanical.opportunities : 0;
      execution.missedWhileDead = mechanicsAvailable ? mechanical.missed : 0;
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
        mechanics: mechanicsAvailable
          ? mechanical.reviews
          : mechanical.reviews.map((r) => ({
              ...r,
              scored: false,
              passed: 0,
              failed: 0,
              opportunities: 0,
              missedWhileDead: 0,
              exclusion:
                'Participation or the life timeline is incomplete; mechanic exposure cannot be verified.',
              events: r.events.map((e) => ({ ...e, outcome: 'observed' as const })),
            })),
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
  const fullAttendance = new Set<string>();
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
    const execution = combineExecutions(reviews.map((r) => r.execution));
    const expected = pulls.filter((p) => rolesByFight.get(p.fight.id)!.has(role)).length;
    if (reviews.length === expected) fullAttendance.add(rowKey);
    const rankingReason =
      execution.score === null
        ? execution.reasons.join(' ')
        : reviews.length < expected
          ? 'Partial role attendance; compare the listed pulls before judging this score.'
          : !hasPeerComparison.has(rowKey)
            ? 'Only one participant in this role in the attended pulls; no comparative rank is assigned.'
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
      const grade = combineExecutions(group.map((r) => r.execution));
      perBoss.push({
        encounterId: f.encounterId,
        name: f.name,
        difficulty: f.difficulty,
        score: grade.score,
        pulls: group.length,
        execution: grade,
      });
    }
    const scoredRules = new Set(
      reviews.flatMap((r) =>
        r.mechanics.filter((m) => m.scored).map((m) => `${r.fightId}:${m.ruleId}`),
      ),
    );
    const evidence = metrics
      .flatMap((m) => m.evidence)
      .map((e) =>
        e.kind === 'mechanic' && !scoredRules.has(`${e.fightId}:${e.ruleId}`)
          ? {
              ...e,
              kind: 'mechanic-observed' as const,
              description:
                'Recorded encounter contact; individual scoring applicability could not be verified. Review its context in Warcraft Logs.',
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
      mechanicFailures: execution.failedChecks,
      mechanicOpportunities: execution.checkedMechanics,
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
      Number(fullAttendance.has(b.rowKey)) - Number(fullAttendance.has(a.rowKey)) ||
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
      name: 'Measured raid score',
      deathPenalty: 0,
      deathPolicy: 'full-encounter-time',
      formula: 'weighted-composite',
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
        'DPS: 50% mechanics + 30% output + 20% survival. Healer: 50/20/30. Tank: 60/10/30. Output is report-relative contribution, not a global parse.',
      aggregation:
        'Calculate each pull using the same verified mechanic rules for everyone in that role, then average by full attended duration. If no common mechanic rule is available, everyone in that role uses output/survival weights: DPS 60/40, healer 40/60, tank 25/75. No wipe cutoff or fixed death penalties.',
      limitations: [
        'This is a transparent composite of measured contribution and reviewed mechanics, not proof of total player skill or who caused a wipe.',
        'All deaths during the encounter are included, including intentional wipe deaths. Voice calls cannot be inferred.',
        'Resurrection ends dead time but never removes the death. A death at encounter end adds a death with zero remaining dead time.',
        'Output is relative to the highest recorded same-role total in each pull. It is not adjusted for spec, gear, phase assignments or external support. WCL kill percentiles are not applied to wipes.',
        'Mechanic completion credits verified successes out of valid opportunities. Checks while dead earn no completion credit but are not labelled mechanic failures. Death therefore affects availability, output and completion by explicit policy.',
        'A questionable rule is excluded for the entire role in the affected pull, not selectively for one player. Other verified pulls retain their checks. Output/survival fallback measures a narrower scope, which remains visible in the breakdown.',
        'Tank intake and unassigned utility never receive generic penalties. Preparation, healthstone, potion, defensive and enchant observations are context outside the score.',
        'Partial role attendance is labelled. Inconsistent life events or no recorded participation cannot earn an assumed perfect score.',
      ],
    },
  };
}
