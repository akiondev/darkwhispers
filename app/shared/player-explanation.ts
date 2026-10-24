import type { Category, PlayerBossScore, LegacyRankedPlayer as RankedPlayer } from './types.js';

export const CATEGORY_NAMES: Record<Category, string> = {
  mechanics: 'Mechanics',
  survival: 'Survival',
  output: 'Class/spec output',
  utility: 'Assigned utility',
};

/** Explain the actual applied inputs, not raw throughput or an invented percentile. */
export function bossContributions(boss: PlayerBossScore) {
  const applied = (Object.keys(CATEGORY_NAMES) as Category[]).filter(
    (key) => boss.categories[key].applied && boss.categories[key].score !== null,
  );
  const weight = applied.reduce((sum, key) => sum + boss.categories[key].weight, 0);
  return applied.map((key) => ({
    key,
    name: CATEGORY_NAMES[key],
    score: boss.categories[key].score!,
    weight: (100 * boss.categories[key].weight) / weight,
    points: (boss.categories[key].score! * boss.categories[key].weight) / weight,
    lost: ((100 - boss.categories[key].score!) * boss.categories[key].weight) / weight,
  }));
}

export function playerExplanation(player: RankedPlayer) {
  const failures = player.mechanicFailures;
  const opportunities = player.mechanicOpportunities;
  const mechanics =
    failures !== null && opportunities !== null && opportunities > 0
      ? {
          failures,
          opportunities,
          clean: opportunities - failures,
          score: 100 * (1 - failures / opportunities),
        }
      : null;
  const alive =
    (100 * (player.evaluatedAliveMs ?? player.aliveMs)) /
    Math.max(1, player.evaluatedDurationMs ?? player.durationMs);
  const scored = player.perBoss.filter((b) => b.score !== null);
  const losses = (Object.keys(CATEGORY_NAMES) as Category[])
    .flatMap((key) => {
      const inputs = scored.flatMap(bossContributions).filter((c) => c.key === key);
      return inputs.length
        ? [
            {
              key,
              name: CATEGORY_NAMES[key],
              points: inputs.reduce((n, c) => n + c.lost, 0) / scored.length,
            },
          ]
        : [];
    })
    .sort((a, b) => b.points - a.points);
  const strengths = (Object.keys(CATEGORY_NAMES) as Category[]).flatMap((key) => {
    const inputs = scored.flatMap(bossContributions).filter((c) => c.key === key);
    if (!inputs.length) return [];
    const score = inputs.reduce((n, c) => n + c.score, 0) / inputs.length;
    return score >= 90 ? [{ name: CATEGORY_NAMES[key], score }] : [];
  });
  return { mechanics, alive, scored, losses, strengths };
}
