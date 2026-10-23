import type {
  Analysis,
  Metric,
  PullData,
  Role,
  RoleAssessment,
  RoleFactor,
  RoleFactorKey,
} from './types.js';
import { roleFromSpec } from './players.js';
export const ROLE_MODEL_VERSION = 'role-evidence/v2';
export const ROLE_WEIGHTS: Record<Role, Record<RoleFactorKey, number>> = {
  dps: { survival: 30, activity: 20, output: 30, protection: 0, mechanics: 20 },
  healer: { survival: 35, activity: 15, output: 30, protection: 0, mechanics: 20 },
  tank: { survival: 30, activity: 15, output: 10, protection: 25, mechanics: 20 },
  unknown: { survival: 30, activity: 20, output: 30, protection: 0, mechanics: 20 },
};
const names: Record<RoleFactorKey, string> = {
  survival: 'Survival',
  activity: 'Action continuity',
  output: 'Class/spec output',
  protection: 'Tank defensive response',
  mechanics: 'Verified mechanics',
};
const keys = Object.keys(names) as RoleFactorKey[];
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => (values.length ? sum(values) / values.length : 0);
const bounded = (value: number) => Math.max(0, Math.min(100, value));
const clock = (ms: number) => `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(1)}s`;
function factor(
  key: RoleFactorKey,
  weight: number,
  score: number | null,
  reliability: number,
  explanation: string,
): RoleFactor {
  if ((score !== null && !Number.isFinite(score)) || !Number.isFinite(reliability))
    throw new Error('Role evidence contains an invalid numeric measurement.');
  const q = score === null ? 0 : Math.max(0, Math.min(1, reliability)),
    measuredWeight = weight * q;
  return {
    key,
    name: names[key],
    weight,
    score: score === null ? null : bounded(score),
    measuredWeight,
    points: score === null ? 0 : (measuredWeight * bounded(score)) / 100,
    neutralPoints: (weight - measuredWeight) / 2,
    explanation,
  };
}
function assessment(
  factors: RoleFactor[],
  notes: string[] = [],
  contexts: RoleAssessment['contexts'] = [],
): RoleAssessment {
  const lower = sum(factors.map((f) => f.points)),
    coverage = sum(factors.map((f) => f.measuredWeight)),
    upper = Math.min(100, lower + 100 - coverage);
  return {
    version: ROLE_MODEL_VERSION,
    score: bounded((lower + upper) / 2),
    lower,
    upper,
    coverage,
    factors,
    notes,
    contexts,
  };
}
/** No category is silently reassigned. Unknown weight remains explicit neutral midpoint + bounds. */
export function combineAssessments(
  inputs: { value: RoleAssessment; weight: number }[],
): RoleAssessment {
  const total = sum(inputs.map((x) => x.weight));
  if (!total) throw new Error('No role assessment inputs');
  const factors = keys.flatMap((key) => {
    const parts = inputs.map(({ value, weight }) => ({
      factor: value.factors.find((f) => f.key === key),
      scale: weight / total,
    }));
    const weight = sum(parts.map((x) => (x.factor?.weight ?? 0) * x.scale));
    if (!weight) return [];
    const measuredWeight = sum(parts.map((x) => (x.factor?.measuredWeight ?? 0) * x.scale));
    const points = sum(parts.map((x) => (x.factor?.points ?? 0) * x.scale));
    return [
      {
        key,
        name: names[key],
        weight,
        measuredWeight,
        points,
        neutralPoints: (weight - measuredWeight) / 2,
        score: measuredWeight ? (100 * points) / measuredWeight : null,
        explanation:
          inputs.length === 1
            ? (parts[0].factor?.explanation ?? '')
            : 'Weighted from the separately displayed boss, difficulty and role contexts. See each boss for measured counts.',
      },
    ];
  });
  return assessment(
    factors,
    [...new Set(inputs.flatMap((x) => x.value.notes))],
    inputs.flatMap((x) => x.value.contexts),
  );
}

