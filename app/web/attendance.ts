import type { Analysis, ExecutionPullReview, RankedPlayer, Selection } from '../shared/types.js';

export function pullAttendance(player: RankedPlayer, analysis: Analysis) {
  const selected = new Set(analysis.pulls.map((p) => p.fight.id));
  const scoredFightIds = [
    ...new Set(
      player.pullReviews
        .filter((r) => r.execution.score !== null && selected.has(r.fightId))
        .map((r) => r.fightId),
    ),
  ];
  const attended = new Set(player.pullReviews.map((r) => r.fightId));
  const otherRole = new Set(
    analysis.players
      .filter((p) => p.id === player.id && p.role !== player.role)
      .flatMap((p) => p.pullReviews.map((r) => r.fightId))
      .filter((id) => selected.has(id) && !attended.has(id)),
  );
  return (
    player.attendance ?? {
      selectedPulls: selected.size,
      attendedPulls: attended.size,
      scoredPulls: scoredFightIds.length,
      otherRolePulls: otherRole.size,
      absentPulls: Math.max(0, selected.size - attended.size - otherRole.size),
      excludedPulls: attended.size - scoredFightIds.length,
      scoredFightIds,
    }
  );
}

export function attendanceLabel(player: RankedPlayer, analysis: Analysis): string {
  const a = pullAttendance(player, analysis);
  return (
    [
      a.otherRolePulls > 0 ? 'Role switch' : '',
      a.absentPulls > 0 ? `${a.absentPulls} absent` : '',
      a.excludedPulls > 0 ? `${a.excludedPulls} excluded` : '',
    ]
      .filter(Boolean)
      .join(' · ') ||
    (player.rankingStatus === 'no-peers' ? 'No same-role peer' : 'All selected pulls')
  );
}

export function lifeComplete(review: ExecutionPullReview): boolean {
  return review.lifeComplete ?? !review.lifeIssues?.length;
}

/** Submit a new analysis of exact verified pull IDs; never reuse an aggregate score as a comparison. */
export function samePullSelection(player: RankedPlayer, analysis: Analysis): Selection | null {
  const verified = new Set(
    player.pullReviews.filter((r) => r.execution.score !== null).map((r) => r.fightId),
  );
  const fightIds = analysis.pulls.map((p) => p.fight.id).filter((id) => verified.has(id));
  if (!fightIds.length) return null;
  return { ...analysis.selection, wipeStops: undefined, fightIds, excludeWipeTail: false };
}
