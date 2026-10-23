import type {
  Analysis,
  Category,
  CategoryScore,
  Finding,
  Metric,
  PlayerBossScore,
  PullData,
  RankedPlayer,
  Report,
  Selection,
} from './types.js';
import { selectFights } from './report-url.js';

import { VERSION } from './version.js';
import { summarizeSpecs } from './players.js';
export const ENGINE_VERSION = VERSION;
export const WEIGHTS = { mechanics: 35, survival: 35, output: 20, utility: 10 } as const;
export const CATEGORIES = Object.keys(WEIGHTS) as Category[];
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const sum = (metrics: Metric[], key: keyof Metric) =>
  metrics.reduce((n, m) => n + (typeof m[key] === 'number' ? (m[key] as number) : 0), 0);
const blankCategories = (): Record<Category, CategoryScore> =>
  Object.fromEntries(
    CATEGORIES.map((key) => [
      key,
      {
        score: null,
        weight: WEIGHTS[key],
        applied: false,
        explanation: 'Not enough comparable evidence.',
      },
    ]),
  ) as Record<Category, CategoryScore>;

/** Reproducible observations, never inferred blame. Same inputs give identical scores. */
export function analyze(report: Report, allPulls: PullData[], selection: Selection): Analysis {
  const selected = selectFights(report, selection);
  if (!selected.length) throw new Error('No completed boss pulls match this selection.');
  const ids = new Set(selected.map((f) => f.id));
  const pulls = allPulls.filter((p) => ids.has(p.fight.id));
  if (
    pulls.length !== selected.length ||
    new Set(pulls.map((p) => p.fight.id)).size !== selected.length ||
    pulls.some((p) => !p.complete)
  )
    throw new Error('The selected pulls are not fully downloaded. No ranking was produced.');
  const bossIds = [...new Set(pulls.map((p) => p.fight.encounterId))];
  const participants = report.players
    .filter((p) => pulls.some((pull) => pull.fight.friendlyPlayers.includes(p.id)))
    .map((player) => {
      const specs = pulls
        .filter((p) => p.fight.friendlyPlayers.includes(player.id))
        .map((p) => p.fight.playerSpecs?.[player.id] ?? player.spec);
      return { ...player, ...summarizeSpecs(specs) };
    });
  const perPlayer = new Map<number, RankedPlayer>();
  for (const player of participants) {
    const participated = pulls.filter((p) => p.fight.friendlyPlayers.includes(player.id));
    const metrics = participated
      .map((p) => p.metrics.find((m) => m.actorId === player.id))
      .filter((m): m is Metric => Boolean(m));
    const knownMechanics = metrics.filter(
      (m) => m.mechanicOpportunities !== null && m.mechanicFailures !== null,
    );
    perPlayer.set(player.id, {
      ...player,
      rank: null,
      score: null,
      provisional: true,
      coverage: 0,
      confidence: 'limited',
      pulls: participated.length,
      bosses: new Set(participated.map((p) => p.fight.encounterId)).size,
      bossCoverage: 0,
      comparedBosses: 0,
      durationMs: participated.reduce((n, p) => n + p.fight.endTime - p.fight.startTime, 0),
      aliveMs: sum(metrics, 'aliveMs'),
      deaths: sum(metrics, 'deaths'),
      damage: sum(metrics, 'damage'),
      healing: sum(metrics, 'healing'),
      damageTaken: sum(metrics, 'damageTaken'),
      interrupts: sum(metrics, 'interrupts'),
      dispels: sum(metrics, 'dispels'),
      defensives: sum(metrics, 'defensives'),
      mechanicFailures: knownMechanics.length ? sum(knownMechanics, 'mechanicFailures') : null,
      mechanicOpportunities: knownMechanics.length
        ? sum(knownMechanics, 'mechanicOpportunities')
        : null,
      categories: blankCategories(),
      perBoss: [],
      evidence: metrics
        .flatMap((m) => m.evidence)
        .sort((a, b) => a.fightId - b.fightId || a.timestamp - b.timestamp),
      notes: [],
    });
  }
  const rules = new Set<string>();
  for (const bossId of bossIds) {
    const bossPulls = pulls.filter((p) => p.fight.encounterId === bossId);
    const candidates: {
      player: RankedPlayer;
      metric: Metric[];
      categories: Record<Category, CategoryScore>;
      duration: number;
      n: number;
    }[] = [];
    for (const player of perPlayer.values()) {
      const own = bossPulls.filter((p) => p.fight.friendlyPlayers.includes(player.id));
      if (!own.length) continue;
      const metric = own
        .map((p) => p.metrics.find((m) => m.actorId === player.id))
        .filter((m): m is Metric => Boolean(m));
      const duration = own.reduce((n, p) => n + p.fight.endTime - p.fight.startTime, 0);
      const categories = blankCategories();
      // Missing actor metrics are not a death, a zero parse, or a perfect mechanic score.
      if (metric.length === own.length && duration > 0) {
        categories.survival.score = clamp((100 * sum(metric, 'aliveMs')) / duration);
        categories.survival.explanation =
          'Share of selected encounter time alive, including battle resurrections. This measures survival, not fault for a death.';
      }
      const mechanic = metric.filter(
        (m) => m.mechanicOpportunities !== null && m.mechanicFailures !== null,
      );
      const opportunities = sum(mechanic, 'mechanicOpportunities');
      if (mechanic.length === own.length && opportunities > 0) {
        categories.mechanics.score = clamp(
          100 * (1 - sum(mechanic, 'mechanicFailures') / opportunities),
        );
        categories.mechanics.explanation = `${sum(mechanic, 'mechanicFailures')} confirmed failed opportunities out of ${opportunities}. Unverified spell hits are not treated as mistakes.`;
      }
      const percentiles = metric
        .map((m) => m.outputPercentile)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (percentiles.length === own.length) {
        categories.output.score = mean(percentiles.map(clamp));
        categories.output.explanation =
          'Mean Warcraft Logs historical class/spec output percentile for these kills: HPS for healers, DPS for damage dealers and tanks. Wipes have no kill percentile.';
      }
      const utility = metric.filter(
        (m) => m.utilityOpportunities !== null && m.utilitySuccesses !== null,
      );
      const utilityOpportunities = sum(utility, 'utilityOpportunities');
      if (utility.length === own.length && utilityOpportunities > 0) {
        categories.utility.score = clamp(
          (100 * sum(utility, 'utilitySuccesses')) / utilityOpportunities,
        );
        categories.utility.explanation = `${sum(utility, 'utilitySuccesses')} fulfilled assigned utility opportunities out of ${utilityOpportunities}. Unassigned cast counts never create a grade.`;
      }
      candidates.push({ player, metric, categories, duration, n: own.length });
    }
    // A category is either applied to the whole boss cohort or to nobody in it.
    // Otherwise incomplete data could improve a player's overall score.
    const eligible = CATEGORIES.filter(
      (c) => candidates.length > 0 && candidates.every((p) => p.categories[c].score !== null),
    );
    const coverage = eligible.reduce((n, c) => n + WEIGHTS[c], 0);
    for (const candidate of candidates) {
      for (const category of CATEGORIES) {
        candidate.categories[category].applied = eligible.includes(category);
        if (
          !candidate.categories[category].applied &&
          candidate.categories[category].score !== null
        ) {
          candidate.categories[category].explanation +=
            ' Displayed for context only: comparable data is missing for another participant, so this category is excluded for everyone on this boss.';
        }
      }
      const score = coverage
        ? eligible.reduce((n, c) => n + candidate.categories[c].score! * WEIGHTS[c], 0) / coverage
        : null;
      candidate.player.perBoss.push({
        encounterId: bossId,
        name: bossPulls[0].fight.name,
        score,
        relativeScore: null,
        coverage,
        pulls: candidate.n,
        categories: candidate.categories,
      });
    }
    bossPulls.forEach((p) => {
      if (p.mechanicRule) rules.add(p.mechanicRule);
    });
  }
  // Midrank within each boss removes different boss score distributions from the
  // whole-report order. Ties share a value; an all-equal boss gives everyone 50.
  for (const bossId of bossIds) {
    const records = [...perPlayer.values()].flatMap((p) =>
      p.perBoss.filter((b) => b.encounterId === bossId && b.score !== null),
    );
    for (const record of records) {
      const own = Math.round(record.score! * 1000),
        lower = records.filter((b) => Math.round(b.score! * 1000) < own).length,
        equal = records.filter((b) => Math.round(b.score! * 1000) === own).length;
      record.relativeScore = (100 * (lower + equal / 2)) / records.length;
    }
  }
  const minimumBosses = Math.max(1, Math.ceil(bossIds.length / 2));
  for (const player of perPlayer.values()) {
    const comparable = player.perBoss.filter((b) => b.relativeScore !== null);
    player.comparedBosses = comparable.length;
    player.bossCoverage = bossIds.length ? (player.bosses / bossIds.length) * 100 : 0;
    player.score =
      comparable.length >= minimumBosses ? mean(comparable.map((b) => b.score!)) : null;
    player.coverage = mean(comparable.map((b) => b.coverage)) ?? 0;
    player.provisional =
      comparable.length !== bossIds.length || comparable.some((b) => b.coverage < 100);
    for (const category of CATEGORIES) {
      const applied = comparable.filter((b) => b.categories[category].applied);
      player.categories[category] = {
        score: mean(applied.map((b) => b.categories[category].score!)),
        weight: WEIGHTS[category],
        applied: applied.length > 0,
        explanation: applied.length
          ? `Equal-boss average across ${applied.length} comparable boss(es). Open the boss breakdown for exact inputs.`
          : 'Not applied: missing comparable or verified evidence. This is not a zero.',
      };
    }
    player.confidence =
      player.pulls >= 8 && player.coverage >= 70
        ? 'strong'
        : player.pulls >= 3 && player.coverage >= 50
          ? 'developing'
          : 'limited';
    if (player.coverage < 70)
      player.notes.push(
        'Limited scoring coverage. Treat this order as a provisional comparison, not a complete judgement of raid performance.',
      );
    if (player.bosses !== bossIds.length)
      player.notes.push(
        'Did not attend every selected boss. Missing bosses are not zeroes. The index averages boss-relative standings on attended bosses; compare participation before interpreting small differences.',
      );
    if (comparable.length < minimumBosses)
      player.notes.push(
        `Not ranked overall: scored participation on at least ${minimumBosses} of ${bossIds.length} selected bosses is required. Individual boss results remain visible.`,
      );
    if (player.pulls < 3) player.notes.push('Small sample: fewer than three pulls.');
  }
  const players = [...perPlayer.values()].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
  );
  let previous: number | null = null,
    rank = 0;
  players.forEach((p, index) => {
    if (p.score === null) return;
    const rounded = Math.floor(p.score * 10);
    if (previous !== rounded) rank = index + 1;
    p.rank = rank;
    previous = rounded;
  });
  const findings: Finding[] = [];
  for (const player of players) {
    const mechanicEvents = player.evidence.filter((e) => e.kind === 'mechanic');
    const grouped = new Map<string, typeof mechanicEvents>();
    for (const event of mechanicEvents) {
      const group = grouped.get(event.ruleId ?? event.ability) ?? [];
      group.push(event);
      grouped.set(event.ruleId ?? event.ability, group);
    }
    for (const [, events] of grouped) {
      if (new Set(events.map((e) => e.fightId)).size >= 2)
        findings.push({
          title: `Recurring mechanic: ${player.name}`,
          detail: `${events[0].ability} appears as a confirmed failed opportunity in ${new Set(events.map((e) => e.fightId)).size} pulls. Review these incidents and the raid assignment before deciding how to improve.`,
          confidence: 'observed',
          actorId: player.id,
          fightIds: [...new Set(events.map((e) => e.fightId))],
          evidence: events,
        });
    }
  }
  for (const pull of pulls.filter((p) => !p.fight.kill)) {
    const deaths = pull.metrics
      .flatMap((m) =>
        m.evidence.filter((e) => e.kind === 'death').map((e) => ({ ...e, actorId: m.actorId })),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!deaths.length) continue;
    const first = deaths[0];
    const player = report.players.find((p) => p.id === first.actorId);
    findings.push({
      title: `First death · pull ${pull.fight.id}`,
      detail: `${player?.name ?? 'A player'} died first, ${Math.round((first.timestamp - pull.fight.startTime) / 1000)} seconds into ${pull.fight.name}. This is a review starting point, not proof that this player caused the wipe.`,
      confidence: 'inferred',
      fightIds: [pull.fight.id],
      actorId: first.actorId,
      evidence: [first],
    });
  }
  const warnings = [...new Set([...report.warnings, ...pulls.flatMap((p) => p.warnings)])];
  if (new Set(pulls.map((p) => p.fight.difficulty)).size > 1)
    warnings.push(
      'Multiple difficulties are combined in this selection. Bosses retain equal weight; choose one difficulty for a more comparable cohort.',
    );
  if (players.some((p) => p.bosses !== bossIds.length))
    warnings.push(
      'Participation differs. Missing bosses never count as zero; overall ranking requires attendance on at least half the selected bosses. Boss-relative comparisons reduce, but cannot eliminate, differences in assignments and attendance.',
    );
  if (pulls.some((p) => !p.mechanicRule))
    warnings.push(
      'Some bosses do not yet have validated mechanic-scoring rules. Their mechanic events are not automatically labelled as mistakes.',
    );
  return {
    version: ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    report,
    selection,
    players,
    pulls: pulls.map(({ metrics, ...summary }) => summary),
    findings,
    warnings,
    summary: {
      pulls: pulls.length,
      kills: pulls.filter((p) => p.fight.kill).length,
      wipes: pulls.filter((p) => !p.fight.kill).length,
      bosses: bossIds.length,
      players: players.length,
      durationMs: pulls.reduce((n, p) => n + p.fight.endTime - p.fight.startTime, 0),
      coverage: mean(players.map((p) => p.coverage)) ?? 0,
      complete: true,
    },
    methodology: {
      weights: WEIGHTS,
      bossWeighting:
        'Calculate a weighted 0–100 evidence score per boss, then average equally across attended bosses. A boss with many wipes does not dominate the whole-report score. Missing categories are excluded for the whole boss cohort, never treated as perfect or zero. Incomplete coverage is explicitly provisional (~), and never earns the gold 100 badge. At least half the selected bosses must be attended. Boss-relative standing is context only, not the overall score.',
      rules: [...rules],
      limitations: [
        'Observed deaths, damage taken and unused cooldowns do not establish fault.',
        'Assignments, voice calls and intended sacrifices may not be present in combat logs.',
        'Utility and defensive usage are shown as facts. They are scored only when validated assigned opportunities are available.',
        'Kill output percentiles are class/spec comparisons from Warcraft Logs. They are unavailable on wipes and may be unavailable for unsupported actors.',
        'This prototype has no validated live mechanic-failure rules for Sszorak yet. Unverified spell mappings never produce penalties.',
        'Survival can overlap the consequence of a mechanic error; categories are descriptive, not independent causal evidence.',
      ],
    },
  };
}
