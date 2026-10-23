import type { ActivityFacts, Fight, Report } from '../shared/types.js';
import { aliveIntervals, type LifeEvent } from '../shared/life.js';
import { roleFromSpec } from '../shared/players.js';

/** Ten-second observation windows, not a GCD simulator. Shared role downtime is excluded. */
export function actionContinuity(
  report: Report,
  fight: Fight,
  casts: { sourceID: number; timestamp: number }[],
  life: Map<number, LifeEvent[]>,
  end: number,
) {
  const width = 10000;
  const roster = new Set(fight.friendlyPlayers);
  const roles = new Map(
    report.players.map((p) => [p.id, roleFromSpec(fight.playerSpecs?.[p.id] ?? p.spec)]),
  );
  const bins = new Map<number, Set<number>>();
  for (const c of casts) {
    if (!roster.has(c.sourceID) || c.timestamp < fight.startTime || c.timestamp >= end) continue;
    const bin = Math.floor((c.timestamp - fight.startTime) / width);
    const ids = bins.get(bin) ?? new Set<number>();
    ids.add(c.sourceID);
    bins.set(bin, ids);
  }
  const intervals = new Map(
    fight.friendlyPlayers.map((id) => [
      id,
      aliveIntervals({ ...fight, endTime: end }, life.get(id) ?? []),
    ]),
  );
  const result = new Map<number, ActivityFacts>(
    fight.friendlyPlayers.map((id) => [
      id,
      { activeMs: 0, eligibleMs: 0, activeWindows: 0, eligibleWindows: 0 },
    ]),
  );
  for (let start = fight.startTime; start < end; start += width) {
    const finish = Math.min(end, start + width),
      cast = bins.get(Math.floor((start - fight.startTime) / width)) ?? new Set<number>();
    const alive = new Map(
      fight.friendlyPlayers.map((id) => [
        id,
        intervals
          .get(id)!
          .reduce((n, [a, b]) => n + Math.max(0, Math.min(b, finish) - Math.max(a, start)), 0),
      ]),
    );
    for (const id of fight.friendlyPlayers) {
      if (!alive.get(id)) continue;
      const peers = fight.friendlyPlayers.filter(
        (other) => roles.get(other) === roles.get(id) && alive.get(other)! > 0,
      );
      // A same-role peer is required. Own action is positive evidence; peers expose quiet windows.
      const other = peers.filter((other) => other !== id);
      if (
        !other.length ||
        (!cast.has(id) &&
          other.filter((other) => cast.has(other)).length <
            Math.max(1, Math.ceil(other.length * 0.25)))
      )
        continue;
      const f = result.get(id)!;
      f.eligibleMs += alive.get(id)!;
      f.eligibleWindows++;
      if (cast.has(id)) {
        f.activeMs += alive.get(id)!;
        f.activeWindows++;
      }
    }
  }
  return result;
}