export function applyRoleModel(
  analysis: Analysis,
  pulls: PullData[],
  includePullReviews = true,
): Analysis {
  for (const player of analysis.players) {
    const own = pulls.filter((p) => p.fight.friendlyPlayers.includes(player.id));
    const perBoss = new Map<number, RoleAssessment>();
    for (const encounterId of new Set(own.map((p) => p.fight.encounterId))) {
      const boss = own.filter((p) => p.fight.encounterId === encounterId);
      const difficulties = [...new Set(boss.map((p) => p.fight.difficulty))];
      const diffGrades = difficulties.map((difficulty) => {
        const same = boss.filter((p) => p.fight.difficulty === difficulty);
        const roles = [
          ...new Set(
            same.map((p) => roleFromSpec(p.fight.playerSpecs?.[player.id] ?? player.spec)),
          ),
        ];
        return combineAssessments(
          roles.map((role) => {
            const selected = same.filter(
              (p) => roleFromSpec(p.fight.playerSpecs?.[player.id] ?? player.spec) === role,
            );
            const weights = ROLE_WEIGHTS[role];
            const records = selected.flatMap((p) => {
              const m = p.metrics.find((m) => m.actorId === player.id);
              if (!m) return [];
              const end =
                analysis.selection.excludeWipeTail && p.evaluation
                  ? p.evaluation.endTime
                  : p.fight.endTime;
              const evaluated =
                analysis.selection.excludeWipeTail && p.evaluation ? { ...m, ...m.evaluated } : m;
              return [{ pull: p, metric: evaluated, duration: end - p.fight.startTime }];
            });
            const metrics = records.map((r) => r.metric),
              duration = sum(
                selected.map(
                  (p) =>
                    (analysis.selection.excludeWipeTail && p.evaluation
                      ? p.evaluation.endTime
                      : p.fight.endTime) - p.fight.startTime,
                ),
              );
            const alive = sum(metrics.map((m) => m.aliveMs));
            const measuredDuration = sum(records.map((r) => r.duration));
            const activity = metrics.flatMap((m) => (m.activity ? [m.activity] : []));
            const eligible = sum(activity.map((a) => a.eligibleMs)),
              active = sum(activity.map((a) => a.activeMs));
            const windows = sum(activity.map((a) => a.eligibleWindows));
            const parses = metrics.flatMap((m) =>
              m.outputPercentile !== null && role !== 'unknown' ? [m.outputPercentile] : [],
            );
            const tank = metrics.flatMap((m) => (m.tank ? [m.tank] : []));
            const known = sum(tank.map((t) => t.responseKnownWindows ?? 0)),
              covered = sum(tank.map((t) => t.responseCoveredWindows ?? 0)),
              unknown = sum(tank.map((t) => t.responseUnknownWindows ?? 0));
            const mechanic = records.filter(
              (r) =>
                r.pull.mechanicRule &&
                r.metric.mechanicFailures !== null &&
                r.metric.mechanicOpportunities !== null,
            );
            const opportunities = sum(mechanic.map((r) => r.metric.mechanicOpportunities ?? 0)),
              failures = sum(mechanic.map((r) => r.metric.mechanicFailures ?? 0));
            const mechAllowed = role !== 'unknown';
            const checks = new Map<
              string,
              { weight: number; opportunities: number; failures: number; unknown: number }
            >();
            for (const m of metrics)
              for (const r of m.mechanics ?? []) {
                if (!r.weight || !(r.opportunities + r.unknown)) continue;
                const c = checks.get(r.ruleId) ?? {
                  weight: r.weight,
                  opportunities: 0,
                  failures: 0,
                  unknown: 0,
                };
                c.opportunities += r.opportunities;
                c.failures += r.failures;
                c.unknown += r.unknown;
                checks.set(r.ruleId, c);
              }
            const ruleWeight = sum([...checks.values()].map((c) => c.weight));
            const knownRuleWeight = sum(
              [...checks.values()].map(
                (c) =>
                  c.weight *
                  (c.opportunities / (c.opportunities + c.unknown)) *
                  Math.min(1, c.opportunities / 3),
              ),
            );
            const rulePoints = sum(
              [...checks.values()].map(
                (c) =>
                  c.weight *
                  (c.opportunities / (c.opportunities + c.unknown)) *
                  Math.min(1, c.opportunities / 3) *
                  (c.opportunities ? 1 - c.failures / c.opportunities : 0),
              ),
            );
            const legacyAllowed = role !== 'tank' && mechAllowed;
            const measuredMechanicTime = sum(mechanic.map((r) => r.duration));
            const factors = [
              factor(
                'survival',
                weights.survival,
                measuredDuration ? (100 * alive) / measuredDuration : null,
                (duration ? measuredDuration / duration : 0) *
                  Math.min(1, measuredDuration / 60000),
                `${clock(alive)} alive / ${clock(measuredDuration)} measured (${clock(duration)} selected). Missing measurements remain unknown. Battle resurrections count; Feign Death does not. Early deaths lose more time, without assigning fault.`,
              ),
              factor(
                'activity',
                weights.activity,
                eligible ? (100 * active) / eligible : null,
                (Math.min(1, windows / 10) * activity.length) / selected.length,
                `${clock(active)} active / ${clock(eligible)} eligible across ${windows} ten-second role-context windows. Shared role downtime is excluded; this is observed action continuity, not a rotation/GCD or assignment verdict.`,
              ),
              factor(
                'output',
                weights.output,
                parses.length ? mean(parses) : null,
                parses.length / selected.length,
                `${parses.length} historical class/spec kill percentiles out of ${selected.length} pulls (${role === 'healer' ? 'HPS' : 'DPS'}). Wipes have no kill percentile. Raw throughput and cross-class DPS never substitute for a missing benchmark.`,
              ),
              ...(weights.protection
                ? [
                    factor(
                      'protection',
                      weights.protection,
                      known ? (100 * covered) / known : null,
                      ((known + unknown ? known / (known + unknown) : 0) *
                        Math.min(1, known / 20) *
                        tank.length) /
                        selected.length,
                      `${covered} / ${known} known five-second melee windows had a personal physical response or recorded effective catalogue self-recovery; ${unknown} unknown. Class-specific auras, reactive healing and Fiery Brand target are respected. External cooldowns, total intake and overheal earn no points. Coverage is not optimal resource/cooldown use.`,
                    ),
                  ]
                : []),
              factor(
                'mechanics',
                weights.mechanics,
                mechAllowed && knownRuleWeight
                  ? (100 * rulePoints) / knownRuleWeight
                  : legacyAllowed && opportunities
                    ? 100 * (1 - failures / opportunities)
                    : null,
                mechAllowed && ruleWeight
                  ? knownRuleWeight / ruleWeight
                  : legacyAllowed && duration
                    ? (measuredMechanicTime / duration) * Math.min(1, opportunities / 10)
                    : 0,
                ruleWeight
                  ? `${failures} failed / ${opportunities} verified opportunities in ${checks.size} rule families. Each mechanic has its own severity budget, so repeated easy checks cannot dilute another mechanic. Unknown exposure stays neutral. Three opportunities per rule reach the sample cap; this is a disclosed policy, not statistical certainty. Required tank contact, soaks and shared raid incidents are separated. See each pull for exact checks and sources.`
                  : role === 'tank'
                    ? 'No verified tank duty opportunities in this selection. Required contacts, assignments and unknown swaps are not invented as errors.'
                    : `${failures} failed / ${opportunities} verified opportunities across ${mechanic.length} pulls. Unmodelled abilities are observations, not errors. Rule coverage is disclosed separately from sample size.`,
              ),
            ];
            const notes = [
              'Unknown or under-sampled weight is held at the neutral midpoint 50, not awarded as observed performance. The displayed range assigns that unknown weight 0–100; it is a missing-evidence range, not a statistical confidence interval.',
              ...(role === 'tank'
                ? [
                    'Tank response is measured under actual melee exposure, not on raw damage taken or buff uptime while off-tanking. Required damage is not an avoidance failure; boss control and optimal resources remain separate unverified duties.',
                  ]
                : []),
            ];
            const value = assessment(factors, notes);
            value.contexts = [
              {
                encounterId,
                name: selected[0].fight.name,
                difficulty,
                role,
                pulls: selected.length,
                score: value.score,
              },
            ];
            return { value, weight: selected.length };
          }),
        );
      });
      const grade = combineAssessments(diffGrades.map((value) => ({ value, weight: 1 })));
      perBoss.set(encounterId, grade);
      const existing = player.perBoss.find((b) => b.encounterId === encounterId)!;
      existing.assessment = grade;
      existing.score = grade.score;
      existing.coverage = grade.coverage;
      existing.provisional =
        grade.coverage < 99.999999 || boss.some((p) => p.mechanicScope !== 'complete');
    }
    const measuredBosses = perBoss.size;
    for (const encounterId of new Set(pulls.map((p) => p.fight.encounterId)))
      if (!perBoss.has(encounterId)) {
        const name = pulls.find((p) => p.fight.encounterId === encounterId)!.fight.name;
        const missing = assessment(
          keys
            .filter((key) => ROLE_WEIGHTS[player.role][key] > 0)
            .map((key) =>
              factor(
                key,
                ROLE_WEIGHTS[player.role][key],
                null,
                0,
                'This boss was not attended. No result is invented; its weight remains explicitly unknown.',
              ),
            ),
        );
        perBoss.set(encounterId, missing);
        player.perBoss.push({
          encounterId,
          name,
          score: missing.score,
          relativeScore: null,
          coverage: 0,
          pulls: 0,
          categories: Object.fromEntries(
            Object.entries(player.categories).map(([key, c]) => [
              key,
              { ...c, score: null, applied: false, explanation: 'No attended pulls.' },
            ]),
          ) as typeof player.categories,
          provisional: true,
          assessment: missing,
        });
      }
    player.assessment = combineAssessments(
      [...perBoss.values()].map((value) => ({ value, weight: 1 })),
    );
    player.score = player.assessment.score;
    player.coverage = player.assessment.coverage;
    player.comparedBosses = measuredBosses;
    player.provisional =
      player.bosses < analysis.summary.bosses || player.perBoss.some((b) => b.provisional);
    player.confidence =
      player.coverage >= 85 && player.pulls >= 8 && player.bossCoverage >= 80 && !player.provisional
        ? 'strong'
        : player.coverage >= 60 && player.pulls >= 3
          ? 'developing'
          : 'limited';
    player.notes = [
      `All ${player.pulls} attended pulls are included. ${player.bosses} of ${analysis.summary.bosses} selected bosses attended. Unattended bosses remain unknown midpoint weight with explicit bounds, never zeroes. Low participation is limited evidence, not proof of poor play.`,
      ...player.assessment.notes,
    ];
    if (includePullReviews)
      player.pullReviews = own.flatMap((p) => {
        const raw = p.metrics.find((m) => m.actorId === player.id);
        if (!raw) return [];
        const m =
          analysis.selection.excludeWipeTail && p.evaluation ? { ...raw, ...raw.evaluated } : raw;
        const duration =
          (analysis.selection.excludeWipeTail && p.evaluation
            ? p.evaluation.endTime
            : p.fight.endTime) - p.fight.startTime;
        const perBoss = player.perBoss.find((b) => b.encounterId === p.fight.encounterId)!;
        const single = {
          ...player,
          pulls: 1,
          bosses: 1,
          bossCoverage: 100,
          perBoss: [{ ...perBoss }],
          evidence: [],
          pullReviews: undefined,
        };
        const mini = {
          ...analysis,
          players: [single],
          summary: { ...analysis.summary, bosses: 1, pulls: 1 },
          warnings: [],
          methodology: { ...analysis.methodology },
        };
        applyRoleModel(mini, [p], false);
        const a = single.assessment!;
        const loss = [...a.factors]
          .filter((f) => f.measuredWeight > 0)
          .sort((a, b) => b.measuredWeight - b.points - (a.measuredWeight - a.points))[0];
        return [
          {
            fightId: p.fight.id,
            role: roleFromSpec(p.fight.playerSpecs?.[player.id] ?? player.spec),
            assessment: a,
            aliveMs: m.aliveMs,
            durationMs: duration,
            deaths: m.deaths,
            damage: raw.damage,
            healing: raw.healing,
            mechanics: m.mechanics ?? [],
            summary: `${m.mechanicFailures ?? 0} failed / ${m.mechanicOpportunities ?? 0} verified checks; ${m.deaths} recorded deaths in the scoring window. ${loss ? `Largest measured reduction: ${loss.name.toLowerCase()} (${(loss.measuredWeight - loss.points).toFixed(1)} points).` : ''} Missing evidence remains neutral, not a success.`,
          },
        ];
      });
  }
  if (includePullReviews) {
    analysis.mechanicCatalogue = {};
    for (const player of analysis.players)
      for (const review of player.pullReviews ?? [])
        review.mechanics = review.mechanics.map((raw) => {
          const r = raw as import('./types.js').MechanicResult;
          const { ruleId, name, kind, weight, detail, source, abilityIds } = r;
          analysis.mechanicCatalogue![ruleId] = {
            ruleId,
            name,
            kind,
            weight,
            detail,
            source,
            abilityIds,
          };
          return {
            ruleId,
            opportunities: r.opportunities,
            failures: r.failures,
            unknown: r.unknown,
            observed: r.observed,
            breakdown: r.breakdown,
            events: r.events.map((e) => ({
              ...e,
              detail: e.outcome === 'observed' && e.detail === detail ? '' : e.detail,
            })),
          };
        });
  }
  analysis.players.sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name));
  function ranks(players: Analysis['players'], role = false) {
    let previous = -1,
      rank = 0;
    players.forEach((p, i) => {
      const shown = Math.floor(p.score! * 10);
      if (shown !== previous) rank = i + 1;
      if (role) {
        p.roleRank = rank;
        p.rolePeers = players.length;
      } else p.rank = rank;
      previous = shown;
    });
  }
  ranks(analysis.players);
  for (const role of ['tank', 'healer', 'dps', 'unknown'] as const)
    ranks(
      analysis.players.filter((p) => p.role === role),
      true,
    );
  const order = { dps: 0, healer: 1, tank: 2, unknown: 3 };
  analysis.players.sort(
    (a, b) => order[a.role] - order[b.role] || b.score! - a.score! || a.name.localeCompare(b.name),
  );
  for (const p of analysis.players) p.rank = p.roleRank ?? null;
  analysis.summary.coverage = mean(analysis.players.map((p) => p.coverage));
  analysis.warnings = analysis.warnings.filter(
    (w) =>
      !w.includes('not assigned a misleading') &&
      !w.startsWith('On audited Sszorak') &&
      !w.includes('overall ranking requires') &&
      !w.includes('Some bosses do not yet'),
  );
  analysis.warnings.push(
    'With comparison cutoffs enabled, sustained terminal 50% mortality may shorten any raid wipe. Kills stay full length; only the verified Sszorak Mythic enrage supplies a spell-specific cutoff. Full raw totals remain visible.',
    'Universal role index runs on every boss and difficulty. Unknown evidence is displayed explicitly with a neutral midpoint and score range; high output alone cannot create a perfect grade. Boss-specific avoidable-mechanic coverage is separate.',
    'Role weights are transparent design choices, not scientifically calibrated probabilities of player skill. Role rankings are separate: DPS, healers, tanks, then mixed/unknown. All selected bosses receive equal weight; unattended bosses remain unknown.',
  );
  analysis.methodology.rules = [ROLE_MODEL_VERSION, ...analysis.methodology.rules];
  analysis.methodology.bossWeighting =
    'Fixed role weights combine survival, role-context action continuity, available class/spec kill output, tank response and verified mechanics. Unknown weight remains neutral 50 with explicit bounds. Each difficulty and selected boss receives equal weight; unattended bosses remain unknown. Rankings are separate by role: DPS, healers, tanks, then mixed/unknown. Pull details show exact rule outcomes and score inputs.';
  analysis.methodology.limitations = [
    'Role scores are evidence indices, not a complete causal judgement of player skill. See the factor formulas, measured and neutral points, and missing-evidence range.',
    'Boss mechanics need verified encounter/difficulty adapters. The universal index remains available without them; unrecognised debuffs never become automatic mistakes.',
    'Personal tank response and effective recovery are observed, not an optimal cooldown, resource, swap or assignment verdict. Required hits and external-healer throughput are not penalised.',
    'Action windows allow long casts and channels and exclude shared role downtime, but cannot infer every assigned movement task. Wipe collapse is a disclosed comparison policy, not a recorded raid-leader call.',
    'Historical class/spec output percentiles apply to kills only. Missing benchmarks remain unknown, and healing demand still affects HPS percentiles.',
    'Small samples, mixed roles and different attendance are disclosed. A narrow evidence range is not proof of complete boss-mechanic coverage.',
  ];
  return analysis;
}
